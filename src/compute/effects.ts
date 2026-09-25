//加成效果管道
//效果以数据声明(target/type/槽位),计算、统计、描述均自动派生
//管道两阶段:先组合各效果的槽位(base/amount/threshold/power),再按类型优先级合并主效果
//约定(详见 docs/面向开发者/effect机制.md):
//- ctx可省略(缺省pos=[0],id=0);调用点不要手写上下文
//- 槽位必须经defineSlot具名注册(全局唯一),禁止在调用点临时构造
//- 数值回调一律返回Decimal(读取路径不再做new Decimal归一化)
//- 软上限一律用cap类型声明(阈值/幂次为槽位、高度为常量),不要写成custom
//- 效果默认dynamic(每帧重算);标static即承诺"只依赖购买/解锁/层级结构",可进本帧的**效果计划**
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { getLayerName, prevLayer } from '@/access'
import { layerKey } from '@/tools/ordinal'
import { softCapValue } from '@/tools/softCap'
import { format } from '@/tools/format'
import { frameCachedByObject, frameCachedValue, onCacheReset, withCacheBypass } from './frameCache'

/**计算加成时的上下文 */
export interface EffectContext {
  pos: LayerId
  id: number
}

/**上下文的输入形式:可整体省略(缺省pos=[0],id=0),也可只给层级 */
export type EffectContextInput = LayerId | { pos?: LayerId; id?: number } | undefined

/**缺省上下文:全局数值点/槽位用它求值(模块级常量,避免每次分配) */
export const DEFAULT_CONTEXT: EffectContext = { pos: [0], id: 0 }

/**把一个上下文输入补全为完整上下文(已完整的对象原样返回,不额外分配) */
export function resolveCtx(ctx?: EffectContextInput): EffectContext {
  if (ctx == undefined) return DEFAULT_CONTEXT
  if (Array.isArray(ctx)) return { pos: ctx, id: 0 }
  if (ctx.pos != undefined && ctx.id != undefined) return { pos: ctx.pos, id: ctx.id }
  return { pos: ctx.pos ?? DEFAULT_CONTEXT.pos, id: ctx.id ?? 0 }
}

/**槽位缓存作用域:global=初始值不依赖层级(缓存键只有id,命中率更高) */
export type SlotScope = 'global' | 'layer'

/**槽位:效果公式中可被调整的参数(底数/指数/等级/阈值/幂次),可被其他效果修饰 */
export interface EffectSlot {
  /**槽位唯一名(=它接受的修饰目标) */
  id: string
  /**帧内缓存作用域 */
  scope: SlotScope
  /**初始值 */
  init(ctx: EffectContext): Decimal
}

/**作用方式:add→值+value, mul→值×value, exp→值^value, custom→替换为value, cap→对值套软上限 */
export type EffectType = 'add' | 'mul' | 'exp' | 'custom' | 'cap'

/**效果声明(定义用,注册时自动补id/name) */
export interface EffectDef {
  /**数值点id(=修饰目标,一一对应) */
  target: string
  type: EffectType
  /**加成数值;缺省时mul→base^amount, add→base×amount(需声明base与amount槽位) */
  value?(ctx: EffectContext, base?: Decimal, amount?: Decimal, current?: Decimal): Decimal
  /**可调整参数槽位 */
  base?: EffectSlot | string
  /**等级槽位(仅维度/可购买) */
  amount?: EffectSlot | string
  /**仅cap:软上限阈值槽位 */
  threshold?: EffectSlot | string
  /**仅cap:软上限幂次槽位 */
  power?: EffectSlot | string
  /**仅cap:软上限高度(常量;价格软上限=1,维度生产/挑战目标=0) */
  height?: number
  /**文字模板:{value}{base}{basePercent}{amount}{threshold}{power} */
  text?: string
  /**覆盖默认优先级(按类型add→mul→exp→custom→cap) */
  order?: number
  /**是否生效,缺省始终生效 */
  isActive?(ctx: EffectContext): boolean
  /**
   * 该效果的数值是否只依赖购买/解锁/层级结构(默认false)
   * 标true即允许进帧内**效果计划**:数值在本帧内被缓存,并与相邻同类型静态效果折叠
   * 读点数/维度数量(产出)/能量/时间的数值效果必须保持false
   */
  static?: boolean
}

