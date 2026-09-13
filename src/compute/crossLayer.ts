//跨层重置的数值:门槛/收益指数(惩罚侧)与加成强化(奖励侧)两套底数,以及对应公式
//详见 docs/面向开发者/层级系统.md
//- g = level(上层) − level(最近下层) = levelGap(上层);g=1 时全部公式精确退化为"无跨层"
//- 两套底数是与层级无关的全局槽位,可被知识/无限升级等效果修饰:
//  crossLayer:reward 抬升只让加成更强(不会顺带抬高门槛),crossLayer:penalty 降低则是纯粹的"跨层惩罚减免"
//- 惩罚侧(设 k = penalty^(g-1)):门槛 = K^k(重置需求取k次幂),收益指数 = E/k
//  含义:原来需要 x 下层点数才能换到 y 本层点数,现在需要 x^k 才能换到同样多;
//        也等价于"先把下层点数开k次方,再套用原公式"——代码里保留 (x/K^k)^(E/k) 这一形式,与展示的门槛一致
//- 奖励侧(设 k = reward^(g-1)):加法类(如u9每秒比例) ×k,乘法类(如u1/能量)取 k 次幂(等价于指数×k)
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { CROSS_LAYER_PENALTY_BASE, CROSS_LAYER_REWARD_BASE } from '@/data/constants'
import { slotValue, type EffectContext, type EffectSlot } from './effects'

/**跨层奖励底数槽位(初始2,仅用于加成) */
export const crossLayerRewardSlot: EffectSlot = {
  target: 'crossLayer:reward',
  init: () => CROSS_LAYER_REWARD_BASE,
}
/**跨层惩罚底数槽位(初始4,仅用于重置门槛与收益指数) */
export const crossLayerPenaltySlot: EffectSlot = {
  target: 'crossLayer:penalty',
  init: () => CROSS_LAYER_PENALTY_BASE,
}
/**跨层底数与层级无关,统一用该上下文读取 */
const CROSS_LAYER_CTX: EffectContext = { pos: [0], id: 0 }

/**当前跨层奖励底数(全局) */
export function crossLayerReward(): Decimal {
  return slotValue(crossLayerRewardSlot, CROSS_LAYER_CTX)
}
/**当前跨层惩罚底数(全局) */
export function crossLayerPenalty(): Decimal {
  return slotValue(crossLayerPenaltySlot, CROSS_LAYER_CTX)
}
/**
 * 跨层倍率 base^(g-1)
 * g≤1(无跨层)时返回1,保证无跨层时的数值与引入跨层前完全一致
 */
export function crossLayerFactor(gap: DecimalSource, base: DecimalSource): Decimal {
  const g = new Decimal(gap)
  if (g.lte(1)) return new Decimal(1)
  return new Decimal(base).pow(g.sub(1))
}
/**跨层重置门槛:K^(penalty^(g-1)) */
export function crossLayerThreshold(base: DecimalSource, gap: DecimalSource): Decimal {
  return new Decimal(base).pow(crossLayerFactor(gap, crossLayerPenalty()))
}
/**跨层重置的收益指数:E/penalty^(g-1) */
export function crossLayerExponent(base: DecimalSource, gap: DecimalSource): Decimal {
  return new Decimal(base).div(crossLayerFactor(gap, crossLayerPenalty()))
}
/**加法类加成的跨层强化:value×reward^(g-1) */
export function crossLayerAdditive(value: Decimal, gap: DecimalSource): Decimal {
  return value.mul(crossLayerFactor(gap, crossLayerReward()))
}
/**
 * 乘法类加成的跨层强化:以"指数×reward^(g-1)"的形式给出
 * 等价于对加成数值取 reward^(g-1) 次幂(因为(a^b)^c = a^(bc))
 */
export function crossLayerExponentBonus(exponent: DecimalSource, gap: DecimalSource): Decimal {
  return new Decimal(exponent).mul(crossLayerFactor(gap, crossLayerReward()))
}
