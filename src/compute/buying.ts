//统一的购买数量计算
//任何"可购买项"(维度/可购买)只需提供价格函数,即可复用总成本计算和最大购买数量
import Decimal from 'break_eternity.js'
import { maxSatisfying } from '@/tools/bisect'

/**可购买项:提供价格函数 */
export interface BuyableItem {
  /**当前已购数量 */
  amount(): Decimal
  /**已购n个时下一个的价格 */
  cost(n: Decimal): Decimal
}

/**至多求和的项数 */
const SUM_TERMS = 3

/**允许的相对误差 */
const SUMCOST_EPS = 1e-2

/**购买k个的总成本(从后往前求和，k较小时精确) */
export function sumCost(item: BuyableItem, k: Decimal): Decimal {
  if (k.lte(0)) return new Decimal(0)
  const n0 = item.amount()
  const nk = n0.add(k).sub(1)
  let total = new Decimal(0)
  let i = new Decimal(0)
  while (i.lt(SUM_TERMS) && i.lt(k)) {
    const last = item.cost(nk.sub(i))
    total = total.add(last)
    i = i.add(1)
    //如果最后一项占当前总价格的比例小于固定值，就直接跳过
    if (last.lte(total.mul(SUMCOST_EPS))) break
  }
  return total
}

/**
 * 在预算内最多可购买数量
 * 由 maxSatisfying 在"高度域"二分求解:对数量本身二分需 O(log k) 次,
 * 高度域二分至多约 129 次价格求值且不随答案数量级增长(旧实现的边际修正已无需保留)
 * 总成本取 sumCost 的末项近似,故允许少量误差(与旧实现一致)
 */
export function maxBuyable(item: BuyableItem, budget: Decimal): Decimal {
  return maxSatisfying((k) => sumCost(item, k), budget)
}
