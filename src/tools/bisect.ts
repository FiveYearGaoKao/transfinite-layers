//递增函数的最大满足点二分
//求最大的"数量" k 使 f(k) <= budget;f 需单调不减、取值非负
//对 k 本身二分需要 O(log k) 次求值(k 可达 10^^10^15 量级,不可行),
//故改为对"高度" t = slog10(k) 二分:k(t) = Decimal.tetrate(10, t),t 为 double ∈ [0, 1.79e308],
//任意层的 k 都能覆盖,且 tetrate 在高层走"层速算"分支(约5次内部迭代即返回,见 break_eternity 源码)
//Decimal 由 sign/layer/mag 组成,各为 64 位浮点,全值域至多 2^(64*2+1) 种可表示值,
//本二分设计上界约 80 次 f 求值(倍增<=12 + 高度二分<=52 + 末段精修<=12),各循环另有 64 次防御上限
//129 即信息论下界(sign 1 位 + layer/mag 各 64 位)
//弃用 break_eternity 的 increasingInverse:其默认 120 次内部求值、步长收敛为启发式、
//返回实数近似而非最大整数(仍需 floor+验证),与本二分相比无优势
import Decimal from 'break_eternity.js'

/**高度 t 的上限:tetrate(10, t) 的层数不得超过 Number.MAX_VALUE(约 1.79e308) */
const MAX_HEIGHT = 1.79e308

/**
 * 递增函数的最大满足点:返回最大的 k >= start 使 f(k) <= budget
 * @param f 单调不减的"价格/目标"函数(如购买 k 个的总成本、第 k 次完成的目标值)
 * @param budget 预算/资源上限
 * @param start 搜索下界(已购数量/当前完成次数),缺省 0
 */
export function maxSatisfying(
  f: (k: Decimal) => Decimal,
  budget: Decimal,
  start: Decimal = new Decimal(0),
): Decimal {
  //阶段0:平凡情形(起点即不可行 / 一个都买不起)
  if (start.lt(0)) start = new Decimal(0)
  const sat = (k: Decimal): boolean => {
    const y = f(k)
    //NaN/∞ 视为不可满足(防御价格溢出)
    return !y.isNan() && y.lte(budget)
  }
  if (!sat(start) || !sat(start.add(1))) return start

  //阶段1:在高度 t 上倍增(平方级)求上界,覆盖任意层级的答案
  let tLo = 0
  let tHi = 1
  if (sat(Decimal.tetrate(10, tHi))) {
    tLo = tHi
    tHi = 2
    for (let i = 0; i < 64; ++i) {
      if (!sat(Decimal.tetrate(10, tHi))) break
      tLo = tHi
      tHi = tHi * tHi
      if (tHi > MAX_HEIGHT) {
        tHi = MAX_HEIGHT
        //到顶仍可负担:答案超出可表示范围,返回该高度下的最大值
        if (sat(Decimal.tetrate(10, tHi))) return Decimal.tetrate(10, tHi)
        break
      }
    }
  }

  //阶段2:在 [tLo, tHi] 上二分高度(几何平均=对数域中点;tLo=0 时退化为普通对分)
  for (let i = 0; i < 64; ++i) {
    const tMid = tLo === 0 ? tHi / 2 : Math.sqrt(tLo) * Math.sqrt(tHi)
    if (tMid === tLo || tMid === tHi) break
    if (sat(Decimal.tetrate(10, tMid))) tLo = tMid
    else tHi = tMid
  }

  //阶段3:精修到数量域,保证边界精确
  let lo = Decimal.tetrate(10, tLo).floor()
  if (lo.lt(start)) lo = start
  let hi = Decimal.tetrate(10, tHi)
  if (hi.lte(lo) || sat(hi) || hi.isNan()) return lo //触顶/异常时返回当前下界
  if (lo.layer <= 0) {
    //层0:整数二分(间隔有界,至多约12次)
    hi = hi.ceil()
    for (let i = 0; i < 64; ++i) {
      if (hi.sub(lo).lte(1)) break
      const mid = lo.add(hi).div(2).floor()
      if (mid.eq(lo) || mid.eq(hi)) break
      if (sat(mid)) lo = mid
      else hi = mid
    }
    //保险:层边界附近 lo/hi 混合层算术有 1-2 个单位的舍入偏差,向上补足到真正最大
    //(层>=1 时 lo.add(1)==lo 自动跳过,不额外求值)
    let fix = 0
    while (fix++ < 256 && !lo.add(1).eq(lo) && sat(lo.add(1))) lo = lo.add(1)
    return lo
  }
  //层>=1:(层, mag) 上二分,终止于 Decimal 粒度(相邻整数本就不可区分)
  for (let i = 0; i < 64; ++i) {
    const mid = layerMagMid(lo, hi)
    if (mid.eq(lo) || mid.eq(hi)) break
    if (sat(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/**构造 (lo, hi) 之间的代表值:同层取 mag 中点;跨层取层数中点(防御,正常不会触发) */
function layerMagMid(lo: Decimal, hi: Decimal): Decimal {
  if (hi.layer > lo.layer) {
    const midLayer = Math.floor((lo.layer + hi.layer) / 2)
    if (midLayer <= lo.layer) {
      return Decimal.fromComponents(1, hi.layer, (15.954 + hi.mag) / 2)
    }
    return Decimal.fromComponents(1, midLayer, 9e15)
  }
  return Decimal.fromComponents(1, lo.layer, (lo.mag + hi.mag) / 2)
}