/**注册后的效果 */
export interface RegisteredEffect extends EffectDef {
  id: string
  name: string
}

/**已注册的效果,按目标分组 */
const registered: Record<string, RegisteredEffect[]> = {}

/**已注册的效果,按id索引(便于按id引用某个加成数值) */
const byId = new Map<string, RegisteredEffect>()

/**槽位注册表(按id唯一) */
const slots = new Map<string, EffectSlot>()

/**效果禁用器:返回true时该效果失效(如挑战惩罚禁用某些效果) */
const disablers = new Map<string, ((ctx: EffectContext) => boolean)[]>()

/**
 * 注册一个槽位(全局唯一;必须先声明后引用)
 * @param id 槽位唯一名(同时是它接受的修饰目标)
 * @param init 初始值(必须返回Decimal)
 * @param scope 'global'表示初始值不依赖层级(缓存键只有id);缺省'layer'
 */
export function defineSlot(
  id: string,
  init: (ctx: EffectContext) => Decimal,
  scope: SlotScope = 'layer',
): EffectSlot {
  if (slots.has(id)) throw new Error(`槽位id重复:${id}`)
  const slot: EffectSlot = { id, scope, init }
  slots.set(id, slot)
  if (import.meta.env.DEV && scope == 'global') checkGlobalSlot(slot)
  return slot
}

/**按id取槽位(未注册即抛错:槽位必须先声明后引用) */
function getSlot(id: string): EffectSlot {
  const slot = slots.get(id)
  if (!slot) throw new Error(`未注册的槽位:${id}`)
  return slot
}

/**把槽位引用(对象或id)解析为槽位对象 */
export function asSlot(slot: EffectSlot | string): EffectSlot {
  return typeof slot == 'string' ? getSlot(slot) : slot
}

/**开发构建校验:声明为global的槽位不得依赖ctx(用两个不同ctx求值比较) */
function checkGlobalSlot(slot: EffectSlot) {
  try {
    const a = slot.init(DEFAULT_CONTEXT)
    const b = slot.init({ pos: [1, 0], id: 3 })
    if (!a.eq(b)) console.error(`[效果]槽位${slot.id}声明为global,但其初始值依赖ctx`)
  } catch {
    //求值失败留给运行期报错,这里不掩盖
  }
}

/**
 * 注册一个效果禁用器
 * @param effectId 被禁用的效果id
 * @param fn 禁用条件,返回true时该效果失效
 */
export function registerEffectDisabler(effectId: string, fn: (ctx: EffectContext) => boolean) {
  const list = disablers.get(effectId) || []
  list.push(fn)
  disablers.set(effectId, list)
}

/**某效果是否被禁用(任一禁用器返回true即禁用) */
function isEffectDisabled(e: RegisteredEffect, ctx: EffectContext): boolean {
  const list = disablers.get(e.id)
  return list ? list.some((fn) => fn(ctx)) : false
}

/**类型默认优先级:加法→乘法→乘方→自定义→软上限(cap恒最后生效) */
const TYPE_PRIORITY: Record<EffectType, number> = { add: 0, mul: 1, exp: 2, custom: 3, cap: 4 }

/**效果的优先级(order覆盖类型默认) */
function priority(e: RegisteredEffect): number {
  return e.order ?? TYPE_PRIORITY[e.type]
}

/**中性基准值:加法为0,其余为1 */
function neutralValue(type: EffectType): Decimal {
  return type == 'add' ? Decimal.dZero : Decimal.dOne
}

