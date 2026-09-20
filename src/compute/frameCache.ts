//帧内作用域缓存
//用途:一帧之内会被反复求值、但在本帧内不会变化的计算结果(如软上限的阈值与幂次、各槽位组合值)只算一次
//为什么需要:自动化每帧要对每个可购买项做上百次价格求值,而每次求值都会重新解一遍效果管线,
//            其中大部分子结果与"将要购买的数量"无关(见 docs/面向开发者/性能.md)
//正确性约束(重要):缓存的值必须在"清除缓存之前"保持不变。
//- 每帧的写状态入口是 app/core.ts 的 gameLoop,它在生产阶段之前清空一次
//- 任何会改变这些值的写操作(购买、重置、进入/退出挑战、解锁成就)都必须紧接着调用 clearFrameCache()
//- 违反约束的后果只是同一帧内读到旧值(不会崩溃),但会造成数值不一致,故新增写状态时必须一起检查
import Decimal from 'break_eternity.js'

/**帧内缓存表:键为调用方自定的字符串 */
const cache = new Map<string, Decimal>()

/**
 * 按对象身份分组的帧内缓存表
 * 用WeakMap避免持有槽位对象;WeakMap无法清空,故用generation作废整代表
 */
const objectCache = new WeakMap<object, { gen: number; values: Map<string, Decimal> }>()
/**当前代次:clearFrameCache递增,使所有旧的per-owner表失效 */
let objectCacheGen = 0

/**
 * 读取帧内缓存,未命中时用factory计算并写入
 * @param key 缓存键(调用方需自行保证唯一,并保证值在清空前不变)
 * @param factory 未命中时的计算函数
 */
export function frameCached(key: string, factory: () => Decimal): Decimal {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const value = factory()
  cache.set(key, value)
  return value
}

/**
 * 以"对象身份 + 上下文"为键的帧内缓存
 * 用途:槽位组合值。同一个子目标在不同调用点可以有不同init基准值(如softCap:power),
 *      只按 target 作键会让两者互相污染,故改用槽位对象本身的引用作键(模块级常量对象天然稳定)
 * @param owner 用于区分缓存空间的对象(槽位定义)
 * @param ctx 计算上下文(层级坐标与id)
 * @param factory 未命中时的计算函数
 */
export function frameCachedByObject(
  owner: object,
  ctx: { pos: number[]; id: number },
  factory: () => Decimal,
): Decimal {
  let perOwner = objectCache.get(owner)
  if (perOwner === undefined || perOwner.gen !== objectCacheGen) {
    perOwner = { gen: objectCacheGen, values: new Map<string, Decimal>() }
    objectCache.set(owner, perOwner)
  }
  const key = `${ctx.pos.toString()}|${ctx.id}`
  const hit = perOwner.values.get(key)
  if (hit !== undefined) return hit
  const value = factory()
  perOwner.values.set(key, value)
  return value
}

/**清空帧内缓存(帧首、以及任何写状态之后调用) */
export function clearFrameCache() {
  cache.clear()
  objectCacheGen++
}
