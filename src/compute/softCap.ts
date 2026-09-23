//软上限的参数槽位与读取入口
//价格软上限与维度生产软上限的参数**完全独立**(各两个槽位):iu52只削弱价格,ic4两者都平方
//阈值与幂次都是具名槽位,可被挑战奖励/无限升级等效果修饰;数学实现仍在tools/softCap(纯函数)
import Decimal from 'break_eternity.js'
import { softCapValue } from '@/tools/softCap'
import { defineSlot, slotValue, type EffectContextInput } from './effects'

/**价格软上限的基准阈值 */
const PRICE_CAP_BASE = 1e100
/**价格软上限的基准幂次(对价格对数做幂次放大) */
const PRICE_CAP_POWER = 2
/**维度生产软上限的基准阈值 */
const DIM_CAP_BASE = Number.MAX_VALUE
/**维度生产软上限的基准幂次 */
const DIM_CAP_POWER = 0.75
/**价格软上限的高度:1=对价格对数做幂次放大(维度生产软上限为0,见compute/dimensions) */
export const SOFT_CAP_HEIGHT = 1

/**价格软上限阈值槽位 */
export const SLOT_PRICE_CAP_BASE = defineSlot(
  'priceCap:base',
  () => new Decimal(PRICE_CAP_BASE),
  'global',
)
/**价格软上限幂次槽位 */
export const SLOT_PRICE_CAP_POWER = defineSlot(
  'priceCap:power',
  () => new Decimal(PRICE_CAP_POWER),
  'global',
)
/**维度生产软上限阈值槽位 */
export const SLOT_DIM_CAP_BASE = defineSlot(
  'dimCap:base',
  () => new Decimal(DIM_CAP_BASE),
  'global',
)
/**维度生产软上限幂次槽位 */
export const SLOT_DIM_CAP_POWER = defineSlot(
  'dimCap:power',
  () => new Decimal(DIM_CAP_POWER),
  'global',
)

/**当前价格软上限阈值(被C4奖励提升、被ic4固定为1等) */
export function priceCapThreshold(ctx?: EffectContextInput): Decimal {
  return slotValue(SLOT_PRICE_CAP_BASE, ctx)
}

/**当前价格软上限幂次(被iu52削弱、被ic4平方) */
export function priceCapPower(ctx?: EffectContextInput): Decimal {
  return slotValue(SLOT_PRICE_CAP_POWER, ctx)
}

/**当前维度生产软上限阈值(被ic4固定为1等) */
export function dimCapThreshold(ctx?: EffectContextInput): Decimal {
  return slotValue(SLOT_DIM_CAP_BASE, ctx)
}

/**当前维度生产软上限幂次(被ic4平方;不受iu52影响) */
export function dimCapPower(ctx?: EffectContextInput): Decimal {
  return slotValue(SLOT_DIM_CAP_POWER, ctx)
}

/**对价格应用软上限:低于阈值不处理,高于阈值价格呈超指数增长 */
export function softCapPrice(value: Decimal): Decimal {
  return softCapValue(value, priceCapThreshold(), priceCapPower(), SOFT_CAP_HEIGHT)
}

/**
 * 价格软上限的逆(用于由"预算"反推"未套软上限的价格")
 * 数学依据:softCapValue(x,m,p,h) = layeradd10(h)( (layeradd10(-h)(x)/m)^p · m ),
 * 阈值以下原样返回、阈值以上是幂函数,两者都严格单调,故把幂次换成 1/p、其余参数不变即得逆函数
 * 注:返回值与原值只保证相对误差极小(不是位相等):layeradd10在层1的大mag下有约1e-12量级的精度损失
 * @param value 已套过软上限的值
 * @returns 逆运算结果;不可逆时返回undefined(仅当幂次非正或值非正/非有限)
 */
export function softCapPriceInverse(value: Decimal): Decimal | undefined {
  const p = priceCapPower()
  //可逆条件:幂次必须>0(幂运算的逆仍是幂运算);p<=0时前向不是严格单调,信息已丢失
  if (!p.gt(0)) return undefined
  //域:低于阈值的值前向原样返回,逆也原样返回,天然一致;这里只需挡住0/负/非有限
  if (!value.isFinite() || value.lte(0)) return undefined
  return softCapValue(value, priceCapThreshold(), new Decimal(1).div(p), SOFT_CAP_HEIGHT)
}
