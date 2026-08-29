//更新层级
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { type LayerId } from '@/data/types'
import { addAmount, getLayer, getBase, highestActiveLayer, isActive, prevLayer } from '@/access'
import { isLayer0, posArray, shiftLayer } from '@/tools/ordinal'
import { productionPerSecond } from '@/compute/dimensions'
import { hasUpgrade } from '@/compute/upgrades'
import { initializeLayer } from '@/data/types'
import { temp } from '@/app/temp'
import { applyChallengeEffects } from './challenges'

/**更新指定的层级(生产阶段) */
function updateLayer(pos: LayerId, dt: Decimal) {
  const layer = getLayer(pos)
  if (!layer) return
  if (!isActive(pos)) return
  const l = layer.dimensions.length
  //从上到下更新每一维度
  for (let i = l - 2; i >= 0; --i) {
    const produced = productionPerSecond(pos, i + 1).mul(dt)
    addAmount(layer, i, produced)
  }
  //第1维度生产点数或能量
  const dim1Production = productionPerSecond(pos, 0).mul(dt)
  if (isLayer0(pos)) {
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
/**更新所有层级(第一阶段:生产,逆序先算高层) */
export function updateLayers(dt: Decimal) {
  for (const i of Object.keys(player.layers).toReversed()) {
    updateLayer(posArray(i), dt)
  }
  updateTempLayers([0], player.layerDepth - 1)
  updateUpgradeEffects(dt)
}

/**所有层级生产完成后统一应用挑战的动态效果(第三阶段:C5每帧损失等) */
export function applyChallengePenalties(dt: Decimal) {
  for (const key of Object.keys(player.layers)) {
    const pos = posArray(key)
    const L = getLayer(pos)
    if (L && L.active) applyChallengeEffects(L, pos, dt)
  }
}

/**应用升级随时间产生的效果(软重置:若层级k购买u9,则层级k-1每秒获得等同于其bestPoints的点数) */
function updateUpgradeEffects(dt: Decimal) {
  for (const key of Object.keys(player.layers)) {
    const pos = posArray(key)
    if (!hasUpgrade(pos, 9)) continue
    const L = getLayer(pos)
    if (!L || !L.active) continue
    const lower = prevLayer(pos)
    const LL = getLayer(lower)
    if (!LL || !LL.active) continue
    const gain = LL.bestPoints.mul(dt)
    LL.points = LL.points.add(gain)
    LL.totalPoints = LL.totalPoints.add(gain)
  }
}

/**基于最高层更新临时层级 */
function updateTempLayer(pos: LayerId, n: number = 0) {
  const L = getLayer(pos)
  if (L) {
    const pos1 = shiftLayer(pos, n, -1)
    const newLevel = L.level.add(1)
    let tempL = getLayer(pos1)
    if (!tempL) {
      tempL = temp.tempLayers[pos1.toString()] = initializeLayer(newLevel)
    } else {
      tempL.level = newLevel
    }
  }
}

/**递归更新所有临时层级*/
export function updateTempLayers(pos: LayerId, n: number = 0) {
  if (n > 0) {
    for (let i = 0; i < getBase(); i++) {
      const pos1 = shiftLayer(pos, n, i)
      if (isActive(pos1)) updateTempLayers(pos1, n - 1)
    }
  }
  const posh = highestActiveLayer(pos, n)
  updateTempLayer(posh, n)
}
