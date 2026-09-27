//元维度提升(Meta-Dimension Boost,MDB)的计算(只读)
//解锁:无限升级iu25;每次提升强制执行一次无限重置,换取"每层维度数+1"(上限8)与"低编号维度的维度指数加成"
//次数存在player.metaDimensionBoosts(Decimal,只增不减,不被任何重置清除);可调数值全部集中在本文件的常量里
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { DIMENSION_COUNT } from '@/data/constants'
import { dimensionTotalBought, getOrderedLayers } from '@/access'
import { registerEffect } from './effects'
import { hasInfinityUpgrade } from './infinity'

/**每次元维度提升给单个维度加的维度指数 */
export const META_DIMENSION_EXPONENT_PER_BOOST = 0.05
/**每个层级维度数量的上限 */
export const META_DIMENSION_MAX_COUNT = 8
/**首次元维度提升的需求(所有层级已购买的维度总数) */
export const META_DIMENSION_BASE_REQUIREMENT = 3000
/**每次元维度提升把需求乘上的倍率 */
export const META_DIMENSION_REQUIREMENT_RATIO = 1.4

/**单次提升的指数加成(模块级常量,避免每次求值都新建Decimal) */
const EXPONENT_PER_BOOST = new Decimal(META_DIMENSION_EXPONENT_PER_BOOST)
/**需求公式的底数(首次提升的需求) */
const REQUIREMENT_BASE = new Decimal(META_DIMENSION_BASE_REQUIREMENT)
/**需求公式的倍率(每提升一次乘一次) */
const REQUIREMENT_RATIO = new Decimal(META_DIMENSION_REQUIREMENT_RATIO)

/**已完成的元维度提升次数 */
export function metaDimensionBoostCount(): Decimal {
  return player.metaDimensionBoosts
}

/**
 * 当前每个层级的维度数量 = min(4+次数, 8)
 * 次数极大时toNumber()为Infinity,取min后自然落回上限,不会得到非法维度数
 */
export function dimensionCount(): number {
  const extra = Math.min(
    metaDimensionBoostCount().toNumber(),
    META_DIMENSION_MAX_COUNT - DIMENSION_COUNT,
  )
  return DIMENSION_COUNT + Math.max(0, Math.floor(extra))
}

/**进行下一次元维度提升后的每层维度数量(UI文案用) */
export function nextDimensionCount(): number {
  return Math.min(
    DIMENSION_COUNT + metaDimensionBoostCount().toNumber() + 1,
    META_DIMENSION_MAX_COUNT,
  )
}

/**
 * 进行下一元维度提升的需求(所有层级已购买的维度总数)
 * 公式:ceil(3000 × 1.4^(已完成的提升次数)):首次3000,之后每次乘1.4(第2次4200、第3次5880、…)
 * 取整只是因为"已购维度总数"本身是整数:向上取整不改变判定(对整数而言≥11524.8等价于≥11525),
 * 但让UI显示的整数与真实门槛一致(否则会出现"显示11524/11524却点不动")
 * 注:将来若加入"批量元维度提升",这里再加一个几何级数求和(k次的总需求)即可,不必改成Curve——
 *     需求是阈值而不是逐项价格,不经过价格管道,没有需要求逆的调用方
 */
export function metaDimensionRequirement(): Decimal {
  return REQUIREMENT_BASE.mul(REQUIREMENT_RATIO.pow(metaDimensionBoostCount())).ceil()
}

/**
 * 所有存活层级已购买的维度总数(各层级、各维度已购买次数之和,不含临时层)
 * 只统计"购买数量"(dim[1]),生产改变的总量(dim[0])不影响它
 * 注:**这里不能用帧内缓存**。UI把本函数包在Vue的computed里读取,而帧内缓存的命中路径不会读player.layers:
 *     Vue每次重算都会重新收集依赖,一次"命中"就会让该computed丢掉全部依赖,从此不再随购买更新
 *     (症状:元声望卡片的"已购维度总数"不变化、提升按钮不会因达标而解禁)。
 *     调用方只有元声望卡片(每次渲染一两次),逐层求和足够便宜
 */
export function totalBoughtDimensions(): Decimal {
  let total = new Decimal(0)
  for (const e of getOrderedLayers('asc')) total = total.add(dimensionTotalBought(e.L))
  return total
}

/**能否进行元维度提升(已购买iu25,且已购维度总数达到需求) */
export function canMetaDimensionBoost(): boolean {
  if (!hasInfinityUpgrade('iu25')) return false
  return totalBoughtDimensions().gte(metaDimensionRequirement())
}

/**
 * 某个维度(0起的id)的累计维度指数加成
 * 第m次提升使维度1~min(m,8)各+0.05,故维度i的总加成为0.05×max(n-(i-1),0);
 * 换成0起的id即0.05×max(n-id,0)
 */
export function metaDimensionExponentBonus(id: number): Decimal {
  return EXPONENT_PER_BOOST.mul(metaDimensionBoostCount().sub(id).max(0))
}

//------效果注册------
//只依赖"提升次数"这一个购买类计数与ctx.id,不读点数/产出/时间/current,故标static进帧内效果计划
//(次数只在logic/metaDimension的doMetaDimensionBoost里变化,那里必然走到doInfinityReset的清缓存)
registerEffect({
  id: 'metaDimension',
  name: '元维度提升',
  target: 'dimensionExponent',
  type: 'add',
  static: true,
  isActive: () => metaDimensionBoostCount().gt(0),
  value: (ctx) => metaDimensionExponentBonus(ctx.id),
  text: '维度指数 +{value}',
})
