//维度的计算(只读)
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { c4BoughtOffset, dimensionAmount, getBase } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { softCapValue } from '@/tools/softCap'
import { calculate, registerEffect, slotValue } from './effects'
import { softCap } from './softCap'
import './energy'

/**维度生产软上限:阈值与强度(产量超过阈值后增长变缓) */
export const DIM_CAP_THRESHOLD = Number.MAX_VALUE
export const DIM_CAP_POWER = 0.75

//维度生产软上限注册为production目标上的custom效果(custom优先级最高,天然在其它点数获取加成之后生效)
//幂次取自softCap:power槽位(与价格软上限共用):ic4把该槽位平方(0.75→0.75²)、iu52削弱它,两处软上限因此同步变化
registerEffect({
  id: 'dimension-softcap',
  name: '维度生产软上限',
  target: 'production',
  type: 'custom',
  value: (ctx, _base, _amount, current) =>
    softCapValue(
      current ?? new Decimal(1),
      slotValue({ target: 'dimSoftCap:base', init: () => DIM_CAP_THRESHOLD }, ctx),
      slotValue({ target: 'softCap:power', init: () => DIM_CAP_POWER }, ctx),
    ),
  //isActive: (ctx) => isLayer0(ctx.pos) && ctx.id == 0,
  text: '软上限 x{value}',
})

interface dimensionInfo {
  cost: (layer: LayerId, id: number, n: Decimal) => Decimal
}

/**不同层级维度的公式 */
export const DIMENSIONS: dimensionInfo[] = [
  {
    cost(_layer: LayerId, id: number, n: Decimal): Decimal {
      // 价格公式为 B^(a+b*n)
      const base = new Decimal(id)
      const increment = new Decimal(id + 1)
      return new Decimal(getBase()).pow(increment.mul(n).add(base))
    },
  },
]

/**已购n个时某维度的价格 */
export function dimensionCostAt(layer: LayerId, id: number, n: Decimal): Decimal {
  //按阶精确取公式行:阶未定义时价格为无穷(不可购买),不静默兜底到低阶公式
  const formula = DIMENSIONS[getLayerOrder(layer)]?.cost
  if (!formula) return Decimal.dInf
  //挑战C4的偏移量含同批已买次数,见c4BoughtOffset(非C4时n原样)
  const owned = dimensionAmount(layer, id, 1)
  const n2 = c4BoughtOffset(layer, owned, n)
  const base = softCap(formula(layer, id, n2))
  return calculate('dimensionCost', { pos: layer, id }, base)
}
/**获取某维度的价格 */
export function dimensionCost(layer: LayerId, id: number): Decimal {
  return dimensionCostAt(layer, id, dimensionAmount(layer, id, 1))
}
/**获取某维度的乘数 */
export function dimensionMultiplier(layer: LayerId, id: number): Decimal {
  return calculate('dimensionMult', { pos: layer, id }, new Decimal(1))
}
/**获取某维度的指数 */
export function dimensionExponent(layer: LayerId, id: number): Decimal {
  return calculate('dimensionExponent', { pos: layer, id }, new Decimal(1))
}
/**每秒产量 */
export function productionPerSecond(layer: LayerId, id: number): Decimal {
  let value = dimensionAmount(layer, id)
    .mul(dimensionMultiplier(layer, id))
    .pow(dimensionExponent(layer, id))
  value = calculate('production', { pos: layer, id }, value)
  //层级0的维度1产量即点数获取,统一在pointsGain目标应用(含软上限custom效果)
  if (isLayer0(layer) && id == 0) {
    value = calculate('pointsGain', { pos: layer, id }, value)
  }
  return value
}
