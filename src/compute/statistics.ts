//统计页的加成树节点构建(只读计算)
//层级加成:每维度一棵"产量树"(初始值→维度乘数→维度指数→最终加成)
//全局加成:psdSpeed/quizCooldown,初始值非1时显示初始值子节点
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { DIMENSION_COUNT } from '@/data/constants'
import { dimensionAmount } from '@/access'
import {
  LAYER0_CAP_THRESHOLD,
  dimensionExponent,
  dimensionMultiplier,
  productionPerSecond,
} from './dimensions'
import { resetGainBase } from './prestige'
import {
  calculate,
  effectBreakdown,
  slotBreakdown,
  type EffectSlot,
  type EffectType,
  type RegisteredEffect,
} from './effects'
import { isLayer0 } from '@/tools/ordinal'
import { format } from '@/tools/format'

/**统计明细的可折叠树节点 */
export interface StatNode {
  key: string
  label: string
  sign: string
  value: Decimal
  children: StatNode[]
}

/**数值点定义(用于全局加成) */
interface StatTargetDef {
  target: string
  /**总值前显示的符号 */
  sign: string
  label: (id: number) => string
  /**计算时的初始值(缺省1) */
  base?: () => Decimal
}

/**效果作用方式的符号 */
function opSign(type: EffectType): string {
  return type == 'mul' ? 'x' : type == 'add' ? '+' : type == 'exp' ? '^' : ''
}

/**效果来源明细转节点列表 */
function effectNodes(
  parts: { e: RegisteredEffect; value: Decimal }[],
  parentKey: string,
  pos: LayerId,
  id: number,
): StatNode[] {
  return parts.map((p) => {
    const key = `${parentKey}:${p.e.id}`
    const children: StatNode[] = []
    if (p.e.base) children.push(statSlot(p.e.base, '底数', `${key}:base`, pos, id))
    if (p.e.amount) children.push(statSlot(p.e.amount, '数量', `${key}:amount`, pos, id))
    return { key, label: p.e.name ?? p.e.id, sign: opSign(p.e.type), value: p.value, children }
  })
}

/**槽位节点:初始值 + 各修饰来源 */
function statSlot(
  slot: EffectSlot,
  label: string,
  key: string,
  pos: LayerId,
  id: number,
): StatNode {
  const ctx = { pos, id }
  const b = slotBreakdown(slot, ctx)
  return {
    key,
    label,
    sign: '',
    value: b.total,
    children: [
      {
        key: `${key}:init`,
        label: '初始值',
        sign: '',
        value: new Decimal(slot.init(ctx)),
        children: [],
      },
      ...effectNodes(b.parts, key, pos, id),
    ],
  }
}

/**根节点:初始值非1时显示"初始值"子节点(如答题冷却的3600) */
function statRoot(sd: StatTargetDef, id: number, pos: LayerId): StatNode {
  const ctx = { pos, id }
  const base = sd.base ? sd.base() : new Decimal(1)
  const key = `${sd.target}:${id}`
  const b = effectBreakdown(sd.target, ctx, base)
  const children: StatNode[] = []
  if (!base.eq(1)) {
    children.push({ key: `${key}:init`, label: '初始值', sign: '', value: base, children: [] })
  }
  children.push(...effectNodes(b.parts, key, pos, id))
  return { key, label: sd.label(id), sign: sd.sign, value: b.total, children }
}

/**
 * 维度产量节点:初始值(维度总数)→维度乘数→维度指数→最终加成(production效果)
 * 各层统一;点数获取由独立的"点数获取"树展示
 */
function productionNode(pos: LayerId, id: number): StatNode {
  const ctx = { pos, id }
  const key = `production:${id}`
  const amount = dimensionAmount(pos, id)
  const mult = dimensionMultiplier(pos, id)
  const exponent = dimensionExponent(pos, id)
  const multExpBase = amount.mul(mult).pow(exponent)
  const children: StatNode[] = [
    { key: `${key}:init`, label: '维度总量', sign: '', value: amount, children: [] },
    {
      key: `${key}:mult`,
      label: '维度乘数',
      sign: 'x',
      value: mult,
      children: effectNodes(
        effectBreakdown('dimensionMult', ctx, new Decimal(1)).parts,
        `${key}:mult`,
        pos,
        id,
      ),
    },
    {
      key: `${key}:exp`,
      label: '维度指数',
      sign: '^',
      value: exponent,
      children: effectNodes(
        effectBreakdown('dimensionExponent', ctx, new Decimal(1)).parts,
        `${key}:exp`,
        pos,
        id,
      ),
    },
    ...effectNodes(effectBreakdown('production', ctx, multExpBase).parts, `${key}:fin`, pos, id),
  ]
  return {
    key,
    label: `维度${id + 1}产量`,
    sign: '',
    value: productionPerSecond(pos, id),
    children,
  }
}

/**
 * "点数获取"树:初始值(层0=维度1产量,层1+=重置收益基础值)→点数获取效果(加倍器/点数作用/深度加成等)
 * 软上限(custom效果)单独列出实际缩减比例
 */
function pointsGainNode(pos: LayerId): StatNode {
  const ctx = { pos, id: 0 }
  const key = 'pointsGain:0'
  //初始值:层0为维度1原始产量(不含点数获取),层1+为重置收益基础值
  let base: Decimal
  if (isLayer0(pos)) {
    base = dimensionAmount(pos, 0).mul(dimensionMultiplier(pos, 0)).pow(dimensionExponent(pos, 0))
    base = calculate('production', ctx, base)
  } else {
    base = resetGainBase(pos)
  }
  const b = effectBreakdown('pointsGain', ctx, base)
  const normal = b.parts.filter((p) => p.e.type != 'custom')
  const children: StatNode[] = [
    { key: `${key}:init`, label: '初始值', sign: '', value: base, children: [] },
    ...effectNodes(normal, key, pos, 0),
  ]
  //软上限(custom效果)的实际缩减比例:软上限前(普通加成后) vs 软上限后的最终值
  if (b.parts.some((p) => p.e.type == 'custom')) {
    const before = normal.reduce(
      (acc, p) => (p.e.type == 'add' ? acc.add(p.value) : acc.mul(p.value)),
      base,
    )
    children.push({
      key: `${key}:softcap`,
      label: `点数生产软上限(${format(new Decimal(LAYER0_CAP_THRESHOLD), 0)})`,
      sign: 'x',
      value: b.total.div(before),
      children: [],
    })
  }
  return { key, label: '点数获取', sign: '+', value: b.total, children }
}

/**所选层级的加成树(每维度一棵产量树 + 一棵点数获取树) */
export function buildLayerNodes(pos: LayerId): StatNode[] {
  const nodes = Array.from({ length: DIMENSION_COUNT }, (_, id) => productionNode(pos, id))
  nodes.push(pointsGainNode(pos))
  return nodes
}

/**全局(层级无关)加成树 */
export function buildGlobalNodes(): StatNode[] {
  const defs: StatTargetDef[] = [
    { target: 'psdSpeed', sign: 'x', label: () => '全局速度' },
    {
      target: 'quizCooldown',
      sign: '',
      base: () => new Decimal(3600),
      label: () => '答题冷却(秒)',
    },
    { target: 'knowledgeGain', sign: 'x', label: () => '知识获取' },
  ]
  return defs.map((sd) => statRoot(sd, 0, [0]))
}
