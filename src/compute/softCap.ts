//价格软上限
//维度与加速器价格达到阈值后,对价格对数做幂次放大呈超指数增长;阈值可被挑战奖励(C4)提升,幂次可被无限升级(IU52)削弱
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { softCapValue } from '@/tools/softCap'
import { slotValue } from './effects'

/**软上限的基准阈值 */
const SOFT_CAP_BASE = 1e100
/**软上限后的对数幂次 */
const SOFT_CAP_EXP = 2
/**软上限的高度(见tools/softCap:1=现状,>1把软上限推迟到更高层指数塔) */
const SOFT_CAP_HEIGHT = 1

/**当前软上限阈值(被C4奖励等效果修饰) */
export function softCapThreshold(): Decimal {
  return slotValue({ target: 'softCap:base', init: () => SOFT_CAP_BASE }, { pos: [0], id: 0 })
}

/**当前软上限的对数幂次(被无限升级iu52等效果修饰:power→power^(0.99^挑战总数)) */
export function softCapPower(power: DecimalSource = SOFT_CAP_EXP): Decimal {
  return slotValue({ target: 'softCap:power', init: () => power }, { pos: [0], id: 0 })
}

/**对价格应用软上限:低于阈值不处理,高于阈值价格呈超指数增长 */
export function softCap(value: Decimal, power: DecimalSource = SOFT_CAP_EXP, height = SOFT_CAP_HEIGHT): Decimal {
  return softCapValue(value, softCapThreshold(), softCapPower(power), height)
}
