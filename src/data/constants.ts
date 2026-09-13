//游戏中的常量

export const gameName: string = 'TransfiniteLayers'
export const gameVersion: string = 'v0.1.2'
/**无限重置的门槛:层级0点数达到 1.79e308(Number.MAX_VALUE,与成就a48同阈值) */
export const INFINITY_UNLOCK_POINTS: number = Number.MAX_VALUE
/**允许导入的存档的最早创建时间(毫秒时间戳) */
export const EARLIEST_SAVE_TIME: number = new Date('2026/8/21').getTime()
/**存档槽位数量 */
export const SAVE_SLOT_COUNT: number = 10
/**序数进制的初始值 */
export const INITIAL_BASE: number = 10
/**每个层级初始的维度数量 */
export const DIMENSION_COUNT: number = 4
/**离线检测的阈值(秒) */
export const OFFLINE_THRESHOLD: number = 120
/**日志的最大条数 */
export const MAX_LOG_COUNT: number = 100
/**1知识可兑换的离线时间(秒) */
export const KNOWLEDGE_TIME_RATE: number = 60
/**加速模式的默认倍率(1倍即关闭) */
export const DEFAULT_BOOST_SPEED: number = 1
/**能量加成:高层能量给低层维度的指数 */
export const ENERGY_BONUS_EXPONENT: number = 0.2
/**升级u1(点数作用)的指数,对数式点数加成 */
export const U1_POINTS_EXPONENT: number = 2
/**0阶层级重置的下层门槛基准值(gap=1时):下层面板为层级0时的门槛 */
export const PRESTIGE_THRESHOLD_LAYER0: number = 1e16
/**0阶层级重置的下层门槛基准值(gap=1时):下层为普通层级时的门槛 */
export const PRESTIGE_THRESHOLD: number = 1e4
/**0阶层级重置的收益指数基准值(gap=1时):下层为层级0时的指数 */
export const PRESTIGE_EXPONENT_LAYER0: number = 0.125
/**0阶层级重置的收益指数基准值(gap=1时):下层为普通层级时的指数 */
export const PRESTIGE_EXPONENT: number = 0.25
/**跨层奖励底数的初始值(仅用于加成,可被全局加成修饰) */
export const CROSS_LAYER_REWARD_BASE: number = 2
/**跨层惩罚底数的初始值(仅用于重置门槛与收益指数,可被全局加成修饰) */
export const CROSS_LAYER_PENALTY_BASE: number = 4
