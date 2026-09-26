//统一的购买数量计算
//任何"可购买项"(维度/可购买/知识升级)只需提供价格函数,即可复用总成本计算和最大购买数量
//契约(见docs/面向开发者/性能.md):
//- sum/sumInverse是**可选加速声明**:省略即退回通用路径,偏差只影响迭代次数,不影响正确性
//- sum允许近似,但相对误差必须<1%:线性/几何/常量族精确,幂族用积分近似,
//  省略sum时用"末两项几何闭式"(对公比恒定的价格精确,对已过软上限的价格也足够)
//- 价格经加成管道(如dimensionCost/buyableCost)的物品要声明sumInverse=priceCountAnchor;
//  不经管道的物品(知识升级)直接用curve.sumInverse
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { getLayer } from '@/access'
import { isLayer0 } from '@/tools/ordinal'
import { maxSatisfying } from '@/tools/bisect'
import { invertAt, type EffectContextInput } from './effects'
import type { Curve } from './curves'

/**
 * 防呆:这次购买会不会让层级0再也无法产出
 * 条件:层级0 + 买完后本层没有任何维度(没有任何产出) + 买完剩下的点数买不起维度1
 * (维度1的价格恒为 base^0 = 1,故"剩下点数<1"就等于"再也买不起任何东西")
 * 典型案例:无限升级iu22把加倍器基础价降到1,在"无限重置后的1点开局"买它会直接花光点数
 * 注:买维度本身不受此限(买下维度正是恢复产出的唯一手段)
 * @param remaining 购买后本层剩下的点数
 */
export function purchaseStallsLayer0(layer: LayerId, remaining: Decimal): boolean {
  if (!isLayer0(layer) || remaining.gte(1)) return false
  const L = getLayer(layer)
  return L != undefined && L.dimensions.every((d) => d[0].eq(0))
}

/**
 * 几何级数的和:末项为last、公比为ratio、共k项
 * 和 = last·(1 + 1/ratio + 1/ratio² + …) = last·ratio/(ratio-1)·(1 - ratio^-k)
 * 这里只拿得到末项与前一项(再往前要额外求值),故不复用Decimal.sumGeometricSeries(它要首项)
 * @param last 末项(第k项)
 * @param ratio 公比r>1
 * @param k 项数
 * @returns 和;ratio≤1或非有限时返回last(退化为不放大)
 */
function geometricSum(last: Decimal, ratio: Decimal, k: Decimal): Decimal {
  if (!ratio.gt(1) || !ratio.isFinite()) return last
  return last.mul(ratio.div(ratio.sub(1))).mul(Decimal.dOne.sub(ratio.pow(k.neg())))
}

/**可购买项:提供价格函数,并可选地提供解析求和/求逆 */
export interface BuyableItem {
  /**当前已购数量 */
  amount(): Decimal
  /**已购n个时下一个的价格(已过加成管道) */
  cost(n: Decimal): Decimal
  /**
   * 购买k个的总成本(可选)
   * 省略时用末两项几何闭式;相对误差必须<1%(见文件头契约)
   */
  sum?(k: Decimal): Decimal | undefined
  /**
   * 在预算内最多能再买多少个的解析锚点(可选)
   * 允许有偏差:它只作为"解析求解+少量校验"的出发点,偏差只影响迭代次数
   * 返回undefined时退回通用的高度域二分(见tools/bisect)
   */
  sumInverse?(budget: Decimal): Decimal | undefined
}

/**
 * 购买k个的总成本
 * 优先用物品声明的解析和;否则用"末两项几何闭式":
 *   总和 = 末项 · (1 + 1/r + 1/r² + …) = 末项 · r/(r-1) · (1 - r^-k)
 * 只需两次价格求值;公比r>1时截断误差因子 r^-k < 1,软上限区(r可达10^63量级)几乎精确
 * r无法确定(r<=1/非有限/只买1个)时退回两项相加的精确值
 * @param item 可购买项
 * @param k 购买数量
 */
