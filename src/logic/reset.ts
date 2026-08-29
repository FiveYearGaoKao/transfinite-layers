//进行重置
import Decimal from 'break_eternity.js'
import { initializeDimensions, initializeLayer, type LayerId } from '@/data/types'
import { getLayer, hasAchievement, highestActiveLayer, prevLayer } from '@/access'
import { getLayerIndex, getLayerOrder, isLayer0, nextLayer, shiftLayer } from '@/tools/ordinal'
import { canReset, resetGain } from '@/compute/prestige'
import { hasUpgrade } from '@/compute/upgrades'
import { player } from '@/data/player'
import { temp } from '@/app/temp'
import { checkResetAchievements } from './achievements'

/**重置选项 */
interface ResetOptions {
  /**保留本层能量和维度数量(升级u7) */
  keepProgress?: boolean
  /**保留下层升级(升级u8) */
  keepUpgrades?: boolean
}

/**重置一个层级的数据(清除维度/升级/可购买等) */
export function resetData(layer: LayerId, opts: ResetOptions = {}) {
  const L = getLayer(layer)
  if (L) {
    const keepUpgrades = opts.keepUpgrades ?? false
    let points = isLayer0(layer) ? new Decimal(1) : new Decimal(0)
    if (hasAchievement('a24')) points = Decimal.max(points, 1)
    L.points = points
    L.totalPoints = new Decimal(0)
    L.bestPoints = new Decimal(0)
    L.resetCount = new Decimal(0)
    L.energy = new Decimal(0)
    L.resetTime = new Decimal(0)
    L.buyables = {}
    if (!keepUpgrades) L.upgrades = []
    initializeDimensions(L)
  }
}

/**晋升时重置本层自身进度:维度总量重置为已购数量,能量清零;购买u7(能量保留)则保留 */
function resetProgress(layer: LayerId) {
  const L = getLayer(layer)
  if (!L || hasUpgrade(layer, 7)) return
  L.energy = new Decimal(0)
  for (const dim of L.dimensions) dim[0] = new Decimal(dim[1])
}

/**
 * 点击重置按钮
 * @param forced 是否为强制重置(级联重置下层时用,此时不重置本层自身进度)
 * @param gainResource 是否获得资源
 * @param forceClearUpgrades 是否无视升级u8强制清空下层升级(进入/退出挑战时用)
 */
export function doReset(
  layer: LayerId,
  forced: boolean = false,
  gainResource: boolean = true,
  forceClearUpgrades: boolean = false,
) {
  if (forced || canReset(layer)) {
    if (isLayer0(layer)) return
    const L = getLayer(layer)
    //先算收益并判定重置瞬间成就(须在清空能量/重置下层之前,且不计级联强制重置)
    const gain = gainResource && L?.active ? resetGain(layer) : new Decimal(0)
    if (gainResource && L?.active && !forced) checkResetAchievements(layer, gain)
    //晋升:顶层重置(点击/自动重置)同时重置本层自身进度
    if (!forced) resetProgress(layer)
    //获得本层级资源
    if (gainResource && L && L.active) {
      L.points = L.points.add(gain)
      L.totalPoints = L.totalPoints.add(gain)
      L.resetCount = L.resetCount.add(1)
      L.bestPoints = L.bestPoints.max(gain)
    }
    //重置前面的层级
    const prev = prevLayer(layer)
    resetData(prev, {
      keepUpgrades: !forceClearUpgrades && hasUpgrade(layer, 8),
    })
    doReset(prev, true, false, forceClearUpgrades)
    //如果是临时层级，则添加一个新层级
    if (layer.indexOf(-1) >= 0) {
      const n = getLayerOrder(layer)
      const posh = highestActiveLayer(layer, n)
      const highestLevel = getLayer(posh)?.level || new Decimal(0)
      const idx = getLayerIndex(posh, n)
      if (idx < player.base - 1) {
        //直接将新层级加在原层级后面
        player.layers[nextLayer(posh).toString()] = L || null
      } else {
        //后面的层级向前平移
        for (let i = Math.floor(player.base / 2); i < player.base - 1; i++) {
          const pos1 = shiftLayer(layer, n, i).toString()
          const pos2 = shiftLayer(layer, n, i + 1).toString()
          player.layers[pos1] = getLayer(pos2) || null
        }
        player.layers[posh.toString()] = L || null
      }
      temp.tempLayers[layer.toString()] = initializeLayer(highestLevel.add(1))
    }
  }
}

/**
 * 不获得资源的强制重置(挑战4"后悔"按钮)
 * 直接resetData本层(点数清零、清除维度/可购买,使C4价格偏移恢复),再级联重置下层;保留本层升级
 * 临时层(含-1)禁止调用:在临时层重置会无条件解锁新层级
 */
export function resetRunWithoutGain(pos: LayerId) {
  if (pos.includes(-1)) return
  const L = getLayer(pos)
  if (!L || !L.active) return
  resetData(pos, { keepUpgrades: true })
  doReset(pos, true, false, false)
}
