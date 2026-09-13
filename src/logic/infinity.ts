//无限元重置层的操作(写状态)
//无限重置(清空/删除层级并获取无限点数)与无限升级购买
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { clearTempLayers } from '@/data/temp'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { addLog } from '@/data/log'
import { format } from '@/tools/format'
import {
  canBuyInfinityUpgrade,
  canInfinityReset,
  infinityGain,
  infinityUpgradeCost,
} from '@/compute/infinity'
import { getChallenge } from './challenges'
import { recreateLayer0, wipeLayersWhere } from './layerStructure'

/**
 * 进行无限重置:获得无限点数,删除层级0以外的所有0阶层级(层级0重建为1点数的全新初始状态),
 * 清空普通挑战完成记录并退出激活挑战;成就/知识/无限点数等全局数据保留
 */
export function doInfinityReset() {
  if (!canInfinityReset()) return
  //先算收益:IP经加成管道后向下取整
  const gain = infinityGain()
  player.infinityPoints = player.infinityPoints.add(gain)
  player.totalInfinityPoints = player.totalInfinityPoints.add(gain)
  player.infinityResets = player.infinityResets.add(1)
  //记录最短重置时间(取历史最小值),并归零本次无限经历的时间
  player.infinityBestResetTime = Decimal.min(player.infinityBestResetTime, player.infinityRunTime)
  player.infinityRunTime = new Decimal(0)
  //删除全部0阶层级(编号为后继序数的层级),只保留层级0
  //更高阶层级与元层数据不受影响(无限层与序数层互不重置)
  wipeLayersWhere((pos) => getLayerOrder(pos) == 0 && !isLayer0(pos))
  //层级0重建为全新初始状态(1点数),无视成就a24"速通高手"的保留1点(此时即1点,天然一致)
  recreateLayer0()
  //清空普通挑战的完成记录并退出全部激活挑战
  for (const id of Object.keys(player.challenges)) {
    if (getChallenge(id)?.layer == 'normal') delete player.challenges[id]
  }
  player.activeChallenges = []
  //复位当前层级与临时层、自动化配置(automationUnlocked永久保留)
  player.layerSubtab = [0]
  clearTempLayers()
  player.automations = {}
  addLog('info', `无限重置!获得${format(gain)}无限点数,一切从头开始`)
}

/**购买无限升级 */
export function buyInfinityUpgrade(id: string) {
  if (!canBuyInfinityUpgrade(id)) return
  player.infinityPoints = player.infinityPoints.sub(infinityUpgradeCost(id))
  player.infinityUpgrades.push(id)
}