export function sumCost(item: BuyableItem, k: Decimal): Decimal {
  if (k.lte(0)) return Decimal.dZero
  const declared = item.sum?.(k)
  if (declared != undefined) return declared
  const n0 = item.amount()
  const nk = n0.add(k).sub(1)
  const last = item.cost(nk)
  //价格非有限(溢出)时原样返回,交给上层视为"买不起"
  if (!last.isFinite()) return last
  if (last.lte(0)) return Decimal.dZero
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
 * 有解析锚点就先解析求解,再在锚点附近做少量修正(±MAX_REFINE);
 * 修正不收敛(锚点偏差过大)或没有锚点时,退回带锚点的通用搜索
 * 买不起任何一个时返回0
 */
export function maxBuyable(item: BuyableItem, budget: Decimal): Decimal {
  if (budget.lte(0)) return Decimal.dZero
  const anchor = item.sumInverse?.(budget)
  const valid = anchor != undefined && anchor.isFinite() && !anchor.isNan()
  if (valid) {
    const refined = refineBySum(item, anchor.floor(), budget)
    if (refined != undefined) return refined
  }
  const estimate = valid && anchor.gt(0) ? anchor : undefined
  const delta = maxSatisfying((k) => sumCost(item, k), budget, Decimal.dZero, estimate)
  return delta.gt(0) ? delta : Decimal.dZero
}

/**锚点附近允许的修正步数(超过就认为锚点不可信,交给通用搜索) */
const MAX_REFINE = 8

/**
 * 锚点附近的有界修正:返回最大的满足"总成本≤预算"的整数
 * 锚点偏高就逐步下调、偏低就逐步上调;修正不到就返回undefined(退回通用搜索)
 */
function refineBySum(item: BuyableItem, k0: Decimal, budget: Decimal): Decimal | undefined {
  let k = k0.lt(0) ? Decimal.dZero : k0
  if (sumCost(item, k).gt(budget)) {
    for (let i = 0; i < MAX_REFINE; i++) {
      if (k.lte(0)) return Decimal.dZero
      k = k.sub(1)
      if (!sumCost(item, k).gt(budget)) return k
    }
    return undefined
  }
  for (let i = 0; i < MAX_REFINE; i++) {
    const next = k.add(1)
    //超出Decimal可表示粒度时无法再分辨,当前k就是答案
    if (next.eq(k)) return k
    if (sumCost(item, next).gt(budget)) return k
    k = next
  }
  return undefined
}

/**
 * 带软上限管道的价格锚点:总预算 →(价格管道求逆)未套软上限的原始价 →(曲线求逆)数量
 * 价格过软上限后每次只多买1个的相对增幅极大,故"整份预算都花在末项"是很好的乐观锚点
 * 契约:估算只当搜索锚点(见tools/bisect),偏差只影响迭代次数,不影响正确性
 * @param curve 价格曲线(需要声明inverse)
 * @param pricePoint 价格数值点id(把预算还原成原始价)
 * @param ctx 计算上下文(层级与物品id)
 * @param budget 总预算
 * @param owned 已购数量
 * @returns 可购买数量的估算(与sumCost口径一致,即"还能再买几个");不可估算时返回undefined
 */
export function priceCountAnchor(
  curve: Curve,
  pricePoint: string,
  ctx: EffectContextInput,
  budget: Decimal,
  owned: Decimal,
): Decimal | undefined {
  if (!budget.gt(0) || !curve.inverse) return undefined
  //价格域求逆:过软上限时还原成"未套软上限的末项价";点上若有custom效果则返回undefined
  const raw = invertAt(pricePoint, budget, ctx)
  if (raw == undefined) return undefined
  const nk = curve.inverse(raw, ctx)
  if (nk == undefined) return undefined
  if (!nk.isFinite() || nk.isNan() || !nk.gt(0)) return Decimal.dZero
  const canBuy = nk.floor().sub(owned).add(1)
  //估算落在已购数之下(软上限拐点附近)时返回0——这是合法估算(0个),求解器会据此从0向上搜索;
  //若返回负数会被判为非法估算而丢弃整条锚定路径,反而退化(见tools/bisect)
  return canBuy.gt(0) ? canBuy : Decimal.dZero
}
