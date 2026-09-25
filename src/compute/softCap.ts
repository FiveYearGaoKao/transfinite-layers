//软上限的参数槽位
//价格软上限与维度生产软上限的参数**完全独立**(各两个槽位):iu52只削弱价格,ic4两者都平方
//阈值与幂次都是具名槽位,可被挑战奖励/无限升级等效果修饰;数学实现仍在tools/softCap(纯函数)
//cap效果的注册见compute/dimensions、compute/buyables、logic/challenges
import Decimal from 'break_eternity.js'
import { defineSlot } from './effects'

/**价格软上限的基准阈值 */
const PRICE_CAP_BASE = 1e100
/**价格软上限的基准幂次(对价格对数做幂次放大) */
const PRICE_CAP_POWER = 2
/**维度生产软上限的基准阈值 */
const DIM_CAP_BASE = Number.MAX_VALUE
/**维度生产软上限的基准幂次 */
const DIM_CAP_POWER = 0.8
/**价格软上限的高度(把软上限推迟到指数塔第1层);维度生产软上限的高度见compute/dimensions */
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
