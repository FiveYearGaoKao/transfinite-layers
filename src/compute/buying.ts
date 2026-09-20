//统一的购买数量计算
//任何"可购买项"(维度/可购买)只需提供价格函数,即可复用总成本计算和最大购买数量
import Decimal from 'break_eternity.js'
import { maxSatisfying } from '@/tools/bisect'
import { geometricSum } from '@/tools/geometricSum'

/**可购买项:提供价格函数,并可选地提供"总成本的数量级估算" */
export interface BuyableItem {
  /**当前已购数量 */
  amount(): Decimal
  /**已购n个时下一个的价格 */
  cost(n: Decimal): Decimal
  /**
   * 在预算内最多能再买多少个的估算(可选)
   * 允许有数量级误差:它只作为求最大购买数量的搜索锚点,偏差只影响迭代次数,不影响结果
   * 返回undefined时退回通用的高度域二分(见tools/bisect)
   */
  sumEstimate?(budget: Decimal): Decimal | undefined
}

/**
 * 购买k个的总成本
 * 价格按几何级数增长(比值为r = cost(n)/cost(n-1) > 1)时用闭式:
 *   总和 = 末项 · (1 + 1/r + 1/r² + …) = 末项 · r/(r-1) · (1 - r^-k)
 * 只需两次价格求值(末项与其前一项),且对任意k都有上界:截断误差因子 r^-k < 1
 * (旧实现取"末3项"启发式,误差上界同为 r/(r-1);本式在k大时更准、更快,且语义明确:结果就是几何和的精确值)
 * r无法确定(r<=1/非有限/只买1个)时退回两项相加的精确值
 * @param item 可购买项
 * @param k 购买数量
 */
export function sumCost(item: BuyableItem, k: Decimal): Decimal {
  if (k.lte(0)) return new Decimal(0)
  const n0 = item.amount()
  const nk = n0.add(k).sub(1)
  const last = item.cost(nk)
  //价格非有限(溢出)时原样返回,交给上层视为"买不起"
  if (!last.isFinite()) return last
  if (last.lte(0)) return new Decimal(0)
  const prevN = nk.sub(1)
  //只买1个,或末项就是第一项:和式退化为单项
  if (k.lte(1) || prevN.lt(n0)) return last
  const prev = item.cost(prevN)
  if (!prev.isFinite() || prev.lte(0)) return last
  const ratio = last.div(prev)
  //非几何增长(比值<=1/NaN)时退回两项相加(不递归,避免重复求值)
  if (!ratio.isFinite() || ratio.isNan() || !ratio.gt(1)) return last.add(prev)
  return geometricSum(last, ratio, k)
}

/**
 * 在预算内最多"还能再买"多少个
 * 估算只作为锚点;maxSatisfying返回的就是相对已购数的增量(见tools/bisect的origin说明)
 * 买不起任何一个时返回0
 */
export function maxBuyable(item: BuyableItem, budget: Decimal): Decimal {
  if (budget.lte(0)) return new Decimal(0)
  const estimate = item.sumEstimate?.(budget)
  //sumCost的第2个参数就是"还能再买几个"(内部按已购数推算价格下标),故原点取0;
  //估算(sumEstimate)给的是同一个量,直接作为锚点
  const delta = maxSatisfying((k) => sumCost(item, k), budget, new Decimal(0), estimate)
  return delta.gt(0) ? delta : new Decimal(0)
}
