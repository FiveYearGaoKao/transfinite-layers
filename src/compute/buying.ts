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

/**总成本近似时参与求和的末项数(超指数增长下前项可忽略) */
const SUM_TERMS = 3

/**购买k个的总成本(取最后几项近似，k较小时精确) */
export function sumCost(item: BuyableItem, k: Decimal): Decimal {
  if (k.lte(0)) return new Decimal(0)
  const n0 = item.amount()
  let start = k.sub(SUM_TERMS)
  if (start.lt(0)) start = new Decimal(0)
  let total = new Decimal(0)
  let i = start
  while (i.lt(k)) {
    total = total.add(item.cost(n0.add(i)))
    i = i.add(1)
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