/**注册一个效果(id全局唯一) */
export function registerEffect(e: RegisteredEffect) {
  if (byId.has(e.id)) throw new Error(`效果id重复:${e.id}`)
  if (e.type == 'cap' && (e.threshold == undefined || e.power == undefined)) {
    throw new Error(`cap效果${e.id}必须声明threshold与power槽位`)
  }
  byId.set(e.id, e)
  const list = (registered[e.target] ||= [])
  list.push(e)
  list.sort((a, b) => priority(a) - priority(b))
}

/**按id在所有目标中查找已注册的效果 */
export function effectById(id: string): RegisteredEffect | undefined {
  return byId.get(id)
}

/**按id计算某效果的当前数值(未注册时返回1,即无加成) */
export function effectValueById(id: string, ctx?: EffectContextInput): Decimal {
  const e = byId.get(id)
  return e ? effectValue(e, ctx) : Decimal.dOne
}
/**获取某个数值点已注册的所有效果 */
function getEffects(target: string): RegisteredEffect[] {
  return registered[target] || []
}

//------数值点求值------

/**
 * 计算效果数值(槽位已解析)
 * @param current 当前值(custom等需要读取当前值的效果使用)
 */
function valueWith(
  e: RegisteredEffect,
  ctx: EffectContext,
  base: Decimal | undefined,
  amount: Decimal | undefined,
  current?: Decimal,
): Decimal {
  if (e.value) return e.value(ctx, base, amount, current)
  if (e.type == 'mul' && base && amount) return base.pow(amount)
  if (e.type == 'add' && base && amount) return base.mul(amount)
  throw new Error(`效果${e.id}缺少value或base/amount槽位`)
}

/**
 * 解析槽位并计算效果数值(不走计划的通用入口:统计、求逆、开发构建自检用)
 * 注:cap类型没有"数值"的概念,对其调用返回1
 */
function stepValue(e: RegisteredEffect, ctx: EffectContext, current?: Decimal): Decimal {
  if (e.type == 'cap') return Decimal.dOne
  const base = e.base != undefined ? slotValue(e.base, ctx) : undefined
  const amount = e.amount != undefined ? slotValue(e.amount, ctx) : undefined
  return valueWith(e, ctx, base, amount, current)
}

/**
 * 组合一个槽位:初始值上依序应用注册到该槽位的效果
 * 帧内缓存(见compute/frameCache):同一帧内同一个槽位的组合值只算一次。
 * 依据:这些子值都只随"购买/重置/进出挑战"变化,而这些写操作都会清空缓存;
 *      一帧内的生产只更新维度数量/点数/能量,不会改变槽位所依赖的已购数
 * @param slot 槽位对象或槽位id(必须经defineSlot注册,保证同一逻辑槽位是同一对象)
 * @param ctx 计算上下文(可省略)
 */
export function slotValue(slot: EffectSlot | string, ctx?: EffectContextInput): Decimal {
  const s = asSlot(slot)
  const c = resolveCtx(ctx)
  //global槽位的初始值与层级无关,缓存键只有id(命中率更高)
  const key = s.scope == 'global' ? '' : `${layerKey(c.pos)}|${c.id}`
  return frameCachedByObject(
    s,
    key,
    () => {
      let value = s.init(c)
      for (const e of getEffects(s.id)) value = applyEffect(e, value, c)
      return value
    },
    `slot:${s.id}`,
  )
}

/**该效果在当前上下文下是否生效(未解锁/被挑战禁用都不计入) */
function isEffective(e: RegisteredEffect, ctx: EffectContext): boolean {
  return (!e.isActive || e.isActive(ctx)) && !isEffectDisabled(e, ctx)
}

