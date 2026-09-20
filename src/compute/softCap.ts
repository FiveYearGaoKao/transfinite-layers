//价格软上限
//维度与加速器价格达到阈值后,对价格对数做幂次放大呈超指数增长;阈值可被挑战奖励(C4)提升,幂次可被无限升级(IU52)削弱
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { softCapValue } from '@/tools/softCap'
import { slotValue, type EffectSlot } from './effects'
import { frameCachedByObject } from './frameCache'

/**软上限的基准阈值 */
const SOFT_CAP_BASE = 1e100
/**软上限后的对数幂次 */
const SOFT_CAP_EXP = 2
/**软上限的高度(见tools/softCap:1=现状,>1把软上限推迟到更高层指数塔) */
export const SOFT_CAP_HEIGHT = 1
/**维度生产软上限的默认幂次(与compute/dimensions的DIM_CAP_POWER一致,此处独立以免循环依赖) */
const DIM_SOFT_CAP_POWER = 0.75

//槽位常量必须模块级:槽位组合值按"槽位对象身份"做帧内缓存,每次新建对象都不会命中(见compute/effects的slotValue)
/**价格软上限的阈值槽位 */
const SLOT_SOFT_CAP_BASE: EffectSlot = { target: 'softCap:base', init: () => SOFT_CAP_BASE }
/**价格软上限的幂次槽位(基准值2) */
const SLOT_SOFT_CAP_POWER: EffectSlot = { target: 'softCap:power', init: () => SOFT_CAP_EXP }
/**维度生产软上限的幂次槽位(与价格软上限共用target,基准值0.75,故必须是不同的槽位对象) */
const SLOT_DIM_SOFT_CAP_POWER: EffectSlot = {
  target: 'softCap:power',
  init: () => DIM_SOFT_CAP_POWER,
}
/**维度生产软上限的阈值槽位 */
const SLOT_DIM_SOFT_CAP_BASE: EffectSlot = {
  target: 'dimSoftCap:base',
  init: () => Number.MAX_VALUE,
}
/**非默认基准值的softCap:power槽位缓存(按基准值建槽位对象,保证"同一基准值=同一对象") */
const extraPowerSlots = new Map<string, EffectSlot>()

/**取某个基准值对应的softCap:power槽位(同一基准值复用同一对象,才能命中帧内缓存) */
function powerSlot(baseline: DecimalSource): EffectSlot {
  const key = String(baseline)
  let slot = extraPowerSlots.get(key)
  if (!slot) {
    slot = { target: 'softCap:power', init: () => baseline }
    extraPowerSlots.set(key, slot)
  }
  return slot
}

/**
 * 当前软上限阈值(被C4奖励等效果修饰)
 * 帧内缓存:自动化一次求解里会调用上百次,而它只随挑战完成数/激活挑战变化(都在帧外)
 * 注意:统一按pos=[0]求值(价格软上限的阈值/幂次槽位都是全局槽位),故缓存键与层级无关
 */
export function softCapThreshold(): Decimal {
  return frameCachedByObject(SLOT_SOFT_CAP_BASE, { pos: [0], id: 0 }, () =>
    slotValue(SLOT_SOFT_CAP_BASE, { pos: [0], id: 0 }),
  )
}

/**
 * 当前软上限的对数幂次(被无限升级iu52等效果修饰:power→power^(0.99^挑战总数))
 * @param power 默认幂次的基准值;非默认值(如维度生产软上限的0.75)用另一份槽位与缓存
 */
export function softCapPower(power: DecimalSource = SOFT_CAP_EXP): Decimal {
  const slot = power === SOFT_CAP_EXP ? SLOT_SOFT_CAP_POWER : powerSlot(power)
  return frameCachedByObject(slot, { pos: [0], id: 0 }, () => slotValue(slot, { pos: [0], id: 0 }))
}

/**维度生产软上限的阈值(槽位dimSoftCap:base;基准值为Number.MAX_VALUE) */
export function dimSoftCapThreshold(): Decimal {
  return frameCachedByObject(SLOT_DIM_SOFT_CAP_BASE, { pos: [0], id: 0 }, () =>
    slotValue(SLOT_DIM_SOFT_CAP_BASE, { pos: [0], id: 0 }),
  )
}

/**维度生产软上限的幂次(与价格软上限共用softCap:power槽位,基准值0.75) */
export function dimSoftCapPower(): Decimal {
  return frameCachedByObject(SLOT_DIM_SOFT_CAP_POWER, { pos: [0], id: 0 }, () =>
    slotValue(SLOT_DIM_SOFT_CAP_POWER, { pos: [0], id: 0 }),
  )
}

/**对价格应用软上限:低于阈值不处理,高于阈值价格呈超指数增长 */
export function softCap(
  value: Decimal,
  power: DecimalSource = SOFT_CAP_EXP,
  height = SOFT_CAP_HEIGHT,
): Decimal {
  return softCapValue(value, softCapThreshold(), softCapPower(power), height)
}

/**
 * 软上限的逆(用于由"预算"反推"价格"的闭式求逆)
 * 数学依据:softCapValue(x,m,p,h) = layeradd10(h)( (layeradd10(-h)(x)/m)^p · m ),
 * 阈值以下原样返回、阈值以上是幂函数,两者都严格单调,故把幂次换成 1/p、其余参数不变即得逆函数
 * (softCapValue内部本身就会做h次layeradd10(-h)的还原)。
 * 可逆性:**p>0 即可逆,不需要p>1**——p<1时前向把数值"压小",逆运算把它放大回去,同样成立。
 * 注:返回值与原值只保证相对误差极小(不是位相等):layeradd10在层1的大mag下有约1e-12量级的精度损失
 * @param value 已套过软上限的值
 * @returns 逆运算结果;不可逆时返回undefined(仅当幂次非正或值非正/非有限)
 */
export function softCapInverse(
  value: Decimal,
  power?: DecimalSource,
  height = SOFT_CAP_HEIGHT,
): Decimal | undefined {
  const p = softCapPower(power ?? SOFT_CAP_EXP)
  //可逆条件:幂次必须>0(幂运算的逆仍是幂运算);p<=0时前向不是严格单调,信息已丢失
  if (!p.gt(0)) return undefined
  //域:低于阈值的值前向原样返回,逆也原样返回,天然一致;这里只需挡住0/负/非有限
  if (!value.isFinite() || value.lte(0)) return undefined
  return softCapValue(value, softCapThreshold(), new Decimal(1).div(p), height)
}

