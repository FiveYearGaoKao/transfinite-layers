//元维度提升(Meta-Dimension Boost)的操作(写状态)
//一次提升 = 提升次数+1 → 为所有现存层级补上新维度 → 强制执行一次无限重置(不获得无限点数)
//强制无限重置会清空0阶层级并重建层级0,故"补维度"只需保证存活层级(1阶及以上)同步到新维度数
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { addLog } from '@/data/log'
import type { Layer } from '@/data/types'
import { getOrderedLayers } from '@/access'
import { formatWhole } from '@/tools/format'
import { canMetaDimensionBoost, dimensionCount } from '@/compute/metaDimension'
import { doInfinityReset } from './infinity'

/**把某层级的维度数组补齐到指定数量(只增不减:新增维度从0开始,已有维度不受影响) */
function padDimensions(L: Layer, count: number) {
  while (L.dimensions.length < count) L.dimensions.push([new Decimal(0), new Decimal(0)])
}

/**把所有存活层级的维度数组补齐到当前的维度数量 */
function padAllLayers() {
  const count = dimensionCount()
  for (const e of getOrderedLayers('asc')) padDimensions(e.L, count)
}

/**
 * 进行元维度提升
 * 需求为"所有层级已购买的维度总数"(见compute/metaDimension);不满足或未购买iu25时不做任何事
 * 不单独调用clearFrameCache():强制重置必然执行doInfinityReset的缓存清理,且本函数在其之前只写
 * player.metaDimensionBoosts与维度数组,期间没有任何读效果管道的逻辑(换成别的重置时须重新确认这一点)
 */
export function doMetaDimensionBoost() {
  if (!canMetaDimensionBoost()) return
  const boosts = player.metaDimensionBoosts.add(1)
  player.metaDimensionBoosts = boosts
  //先补维度:本次解锁的新维度对存活层级立即可见(0阶层级随后由无限重置重建,同样带上新维度)
  padAllLayers()
  //强制执行无限重置:清空除层级0外的所有0阶层级、清空普通挑战与各层自动化配置,但不给无限点数
  doInfinityReset(true)
  addLog('info', `进行第${formatWhole(boosts)}次元维度提升,当前每层维度数量${dimensionCount()}`)
}