//------效果计划(帧内物化)------
//计划 = 该数值点在本帧的"生效效果列表 + 折叠后的步骤",按"数值点|层级|物品"缓存
//生效判定与数值解析依赖上下文(层级/物品id/挑战状态),但一帧内不会变(写状态都必须clearFrameCache)
//折叠:相邻的同类static效果合并成一步(add求和/mul求积/exp幂次求积);cap与custom恒独立
//      (前者与任何运算都不可交换且带阈值/幂次,后者是"替换当前值"的语义)
//效果默认dynamic(每帧重算);标static即承诺"只依赖购买/解锁/层级结构",可进本帧的计划

/**计划中的一步:类型 + 折叠段合成值 / 单条效果 / cap段的阈值与幂次 */
interface ResolvedStep {
  type: EffectType
  /**折叠段生效成员合成的数值;静态的独立段(如静态custom)也在此预解析 */
  value?: Decimal
  /**独立段/cap段对应的效果(读current、cap高度、统计用) */
  e?: RegisteredEffect
  /**仅cap:已解析的阈值与幂次 */
  threshold?: Decimal
  power?: Decimal
}

/**某数值点在本帧的计划 */
interface EffectPlan {
  /**本帧生效的效果(统计/逐条展示用,按优先级顺序) */
  active: RegisteredEffect[]
  /**按段折叠后的步骤(求值/求逆用) */
  steps: ResolvedStep[]
}

/**计划缓存的宿主(模块级常量) */
const PLAN_OWNER = { name: 'effectPlan' }

/**帧内物化:按注册顺序判定生效,并把相邻同类static效果折成一步 */
function buildPlan(target: string, ctx: EffectContext): EffectPlan {
  const active: RegisteredEffect[] = []
  const steps: ResolvedStep[] = []
  //正在折叠的段(同类型static效果的合成值)
  let foldType: EffectType | undefined
  let foldValue = Decimal.dOne
  //结束当前折叠段:中性段(加0/乘1)不产生步骤,与逐条求值等价
  const flush = () => {
    if (foldType == undefined) return
    if (!foldValue.eq(neutralValue(foldType))) steps.push({ type: foldType, value: foldValue })
    foldType = undefined
    foldValue = Decimal.dOne
  }
  for (const e of getEffects(target)) {
    if (!isEffective(e, ctx)) continue
    active.push(e)
    const foldable = e.static == true && e.type != 'cap' && e.type != 'custom'
    if (!foldable) {
      flush()
      if (e.type == 'cap') {
        steps.push({
          type: 'cap',
          e,
          threshold: slotValue(e.threshold as EffectSlot | string, ctx),
          power: slotValue(e.power as EffectSlot | string, ctx),
        })
        continue
      }
      //静态的custom在这里预解析;dynamic留到读取时现算
      const v = e.static ? stepValue(e, ctx, neutralValue(e.type)) : undefined
      if (v != undefined) recordStaticSample(e, ctx, v)
      steps.push({ type: e.type, e, value: v })
      continue
    }
    const v = stepValue(e, ctx, neutralValue(e.type))
    recordStaticSample(e, ctx, v)
    if (foldType != e.type) {
      flush()
      foldType = e.type
      foldValue = v
    } else {
      foldValue = e.type == 'add' ? foldValue.add(v) : foldValue.mul(v)
    }
  }
  flush()
  return { active, steps }
}

/**
 * 取某数值点在本帧的计划(帧内缓存)
 * 键=数值点id+层级键+物品id:计划里的槽位与生效判定都按该上下文解析
 */
function planFor(target: string, ctx: EffectContext): EffectPlan {
  const key = `${target}|${layerKey(ctx.pos)}|${ctx.id}`
  return frameCachedValue(PLAN_OWNER, key, () => buildPlan(target, ctx), `plan:${target}`)
}

/**把"已求出的效果数值"按类型施加到当前值上(唯一的类型分发点) */
function applyValue(type: EffectType, v: Decimal, value: Decimal): Decimal {
  switch (type) {
    case 'add':
      return value.add(v)
    case 'mul':
      return value.mul(v)
    case 'exp':
      return value.pow(v)
    case 'custom':
      return v
    default:
      return value
  }
}

