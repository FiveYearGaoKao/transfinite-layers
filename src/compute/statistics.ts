//统计页的加成树(只读)
//节点全部由"数值点声明"(compute/valuePoints)与效果明细派生:新增机制不需要改本文件
//- 层级页:每个维度一棵产量树/价格树,每层一棵点数获取树,每个可购买一棵价格树
//- 全局页:与层级无关的数值点
//- 效果节点按"前值→后值"展示;软上限(cap)额外给出缩减倍率与实际前后值
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { DIMENSION_COUNT } from '@/data/constants'
import { layerKey, getLayerOrder } from '@/tools/ordinal'
import { format } from '@/tools/format'
import { getBuyables } from './buyables'
import {
  DEFAULT_CONTEXT,
  asSlot,
  effectBreakdown,
  effectTrace,
  slotBreakdown,
  statPoints,
  type EffectContext,
  type EffectSlot,
  type EffectType,
  type RegisteredEffect,
  type StatInput,
  type ValuePointDef,
} from './effects'
import './valuePoints'

/**统计明细的可折叠树节点 */
export interface StatNode {
  key: string
  label: string
  sign: string
  value: Decimal
  /**整行数值文本的替代(软上限用"原值 → 新值";给了它就不再显示 sign+value) */
  text?: string
  /**补充说明(如软上限的"高度0") */
  note?: string
  children: StatNode[]
}

/**效果作用方式的符号 */
function opSign(type: EffectType): string {
  return type == 'mul' ? 'x' : type == 'add' ? '+' : type == 'exp' ? '^' : ''
}

/**槽位节点:初始值 + 各修饰来源 */
function statSlot(
  slot: EffectSlot | string,
  label: string,
  key: string,
  ctx: EffectContext,
): StatNode {
  const s = asSlot(slot)
  const b = slotBreakdown(s, ctx)
  return {
    key,
    label,
    sign: '',
    value: b.total,
    children: [
      { key: `${key}:init`, label: '初始值', sign: '', value: s.init(ctx), children: [] },
      ...b.parts.map((p) =>
        effectNode({
          label: p.e.name ?? p.e.id,
          sign: opSign(p.e.type),
          value: p.value,
          key: `${key}:${p.e.id}`,
          ctx,
          params: effectParams(p.e),
        }),
      ),
    ],
  }
}

/**效果节点要展示的参数槽位:底数/数量/阈值/幂次(展开可见各自的修饰来源) */
function effectParams(e: RegisteredEffect): { label: string; slot: EffectSlot | string }[] {
  const params: { label: string; slot: EffectSlot | string }[] = []
  if (e.base != undefined) params.push({ label: '底数', slot: e.base })
  if (e.amount != undefined) params.push({ label: '数量', slot: e.amount })
  if (e.threshold != undefined) params.push({ label: '阈值', slot: e.threshold })
  if (e.power != undefined) params.push({ label: '幂次', slot: e.power })
  return params
}

/**效果节点 */
function effectNode(opts: {
  label: string
  key: string
  ctx: EffectContext
  sign?: string
  value?: Decimal
  text?: string
  note?: string
  params?: { label: string; slot: EffectSlot | string }[]
}): StatNode {
  return {
    key: opts.key,
    label: opts.label,
    sign: opts.sign ?? '',
    value: opts.value ?? Decimal.dOne,
    text: opts.text,
    note: opts.note,
    children: (opts.params ?? []).map((p) =>
      statSlot(p.slot, p.label, `${opts.key}:${p.label}`, opts.ctx),
    ),
  }
}

/**数值点输入节点(statInputs声明的公式输入) */
function inputNode(input: StatInput, key: string, ctx: EffectContext): StatNode {
  if (input.point) {
    const b = effectBreakdown(input.point, ctx, new Decimal(1))
    return {
      key,
      label: input.label,
      sign: input.sign ?? '',
      value: b.total,
      children: b.parts.map((p) =>
        effectNode({
          label: p.e.name ?? p.e.id,
          sign: opSign(p.e.type),
          value: p.value,
          key: `${key}:${p.e.id}`,
          ctx,
          params: effectParams(p.e),
        }),
      ),
    }
  }
  return {
    key,
    label: input.label,
    sign: input.sign ?? '',
    value: input.value ?? new Decimal(1),
    children: [],
  }
}

/**数值点根节点:公式输入 → 初始值 → 效果明细(含cap的前后值) */
function pointNode(def: ValuePointDef, ctx: EffectContext): StatNode {
  const key = `${def.id}:${layerKey(ctx.pos)}:${ctx.id}`
  const base = def.base ? def.base(ctx) : new Decimal(1)
  const trace = effectTrace(def.id, base, ctx)
  const children: StatNode[] = []
  for (const input of def.statInputs?.(ctx) ?? []) {
    children.push(inputNode(input, `${key}:in:${input.label}`, ctx))
  }
  if (!base.eq(1)) {
    children.push({ key: `${key}:init`, label: '初始值', sign: '', value: base, children: [] })
  }
  for (const s of trace.steps) {
    const isCap = s.e.type == 'cap'
    //没咬住的软上限(前后值相同)不显示:否则每个维度都会挂一条
    if (isCap && s.after.eq(s.before)) continue
    //cap节点只写"名称 原值 → 新值"(高度进说明),阈值/幂次在展开的参数槽位里看
    children.push(
      effectNode({
        label: s.e.name ?? s.e.id,
        sign: isCap ? '' : opSign(s.e.type),
        value: isCap ? s.after : s.value,
        text: isCap ? `${format(s.before)} → ${format(s.after)}` : undefined,
        note: isCap
          ? `高度${s.e.height ?? 0}`
          : s.e.type == 'custom'
            ? `${format(s.before)} → ${format(s.after)}`
            : undefined,
        key: `${key}:${s.e.id}`,
        ctx,
        params: effectParams(s.e),
      }),
    )
  }
  const label = typeof def.label == 'function' ? def.label(ctx) : def.label
  return { key, label, sign: def.sign ?? '', value: trace.total, children }
}

/**所选层级的加成树(按数值点声明的分组派生) */
export function buildLayerNodes(pos: LayerId): StatNode[] {
  const nodes: StatNode[] = []
  for (const def of statPoints('dimension')) {
    for (let id = 0; id < DIMENSION_COUNT; id++) nodes.push(pointNode(def, { pos, id }))
  }
  for (const def of statPoints('layer')) nodes.push(pointNode(def, { pos, id: 0 }))
  for (const def of statPoints('buyable')) {
    for (const b of getBuyables(getLayerOrder(pos))) nodes.push(pointNode(def, { pos, id: b.id }))
  }
  return nodes
}

/**全局(层级无关)加成树 */
export function buildGlobalNodes(): StatNode[] {
  return statPoints('once').map((def) => pointNode(def, DEFAULT_CONTEXT))
}
