//维度的计算(只读)
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { c4BoughtOffset, dimensionAmount, getBase } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { softCapValue } from '@/tools/softCap'
import { calculate, registerEffect } from './effects'
import { softCap } from './softCap'
import './energy'

/**层级0点数生产软上限:阈值与强度(产量超过阈值后增长变缓,减缓逼近1.79e308终局) */
export const LAYER0_CAP_THRESHOLD = 1e300
export const LAYER0_CAP_POWER = 0.5

//层级0维度1的产量软上限注册为pointsGain目标上的custom效果(custom优先级最高,天然在其它点数获取加成之后生效)
registerEffect({
  id: 'layer0-softcap',
  name: '点数生产软上限',
  target: 'pointsGain',
  type: 'custom',
  value: (_ctx, _base, _amount, current) =>
    softCapValue(current ?? new Decimal(1), new Decimal(LAYER0_CAP_THRESHOLD), LAYER0_CAP_POWER),
  isActive: (ctx) => isLayer0(ctx.pos) && ctx.id == 0,
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
  const order = Math.min(getLayerOrder(layer), DIMENSIONS.length - 1)
  const formula = DIMENSIONS[order]?.cost
  if (!formula) return Decimal.dInf
  //挑战C4:购买任何东西都使价格视为多购买1次(偏移量=本层购买总数)
  const n2 = c4BoughtOffset(layer, n)
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