/**把一个已解析的步骤应用到当前值 */
function applyResolvedStep(step: ResolvedStep, value: Decimal, ctx: EffectContext): Decimal {
  if (step.type == 'cap') {
    return softCapValue(value, step.threshold!, step.power!, step.e!.height ?? 0)
  }
  return applyValue(step.type, step.value ?? stepValue(step.e!, ctx, value), value)
}

/**把一个效果应用到当前值(不走计划的通用入口:槽位组合用) */
function applyEffect(e: RegisteredEffect, value: Decimal, ctx: EffectContext): Decimal {
  if (!isEffective(e, ctx)) return value
  if (e.type == 'cap') {
    return softCapValue(
      value,
      slotValue(e.threshold as EffectSlot | string, ctx),
      slotValue(e.power as EffectSlot | string, ctx),
      e.height ?? 0,
    )
  }
  return applyValue(e.type, stepValue(e, ctx, value), value)
}

/**带上下文的数值点求值(内部用) */
function applyToAt(target: string, base: Decimal, ctx: EffectContext): Decimal {
  let value = base
  for (const step of planFor(target, ctx).steps) value = applyResolvedStep(step, value, ctx)
  return value
}

/**
 * 读取"调用型数值点":在调用方给定的基准值上应用该数值点的所有加成
 * @param target 数值点id
 * @param base 基准值(核心公式给出的原始值;可省略,默认1)
 * @param ctx 计算上下文(可省略,缺省pos=[0],id=0)
 */
export function applyTo(
  target: string,
  base: Decimal = Decimal.dOne,
  ctx?: EffectContextInput,
): Decimal {
  return applyToAt(target, base, resolveCtx(ctx))
}

/**组合槽位并附上各生效修饰来源的明细(统计用,未生效的效果不列出) */
export function slotBreakdown(slot: EffectSlot | string, ctx?: EffectContextInput) {
  const c = resolveCtx(ctx)
  const s = asSlot(slot)
  const parts = planFor(s.id, c).active.map((e) => ({ e, value: effectValue(e, c) }))
  return { total: slotValue(s, c), parts }
}

/**计算单个效果对中性基准的贡献值(未生效返回中性值) */
function effectValue(e: RegisteredEffect, ctx?: EffectContextInput): Decimal {
  const c = resolveCtx(ctx)
  if (isEffectDisabled(e, c)) return neutralValue(e.type)
  if (e.isActive && !e.isActive(c)) return neutralValue(e.type)
  return stepValue(e, c, neutralValue(e.type))
}

/**
 * 通用求逆:把"管道输出"还原为"调用方基准值"
 * 求逆=逆序折叠本帧计划的步骤(与正向共用同一份步骤序列,折叠方式因此天然一致):
 *   add→减、mul→除、exp→开方、cap→softCapValue(1/p);遇到custom(或不可逆定义域)返回undefined
 * 契约:返回值只用作"预算→数量"的闭式锚点,偏差只影响迭代次数(见tools/bisect)
 * @returns 基准值;不可逆时返回undefined
 */
export function invertAt(
  target: string,
  out: Decimal,
  ctx?: EffectContextInput,
): Decimal | undefined {
  const c = resolveCtx(ctx)
  const steps = planFor(target, c).steps
  let value = out
  for (let i = steps.length - 1; i >= 0; --i) {
    const r = invertStep(steps[i]!, value, c)
    if (r == undefined) return undefined
    value = r
  }
  return value
}

