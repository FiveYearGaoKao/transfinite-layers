//统一的购买数量计算
//任何"可购买项"(维度/可购买)只需提供价格函数,即可复用总成本计算和最大购买数量
import Decimal from 'break_eternity.js'

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

/**二分的迭代上界，防止异常情况下无限循环 */
const MAX_ITER = 1000

/**在预算内最多可购买数量(倍增上界+二分+按边际成本分段修正,允许少量误差) */
export function maxBuyable(item: BuyableItem, budget: Decimal): Decimal {
  const n0 = item.amount()
  const sum = (k: Decimal) => sumCost(item, k)
  //连第一个都买不起则返回0
  if (sum(new Decimal(1)).gt(budget)) return new Decimal(0)
  //倍增上界:从2开始平方,次数约为log2(log2(k))
  let lo = new Decimal(0)
  let hi = new Decimal(2)
  let iter = 0
  while (sum(hi).lte(budget) && iter++ < MAX_ITER) {
    lo = hi
    hi = hi.mul(hi)
    if (hi.eq(lo)) break
  }
  //二分 [lo, hi]，触及Decimal精度极限时自然停止
  iter = 0
  while (hi.sub(lo).gt(1) && iter++ < MAX_ITER) {
    const mid = lo.add(hi).div(2).floor()
    if (mid.eq(lo) || mid.eq(hi)) break
    if (sum(mid).lte(budget)) lo = mid
    else hi = mid
  }
  //分段修正:二分只保证sumCost近似下的最优,用下一个价格的边际成本把剩余预算成块花掉,避免逐1累加
  iter = 0
  while (iter++ < MAX_ITER) {
    if (sum(lo.add(1)).gt(budget)) break
    const step = budget
      .sub(sum(lo))
      .div(item.cost(n0.add(lo)))
      .floor()
      .max(1)
    lo = lo.add(step)
  }
  return lo
}
