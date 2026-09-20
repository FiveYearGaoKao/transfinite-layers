//维度的计算(只读)
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { c4BoughtOffset, dimensionAmount, getBase } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { softCapValue } from '@/tools/softCap'
import { lastTermBudget } from '@/tools/geometricSum'
import { calculate, registerEffect } from './effects'
import {
  dimSoftCapPower,
  dimSoftCapThreshold,
  softCap,
  softCapInverse,
  softCapThreshold,
} from './softCap'
import './energy'

/**估算时给"总成本→末项"的折算留的余量(>1):宁可略大,偏大只多迭代几次 */
const ESTIMATE_SAFETY = new Decimal(1.1)

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
  //阈值与幂次都经帧内缓存(见compute/softCap):维度产量每帧要对每个维度求值一次,而两者一帧内不变
  value: (_ctx, _base, _amount, current) =>
    softCapValue(current ?? new Decimal(1), dimSoftCapThreshold(), dimSoftCapPower()),
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

/**
 * 维度"在预算内最多能再买多少个"的闭式估算(供maxBuyable做搜索锚点)
 * 依据:0阶维度价格 = base^(a+b·n)(a=id,b=id+1),超出软上限阈值m后被softCapValue拉成
 *       m·(price/m)^p,其对数对n仍然单调,故两支都能反解
 * 推导:
 *   总和 ≈ 末项·r/(r-1),r = base^b(公比,与n无关)
 *   故"末项价格上限" target = budget·(r-1)/r
 *   未过软上限:target = base^(a+b·nk) → nk = (log_base(target) - a)/b
 *   已过软上限:target = softCap(base^(a+b·nk)) → nk = (log_base(softCapInverse(target)) - a)/b
 * 取两支中"更小且为正"的解(过大的一支必然不满足预算),再折算成"还能买几个"
 * 返回值与sumCost的第2参数同口径(即"还能再买几个"),可直接作为maxSatisfying的锚点
 * 注:公式族(价格公式/软上限参数)变更时必须同步检查本函数;估算偏差不会算错,只会多迭代几次
 * @param budget 总预算
 * @returns 可购买数量的估算;买不起任何1个时返回0
 */
export function dimensionSumEstimate(
  layer: LayerId,
  id: number,
  budget: Decimal,
): Decimal | undefined {
  if (!DIMENSIONS[getLayerOrder(layer)]?.cost) return undefined
  if (!budget.gt(0)) return new Decimal(0)
  const base = new Decimal(getBase())
  if (!base.gt(1)) return undefined
  const a = new Decimal(id)
  const b = new Decimal(id + 1)
  const ratio = base.pow(b)
  const target = lastTermBudget(budget, ratio, ESTIMATE_SAFETY)
  if (!target.gt(0)) return new Decimal(0)
  const logBaseTarget = target.log(base)
  //支1:未过软上限
  const nkPlain = logBaseTarget.sub(a).div(b)
  //支2:已过软上限。价格 = softCap(base^(a+b·n)),故直接套软上限的逆再由价格反解n
  //(逆运算对任意p>0成立,见compute/softCap的softCapInverse)
  let nkCapped = new Decimal(-1)
  const m = softCapThreshold()
  if (target.gt(m)) {
    const uncapped = softCapInverse(target)
    if (uncapped && uncapped.gt(0)) {
      nkCapped = uncapped.log(base).sub(a).div(b)
    }
  }
  //取"为正的解中最小的那个"(未过软上限的解更小;两支都非正说明连1个都买不起)
  let nk: Decimal
  if (nkPlain.gt(0) && nkCapped.gt(0)) nk = Decimal.min(nkPlain, nkCapped)
  else if (nkPlain.gt(0)) nk = nkPlain
  else if (nkCapped.gt(0)) nk = nkCapped
  else return new Decimal(0)
  //可买数量 = 目标末项下标 - 首项下标 + 1,再折算成"还能买几个"(见compute/buying的sumCost约定)
  //注:估算落在已购数之下(softCap拐点附近)时返回0——这是合法估算(0个),求解器会据此从start向上搜索;
  //   若返回负数会被判为非法估算而丢弃整条锚定路径,反而退化(见tools/bisect)
  const owned = dimensionAmount(layer, id, 1)
  const canBuy = nk.floor().sub(owned).add(1)
  return canBuy.gt(0) ? canBuy : new Decimal(0)
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
