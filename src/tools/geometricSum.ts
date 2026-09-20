//几何级数求和与求逆的纯函数工具(无存档/效果依赖,故置于tools)
//用途:增量游戏里"价格按固定公比增长"的可购买项,其"买k个的总成本"与"预算内最多买几个"
//都有闭式解,不必逐项相加,也不必二分。相关推导见docs/面向开发者/性能.md与compute/buying.ts
import Decimal from 'break_eternity.js'

/**
 * 几何级数的和:末项为last、公比为ratio、共k项
 * 和 = last·(1 + 1/ratio + 1/ratio² + … + 1/ratio^(k-1)) = last·ratio/(ratio-1)·(1 - ratio^-k)
 * @param last 末项(第k项)
 * @param ratio 公比r>1
 * @param k 项数(>=1)
 * @returns 和;ratio<=1或非有限时返回last(退化为不放大)
 */
export function geometricSum(last: Decimal, ratio: Decimal, k: Decimal): Decimal {
  if (!ratio.gt(1) || !ratio.isFinite()) return last
  const correction = ratio.pow(k.neg())
  return last.mul(ratio.div(ratio.sub(1))).mul(new Decimal(1).sub(correction))
}

/**
 * 把"总和预算"折算成"末项预算":last = budget·(ratio-1)/ratio
 * @param budget 总和预算
 * @param ratio 公比r>1
 * @param safety 安全系数(>=1):估算宁可略大,偏大只多迭代几次搜索
 */
export function lastTermBudget(
  budget: Decimal,
  ratio: Decimal,
  safety: Decimal = new Decimal(1),
): Decimal {
  if (!ratio.gt(1) || !ratio.isFinite()) return budget
  return budget.mul(ratio.sub(1)).div(ratio).mul(safety)
}
