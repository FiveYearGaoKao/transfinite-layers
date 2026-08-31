//无限元重置层的操作(写状态)
//无限重置(清空/删除层级并获取无限点数)与无限升级购买
import { player } from '@/data/player'
import { initializeLayer } from '@/data/types'
import { temp } from '@/app/temp'
import { addLog } from '@/app/log'
import { format } from '@/tools/format'
import {
  canBuyInfinityUpgrade,
  canInfinityReset,
  infinityGain,
  infinityUpgradeCost,
} from '@/compute/infinity'
import { getChallenge } from './challenges'

/**
 * 进行无限重置:获得无限点数,删除除层级0外的所有层级(层级0重建为1点数的全新初始状态),
 * 清空普通挑战完成记录并退出激活挑战;成就/知识/无限点数等全局数据保留
 */
export function doInfinityReset() {
  if (!canInfinityReset()) return
  //先算收益:IP经加成管道后向下取整
  const gain = infinityGain()
  player.infinityPoints = player.infinityPoints.add(gain)
  player.infinityResets = player.infinityResets.add(1)
  //删除除层级0外的所有层级(delete移除键,不残留null空层;新层级此后按插入序追加,顺序仍递增)
  for (const key of Object.keys(player.layers)) {
    if (key != '0') delete player.layers[key]
  }
  //层级0重建为全新初始状态(1点数),无视成就a24"速通高手"的保留1点(此时即1点,天然一致)
  player.layers['0'] = initializeLayer(0, true)
  //清空普通挑战的完成记录并退出全部激活挑战
  for (const id of Object.keys(player.challenges)) {
    if (getChallenge(id)?.layer == 'normal') delete player.challenges[id]
  }
  player.activeChallenges = []
  //复位当前层级与临时层、自动化配置(automationUnlocked永久保留)
  player.layerSubtab = [0]
  temp.tempLayers = {}
  player.automations = {}
  addLog('info', `无限重置!获得${format(gain)}无限点数,一切从头开始`)
}

/**购买无限升级 */
export function buyInfinityUpgrade(id: string) {
  if (!canBuyInfinityUpgrade(id)) return
  player.infinityPoints = player.infinityPoints.sub(infinityUpgradeCost(id))
  player.infinityUpgrades.push(id)
}
