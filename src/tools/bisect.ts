//递增函数的"最大可满足计数"二分
//求最大的 k ≥ 0 使 g(k) ≤ budget,其中 g 由调用方给出(通常 g(k) = f(base + k),见下方 origin 说明)
//
//**origin(第三参数,名字沿用旧版的start/base)是"原点",不是可行点**:求值按 g(k)=f(origin+k) 进行,
//  返回的是**相对origin的增量 k**。这样约定的原因是:
//    f(origin) 是"一次性买origin个的花费"(可购买项)或"第origin次完成的目标"(挑战),
//    它往往远大于预算,不能当作可行性依据;真正恒可行的下界是 k=0(买0个的花费为0)。
//  例:层0维度已购493、预算1e1600时,f(493)=10^3144(不可行)但f(1)=10^853(可行),
//      正确答案是"还能买196个"(即绝对计数689)——必须从k=0开始搜索才能得到它。
//为什么用"倍增"找上界而不能一次跳跃:
//  价格过软上限后,每多买1个的价格相对增幅可达1e14量级,可行计数集合可能窄到只有1个单位。
//  任何一次性大跳都会整段跃过这个窄窗口,而倍增法逐个越过每个2的幂,必然落在真实窗口上。
//估算的作用:只用于把"原点"抬高到估算位置(估算不可行时则作为"不可行上界"),
//  两条路都保持严格正确——估算偏差只影响求值次数。
import Decimal, { type DecimalSource } from 'break_eternity.js'

/**各种搜索循环的防御上限 */
const LOOP_CAP = 64

/**
 * 递增函数的最大可满足计数:返回最大的 k ≥ 0 使 g(k) = f(origin + k) ≤ budget
 * 一个都不可满足时返回0
 * @param f 单调不减的"绝对计数→花费/目标"函数(如购买n个的总成本、第n次完成的目标)
 * @param budget 预算/资源上限
 * @param origin 原点(已购数量/当前完成次数),缺省 0
 * @param estimate 可选的"数量级估算":接近答案的**绝对计数**(偏大偏小都可,只影响迭代次数)
 */
export function maxSatisfying(
  f: (k: Decimal) => Decimal,
  budget: Decimal,
  origin: Decimal = new Decimal(0),
  estimate?: DecimalSource,
): Decimal {
  if (origin.lt(0)) origin = new Decimal(0)
  const g = (k: Decimal) => f(origin.add(k))
  const e = estimate != null ? new Decimal(estimate).floor() : null
  if (e && !e.isNan() && e.isFinite() && e.gt(origin)) {
    const rel = e.sub(origin)
    if (satisfies(g, budget, rel)) {
      //估算可行:从估算继续向上倍增(估算偏小)
      const hi = grow(g, budget, rel)
      return hi == null ? rel : refineInteger(g, budget, rel, hi)
    }
    //估算偏大:它是合法的不可行上界,与原点(恒可行)组成包围圈
    return refineInteger(g, budget, new Decimal(0), rel)
  }
  return searchMax(g, budget)
}

/**
 * 判定某计数是否可满足(花费/目标不超预算)
 * NaN/∞ 视为不可满足(防御价格溢出)
 */
function satisfies(g: (k: Decimal) => Decimal, budget: Decimal, k: Decimal): boolean {
  const y = g(k)
  return !y.isNan() && y.lte(budget)
}

/**
 * 从0(恒可行)起倍增,找到第一个不可行点,再整数二分精修
 * 倍增64次即覆盖到2^64;若一路都可行(答案超出可表示范围),返回最后的lo
 */
function searchMax(g: (k: Decimal) => Decimal, budget: Decimal): Decimal {
  let lo = new Decimal(0)
  let hi = new Decimal(1)
  for (let i = 0; i < LOOP_CAP; ++i) {
    if (!satisfies(g, budget, hi)) return refineInteger(g, budget, lo, hi)
    lo = hi
    const next = hi.mul(2)
    if (!next.gt(hi)) return lo //已达可表示上界且仍可满足
    hi = next
  }
  return hi
}

/**
 * 从from(已知可行)向上找第一个不可行点
 * @returns 不可行点;达到可表示粒度上限时返回null
 */
function grow(g: (k: Decimal) => Decimal, budget: Decimal, from: Decimal): Decimal | null {
  let lo = from
  for (let i = 0; i < LOOP_CAP; ++i) {
    const next = lo.mul(2)
    if (!next.gt(lo)) return null
    if (!satisfies(g, budget, next)) return next
    lo = next
  }
  return null
}

/**
 * 整数域精修:kLo已知满足、kHi已知不满足,二分求最大的满足点
 * 注:lo+1 == lo(超出Decimal可表示粒度)时无法再分辨,直接返回lo
 */
function refineInteger(
  g: (k: Decimal) => Decimal,
  budget: Decimal,
  lo: Decimal,
  hi: Decimal,
): Decimal {
  for (let i = 0; i < LOOP_CAP; ++i) {
    if (hi.sub(lo).lte(1)) break
    const mid = lo.add(hi).div(2).floor()
    if (mid.lte(lo) || mid.gte(hi)) break
    if (satisfies(g, budget, mid)) lo = mid
    else hi = mid
  }
  //防御:层边界附近可能有1~2个单位的舍入偏差,向上补足到真正最大
  //(hi已不满足,故至多补到hi-1;层>=1时 lo.add(1)==lo 自动跳过)
  let guard = 0
  while (guard++ < 256 && !lo.add(1).eq(lo) && satisfies(g, budget, lo.add(1))) lo = lo.add(1)
  return lo
}