/**逆序折叠中的单步求逆(不可逆返回undefined) */
function invertStep(step: ResolvedStep, out: Decimal, ctx: EffectContext): Decimal | undefined {
  if (step.type == 'cap') {
    const power = step.power!
    if (!power.gt(0) || !out.isFinite() || out.lte(0)) return undefined
    return softCapValue(out, step.threshold!, power.recip(), step.e!.height ?? 0)
  }
  if (step.type == 'custom') return undefined
  const v = step.value ?? stepValue(step.e!, ctx, Decimal.dOne)
  switch (step.type) {
    case 'add':
      return out.sub(v)
    case 'mul':
      return v.eq(0) ? undefined : out.div(v)
    case 'exp':
      return v.gt(0) && out.gt(0) ? out.root(v) : undefined
    default:
      return undefined
  }
}

/**统计某个数值点:总效果与各生效来源明细(未生效的效果不列出) */
export function effectBreakdown(
  target: string,
  ctx?: EffectContextInput,
  base: Decimal = Decimal.dOne,
) {
  const c = resolveCtx(ctx)
  const parts = planFor(target, c).active.map((e) => ({ e, value: effectValue(e, c) }))
  return { total: applyToAt(target, base, c), parts }
}

//------数值点声明(统计页据此自动派生加成树)------

/**统计树的"公式输入"节点描述(只有真公式需要,如"产量=总量×乘数^指数") */
export interface StatInput {
  label: string
  /**总值前显示的符号 */
  sign?: string
  /**要读取的数值点id;省略时用value直接给出 */
  point?: string
  /**该输入的数值(未给point时使用) */
  value?: Decimal
}

/**
 * 数值点声明:标签/符号/展示基准/公式输入只在这里声明一次
 * 新增机制只要声明数值点,统计页就会自动出现对应节点,不需要改 statistics.ts 或 UI
 */
export interface ValuePointDef {
  id: string
  /**统计页节点标题(可按上下文变化) */
  label: string | ((ctx: EffectContext) => string)
  /**总值前显示的符号 */
  sign?: string
  /**调用型数值点的展示基准值(统计页"初始值"节点);缺省1 */
  base?(ctx: EffectContext): Decimal
  /**统计根的来源分组:dimension=每维度一棵、buyable=每可购买一棵、layer=每层一棵、once=全局一棵 */
  statRoots?: 'dimension' | 'buyable' | 'layer' | 'once'
  /**公式输入(插在"初始值"与效果明细之间) */
  statInputs?(ctx: EffectContext): StatInput[]
}

/**已注册的数值点声明 */
const valuePoints = new Map<string, ValuePointDef>()

/**注册一个数值点声明(id全局唯一) */
export function defineValuePoint(def: ValuePointDef) {
  if (valuePoints.has(def.id)) throw new Error(`数值点id重复:${def.id}`)
  valuePoints.set(def.id, def)
}

/**取某分组下的全部数值点声明(按注册顺序) */
export function statPoints(kind: NonNullable<ValuePointDef['statRoots']>): ValuePointDef[] {
  return Array.from(valuePoints.values()).filter((d) => d.statRoots == kind)
}

/**一次求值的轨迹步骤(统计页逐步展示"前→后"用) */
export interface EffectTraceStep {
  e: RegisteredEffect
  /**应用前的值 */
  before: Decimal
  /**应用后的值 */
  after: Decimal
  /**该效果自身的数值(cap为软上限后的值) */
  value: Decimal
}

/**
 * 回放某数值点的管道:返回总值与每个生效效果的前/后值
 * cap/custom这类无法用单一系数表达的效果靠它展示"原值 → 新值"
 */
export function effectTrace(
  target: string,
  base: Decimal,
  ctx?: EffectContextInput,
): { total: Decimal; steps: EffectTraceStep[] } {
  const c = resolveCtx(ctx)
  let value = base
  const steps: EffectTraceStep[] = []
  for (const e of planFor(target, c).active) {
    const before = value
    if (e.type == 'cap') {
      value = softCapValue(
        value,
        slotValue(e.threshold as EffectSlot | string, c),
        slotValue(e.power as EffectSlot | string, c),
        e.height ?? 0,
      )
      steps.push({ e, before, after: value, value })
      continue
    }
    const v = stepValue(e, c, value)
    value = applyValue(e.type, v, value)
    steps.push({ e, before, after: value, value: v })
  }
  return { total: value, steps }
}

