//"预算→可购买数量"的通用闭式估算(维度与可购买共用同一骨架)
//步骤:总预算 →(公比折算)末项预算 →(价格数值点求逆)未套加成的原始价 →(曲线求逆)数量 →折算成"还能买几个"
//契约:估算只当搜索锚点(见tools/bisect),偏差只影响迭代次数,不影响正确性
import Decimal from 'break_eternity.js'
import { lastTermBudget } from '@/tools/geometricSum'
import { invertAt, type EffectContextInput } from './effects'
import type { Curve } from './curves'

/**估算时给"总成本→末项"的折算留的余量(>1):宁可略大,偏大只多迭代几次 */
const ESTIMATE_SAFETY = new Decimal(1.1)

/**
 * 通用估算:给定价格曲线与价格数值点,估算"当前预算下还能买几个"
 * @param curve 价格曲线(正向/逆向同源)
 * @param pricePoint 价格数值点id(用于把预算还原成"未套加成/软上限的原始价")
 * @param ctx 计算上下文(层级与物品id)
 * @param budget 总预算
 * @param owned 已购数量
 * @returns 可购买数量的估算(与sumCost口径一致,即"还能再买几个");不可估算时返回undefined(退回通用搜索)
 */
export function estimateCount(
  curve: Curve,
  pricePoint: string,
  ctx: EffectContextInput,
  budget: Decimal,
  owned: Decimal,
): Decimal | undefined {
  if (!budget.gt(0)) return new Decimal(0)
  //末项折算只在公比恒定时成立(如维度价格与加速器价格);其余直接用总预算(乐观锚点)
  const ratio = curve.ratio?.(ctx)
  const target = ratio && ratio.gt(1) ? lastTermBudget(budget, ratio, ESTIMATE_SAFETY) : budget
  if (!target.gt(0)) return undefined
  //价格域求逆:过软上限时还原成"未套软上限的末项价";点上若有custom效果则返回undefined
  const raw = invertAt(pricePoint, target, ctx)
  if (raw == undefined) return undefined
  const nk = curve.inverse(raw, ctx)
  if (nk == undefined) return undefined
  if (!nk.isFinite() || nk.isNan() || !nk.gt(0)) return new Decimal(0)
  const canBuy = nk.floor().sub(owned).add(1)
  //估算落在已购数之下(软上限拐点附近)时返回0——这是合法估算(0个),求解器会据此从0向上搜索;
  //若返回负数会被判为非法估算而丢弃整条锚定路径,反而退化(见tools/bisect)
  return canBuy.gt(0) ? canBuy : new Decimal(0)
}
