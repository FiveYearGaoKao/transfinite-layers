//更新层级
//顺序规则(详见 docs/面向开发者/层级系统.md):
//- 生产阶段:从高到低(高层的能量/加成在同一帧内即可作用于低层维度)
//- 临时层(-1)只是预览,不参与生产;层级遍历一律经access的顺序API(forEachLayer),不依赖对象键序
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import {
  addAmount,
  forEachLayer,
  getLayer,
  isChallengeActive,
  levelGap,
  prevLayer,
  type LayerEntry,
} from '@/access'
import { isLayer0 } from '@/tools/ordinal'
import { productionPerSecond } from '@/compute/dimensions'
import { hasUpgrade } from '@/compute/upgrades'
import { crossLayerAdditive } from '@/compute/crossLayer'
import { applyChallengeEffects } from './challenges'

/**更新指定的层级(生产阶段) */
function updateLayer(e: LayerEntry, dt: Decimal) {
  const layer = e.L
  if (!layer.active) return
  //挑战IC3"维度折叠":每个层级只有维度1和维度2能生产资源(更高维度仍可购买,但不再产出)
  const l = isChallengeActive('ic3') ? 2 : layer.dimensions.length
  //从上到下更新每一维度
  for (let i = l - 2; i >= 0; --i) {
    const produced = productionPerSecond(e.pos, i + 1).mul(dt)
    addAmount(layer, i, produced)
  }
  //第1维度生产点数或能量
  const dim1Production = productionPerSecond(e.pos, 0).mul(dt)
  if (isLayer0(e.pos)) {
    //层级0生产点数:计入层级0的totalPoints(会被层级1重置),并累计到player.totalPoints(永不清除)
    layer.points = layer.points.add(dim1Production)
    layer.totalPoints = layer.totalPoints.add(dim1Production)
    player.totalPoints = player.totalPoints.add(dim1Production)
  } else {
    layer.energy = layer.energy.add(dim1Production)
  }
  //累计本次重置经过的时间(用于自动重置)
  layer.resetTime = layer.resetTime.add(dt)
}
/**更新所有层级(第一阶段:生产,从高到低) */
export function updateLayers(dt: Decimal) {
  forEachLayer('desc', (e) => updateLayer(e, dt))
  updateUpgradeEffects(dt)
}

/**所有层级生产完成后统一应用挑战的动态效果(第三阶段:C5每帧损失等) */
export function applyChallengePenalties(dt: Decimal) {
  forEachLayer('asc', (e) => {
    if (e.L.active) applyChallengeEffects(e.L, e.pos, dt)
  })
}

/**应用升级随时间产生的效果(软重置:若层级k购买u9,则层级k-1每秒获得等同于其bestPoints的点数) */
function updateUpgradeEffects(dt: Decimal) {
  forEachLayer('asc', (e) => {
    if (!hasUpgrade(e.pos, 9)) return
    if (!e.L.active) return
    const LL = getLayer(prevLayer(e.pos))
    if (!LL || !LL.active) return
    //软重置属加法类加成:跨层时每秒比例按reward^(gap-1)放大
    const gain = crossLayerAdditive(LL.bestPoints, levelGap(e.pos)).mul(dt)
    LL.points = LL.points.add(gain)
    LL.totalPoints = LL.totalPoints.add(gain)
  })
}