//------开发构建:static效果的帧内自检------
//标了static的数值必须在本帧内保持不变;这里采样它们的数值,在指定时机重算对比
//(不等说明该效果其实依赖了每帧变化的量,或某处写状态没有清缓存)

/**本帧已记录的static采样 */
let staticSamples: { e: RegisteredEffect; ctx: EffectContext; value: Decimal }[] = []
/**采样上限(开发构建的观测开销上限) */
const MAX_STATIC_SAMPLES = 400

/**记录一次static效果采样(仅开发构建) */
function recordStaticSample(e: RegisteredEffect, ctx: EffectContext, value: Decimal) {
  if (!import.meta.env.DEV || staticSamples.length >= MAX_STATIC_SAMPLES) return
  staticSamples.push({ e, ctx, value })
}

//写状态清缓存时丢弃采样:那些变化是合法的
onCacheReset(() => {
  staticSamples = []
})

/**
 * 开发构建自检:重算本帧记录过的static效果,检查数值是否仍然一致
 * @param site 调用点说明(写进报错,便于定位)
 */
export function runStaticSelfCheck(site: string) {
  if (!import.meta.env.DEV || staticSamples.length == 0) return
  const samples = staticSamples
  staticSamples = []
  let bad = 0
  for (const s of samples) {
    let fresh: Decimal
    try {
      fresh = withCacheBypass(() => stepValue(s.e, s.ctx, neutralValue(s.e.type)))
    } catch {
      continue
    }
    if (!fresh.eq(s.value)) {
      bad++
      if (bad <= 5) {
        console.error(
          `[效果]标了static的${s.e.id}在"${site}"数值变化:记录=${s.value} 现在=${fresh}` +
            `(它依赖了每帧变化的量,或该写状态没有清缓存)`,
        )
      }
    }
  }
  if (bad > 5) console.error(`[效果]共${bad}处static效果数值变化(只列出前5条)`)
}

/**渲染文本模板中的层级占位符:{prevLayer}为下层层级名,{currentLayer}为本层层级名 */
export function renderLayerPlaceholders(template: string, pos: LayerId): string {
  return template
    .replaceAll('{prevLayer}', getLayerName(prevLayer(pos)))
    .replaceAll('{currentLayer}', getLayerName(pos))
}

/**渲染效果文字模板 */
export function renderText(
  template: string,
  e: RegisteredEffect,
  ctx?: EffectContextInput,
): string {
  const c = resolveCtx(ctx)
  const base = e.base != undefined ? slotValue(e.base, c) : Decimal.dOne
  const amount = e.amount != undefined ? slotValue(e.amount, c) : Decimal.dOne
  const threshold = e.threshold != undefined ? slotValue(e.threshold, c) : Decimal.dOne
  const power = e.power != undefined ? slotValue(e.power, c) : Decimal.dOne
  return renderLayerPlaceholders(template, c.pos)
    .replaceAll('{value}', format(effectValue(e, c)))
    .replaceAll('{base}', format(base))
    .replaceAll('{basePercent}', format(base.sub(1).mul(100)))
    .replaceAll('{amount}', format(amount))
    .replaceAll('{threshold}', format(threshold))
    .replaceAll('{power}', format(power))
}

/**效果的默认文字 */
export function effectText(e: RegisteredEffect, ctx?: EffectContextInput): string {
  const defaults: Record<EffectType, string> = {
    add: '+{value}',
    mul: 'x{value}',
    exp: '^{value}',
    custom: '{value}',
    cap: '软上限(阈值{threshold},幂次{power})',
  }
  return renderText(e.text ?? defaults[e.type], e, ctx)
}
