//加成效果管道
//效果以数据声明(target/type/槽位),计算、统计、描述均自动派生
//管道两阶段:先组合各效果的槽位(base/amount),再按类型优先级合并主效果
import Decimal, { type DecimalSource } from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { getLayerName, prevLayer } from '@/access'
import { format } from '@/tools/format'

/**加成作用的数值点 */
export type EffectTarget =
  | 'dimensionCost'
  | 'dimensionMult'
  | 'dimensionExponent'
  | 'production'
  | 'pointsGain'
  | 'upgradeCost'
  | 'psdSpeed'

/**计算加成时的上下文 */
export interface EffectContext {
  pos: LayerId
  id: number
}

/**作用方式:add→值+value, mul→值×value, exp→值^value, custom→替换为value */
export type EffectType = 'add' | 'mul' | 'exp' | 'custom'

/**槽位:效果公式中可被调整的参数(底数/指数/等级),可被其他效果通过子目标修饰 */
export interface EffectSlot {
  /**子目标标识,如'b11:base',其他效果可对其实施修饰 */
  target: string
  /**初始值 */
  init(ctx: EffectContext): DecimalSource
}

/**效果声明(定义用,注册时自动补id/name) */
export interface EffectDef {
  /**主目标或子目标 */
  target: string
  type: EffectType
  /**加成数值;缺省时mul→base^amount, add→base×amount(需声明base与amount槽位) */
  value?(ctx: EffectContext, base?: Decimal, amount?: Decimal, current?: Decimal): DecimalSource
  /**可调整参数槽位 */
  base?: EffectSlot
  /**等级槽位(仅维度/可购买) */
  amount?: EffectSlot
  /**文字模板:{value}{base}{basePercent}{amount} */
  text?: string
  /**覆盖默认优先级(按类型add→mul→exp→custom) */
  order?: number
  /**是否生效,缺省始终生效 */
  isActive?(ctx: EffectContext): boolean
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

/**效果禁用器:返回true时该效果失效(如挑战惩罚禁用某些效果) */
const disablers = new Map<string, ((ctx: EffectContext) => boolean)[]>()

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

/**类型默认优先级:加法→乘法→乘方→自定义 */
const TYPE_PRIORITY: Record<EffectType, number> = { add: 0, mul: 1, exp: 2, custom: 3 }

/**效果的优先级(order覆盖类型默认) */
function priority(e: RegisteredEffect): number {
  return e.order ?? TYPE_PRIORITY[e.type]
}

/**中性基准值:加法为0,其余为1 */
function neutralValue(type: EffectType): Decimal {
  return type == 'add' ? new Decimal(0) : new Decimal(1)
}

/**注册一个效果(id全局唯一) */
export function registerEffect(e: RegisteredEffect) {
  if (byId.has(e.id)) throw new Error(`效果id重复:${e.id}`)
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
export function effectValueById(id: string, ctx: EffectContext): Decimal {
  const e = byId.get(id)
  return e ? effectValue(e, ctx) : new Decimal(1)
}

/**获取某个目标已注册的所有效果 */
export function getEffects(target: string): RegisteredEffect[] {
  return registered[target] || []
}

/**组合一个槽位:初始值上依序应用子目标注册的效果 */
export function slotValue(slot: EffectSlot, ctx: EffectContext): Decimal {
  let value = new Decimal(slot.init(ctx))
  for (const e of getEffects(slot.target)) value = applyEffect(e, value, ctx)
  return value
}

/**获取某个目标当前生效的效果(统计页只显示生效加成) */
function activeEffects(target: string, ctx: EffectContext): RegisteredEffect[] {
  return getEffects(target).filter(
    (e) => (!e.isActive || e.isActive(ctx)) && !isEffectDisabled(e, ctx),
  )
}

/**组合槽位并附上各生效修饰来源的明细(统计用,未生效的效果不列出) */
export function slotBreakdown(slot: EffectSlot, ctx: EffectContext) {
  const parts = activeEffects(slot.target, ctx).map((e) => ({ e, value: effectValue(e, ctx) }))
  return { total: slotValue(slot, ctx), parts }
}

/**计算单个效果对中性基准的贡献值(未生效返回中性值) */
export function effectValue(e: RegisteredEffect, ctx: EffectContext): Decimal {
  if (isEffectDisabled(e, ctx)) return neutralValue(e.type)
  if (e.isActive && !e.isActive(ctx)) return neutralValue(e.type)
  const base = e.base ? slotValue(e.base, ctx) : undefined
  const amount = e.amount ? slotValue(e.amount, ctx) : undefined
  if (e.value) return new Decimal(e.value(ctx, base, amount, neutralValue(e.type)))
  if (e.type == 'mul' && base && amount) return base.pow(amount)
  if (e.type == 'add' && base && amount) return base.mul(amount)
  throw new Error(`效果${e.id}缺少value或base/amount槽位`)
}

/**把一个效果应用到当前值 */
function applyEffect(e: RegisteredEffect, value: Decimal, ctx: EffectContext): Decimal {
  if (isEffectDisabled(e, ctx)) return value
  if (e.isActive && !e.isActive(ctx)) return value
  const base = e.base ? slotValue(e.base, ctx) : undefined
  const amount = e.amount ? slotValue(e.amount, ctx) : undefined
  let v: Decimal
  if (e.value) v = new Decimal(e.value(ctx, base, amount, value))
  else if (e.type == 'mul' && base && amount) v = base.pow(amount)
  else if (e.type == 'add' && base && amount) v = base.mul(amount)
  else throw new Error(`效果${e.id}缺少value或base/amount槽位`)
  switch (e.type) {
    case 'add':
      return value.add(v)
    case 'mul':
      return value.mul(v)
    case 'exp':
      return value.pow(v)
    case 'custom':
      return v
  }
}

/**按注册顺序应用某个数值点的所有加成 */
export function calculate(target: string, ctx: EffectContext, base: Decimal = new Decimal(1)): Decimal {
  let value = base
  for (const e of getEffects(target)) value = applyEffect(e, value, ctx)
  return value
}

/**统计某个数值点:总效果与各生效来源明细(未生效的效果不列出) */
export function effectBreakdown(target: string, ctx: EffectContext, base: Decimal = new Decimal(1)) {
  const parts = activeEffects(target, ctx).map((e) => ({ e, value: effectValue(e, ctx) }))
  return { total: calculate(target, ctx, base), parts }
}

/**渲染文本模板中的层级占位符:{prevLayer}为下层层级名,{currentLayer}为本层层级名 */
export function renderLayerPlaceholders(template: string, pos: LayerId): string {
  return template
    .replaceAll('{prevLayer}', getLayerName(prevLayer(pos)))
    .replaceAll('{currentLayer}', getLayerName(pos))
}

/**渲染效果文字模板 */
export function renderText(template: string, e: RegisteredEffect, ctx: EffectContext): string {
  const base = e.base ? slotValue(e.base, ctx) : new Decimal(1)
  const amount = e.amount ? slotValue(e.amount, ctx) : new Decimal(1)
  return renderLayerPlaceholders(template, ctx.pos)
    .replaceAll('{value}', format(effectValue(e, ctx)))
    .replaceAll('{base}', format(base))
    .replaceAll('{basePercent}', format(base.sub(1).mul(100)))
    .replaceAll('{amount}', format(amount))
}

/**效果的默认文字 */
export function effectText(e: RegisteredEffect, ctx: EffectContext): string {
  const defaults: Record<EffectType, string> = {
    add: '+{value}',
    mul: 'x{value}',
    exp: '^{value}',
    custom: '{value}',
  }
  return renderText(e.text ?? defaults[e.type], e, ctx)
}
