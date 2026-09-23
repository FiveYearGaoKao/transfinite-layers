//帧内作用域缓存
//用途:一帧之内会被反复求值、但在本帧内不会变化的计算结果只算一次
//      (槽位组合值、曲线参数、static效果数值、效果计划)
//为什么需要:自动化每帧要对每个可购买项做上百次价格求值,而每次求值都会重新解一遍效果管线(见docs/面向开发者/性能.md)
//正确性约束(重要):缓存的值必须在"清除缓存之前"保持不变。
//- 每帧的写状态入口是 app/core.ts 的 gameLoop,它在生产阶段之前清空一次
//- 任何会改变这些值的写操作(购买、重置、进入/退出挑战、解锁成就)都必须紧接着调用 clearFrameCache()
//- 违反约束的后果只是同一帧内读到旧值(不会崩溃),但会造成数值不一致,故新增写状态时必须一起检查
//- 开发构建在"生产阶段后"与"帧末"各跑一次static自检(compute/effects的runStaticSelfCheck)抓这类问题
import Decimal from 'break_eternity.js'

/**
 * 按对象身份分组的帧内缓存表(值可为任意类型:槽位是Decimal、效果计划是对象)
 * 用WeakMap避免持有owner;WeakMap无法清空,故用generation作废整代表
 */
const objectCache = new WeakMap<object, { gen: number; values: Map<string, unknown> }>()
/**当前代次:clearFrameCache递增,使所有旧的per-owner表失效 */
let objectCacheGen = 0

/**缓存绕过深度(>0时不读不写缓存;开发构建的static自检用) */
let bypassDepth = 0

/**清空缓存时的回调(开发构建用它丢弃"本帧已记录的static采样") */
const resetHooks: (() => void)[] = []

/**注册"清空缓存时"的回调 */
export function onCacheReset(fn: () => void) {
  resetHooks.push(fn)
}

/**开发构建的缓存命中计数(正式构建不记录) */
const stats = new Map<string, { hits: number; misses: number }>()

/**记一次命中/未命中 */
function countHit(label: string, hit: boolean) {
  let s = stats.get(label)
  if (!s) {
    s = { hits: 0, misses: 0 }
    stats.set(label, s)
  }
  if (hit) s.hits++
  else s.misses++
}

/**缓存命中统计(按未命中次数从多到少;开发构建的可观测性入口) */
export function cacheStats(): { label: string; hits: number; misses: number }[] {
  return Array.from(stats, ([label, s]) => ({ label, hits: s.hits, misses: s.misses })).sort(
    (a, b) => b.misses - a.misses,
  )
}

/**清空命中统计 */
export function resetCacheStats() {
  stats.clear()
}

/**
 * 以"对象身份 + 调用方自定键"为键的帧内缓存(可缓存任意类型)
 * @param owner 用于区分缓存空间的对象(必须是模块级常量,身份稳定)
 * @param key 缓存键(同一语义的同一来源必须得到同一个键;槽位用"层级键|id",global槽位用空串)
 * @param factory 未命中时的计算函数
 * @param label 命中统计的分组标签(仅开发构建使用)
 */
export function frameCachedValue<T>(
  owner: object,
  key: string,
  factory: () => T,
  label: string = 'other',
): T {
  if (bypassDepth > 0) return factory()
  const dev = import.meta.env.DEV
  let perOwner = objectCache.get(owner)
  if (perOwner === undefined || perOwner.gen !== objectCacheGen) {
    perOwner = { gen: objectCacheGen, values: new Map<string, unknown>() }
    objectCache.set(owner, perOwner)
  }
  const hit = perOwner.values.get(key)
  if (hit !== undefined) {
    if (dev) countHit(label, true)
    return hit as T
  }
  if (dev) countHit(label, false)
  const value = factory()
  perOwner.values.set(key, value)
  return value
}

/**
 * frameCachedValue的Decimal特化(槽位组合值、曲线参数)
 * @param owner 缓存宿主(模块级常量);key 同frameCachedValue;label 命中统计标签
 */
export function frameCachedByObject(
  owner: object,
  key: string,
  factory: () => Decimal,
  label: string = 'other',
): Decimal {
  return frameCachedValue<Decimal>(owner, key, factory, label)
}

/**绕过帧内缓存执行fn(开发构建的自检用:重新计算而不命中缓存) */
export function withCacheBypass<T>(fn: () => T): T {
  bypassDepth++
  try {
    return fn()
  } finally {
    bypassDepth--
  }
}

/**清空帧内缓存(帧首、以及任何写状态之后调用) */
export function clearFrameCache() {
  for (const fn of resetHooks) fn()
  objectCacheGen++
}
