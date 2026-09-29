//无限元重置层的操作(写状态)
//无限重置(清空/删除层级并获取无限点数)、无限升级购买,以及无限里程碑的每帧维护
//import '@/compute/infinityMilestones'的效果注册随下方具名导入一并执行
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { activeInfinityChallengeIds, isInfinityChallenge } from '@/access'
import { clearTempLayers } from '@/data/temp'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { addLog } from '@/data/log'
import { formatTime, formatWhole } from '@/tools/format'
import {
  canBuyInfinityUpgrade,
  canInfinityReset,
  infinityGain,
  infinityUpgradeCost,
} from '@/compute/infinity'
import {
  hasInfinityMilestone,
  getInfinityMilestones,
  infinityPassiveRate,
} from '@/compute/infinityMilestones'
import { resetAutomationsForInfinityReset } from './automations'
import { checkInfinityResetAchievements } from './achievements'
import { recreateLayer0, wipeLayersWhere } from './layerStructure'
import { clearFrameCache } from '@/compute/frameCache'

/**统计页"重置记录"页保留的无限重置条数 */
const INFINITY_RESET_LOG_SIZE = 10

/**
 * 进行无限重置:获得无限点数,删除层级0以外的所有0阶层级(层级0重建为1点数的全新初始状态),
 * 清空普通挑战完成记录并退出激活挑战(无限里程碑im8解锁后改为保留1次完成次数);成就/知识/无限点数等全局数据保留
 * 自动化配置清空,但无限里程碑im6解锁后保留层级0那一份(见resetAutomationsForInfinityReset)
 * @param forced 是否强制重置(不获得资源)
 */
export function doInfinityReset(forced: boolean = false) {
  doInfinityResetInner(forced)
  //无限重置会重建层级0并清空自动化配置:帧内缓存必须失效(见compute/frameCache)
  clearFrameCache()
}

/**doInfinityReset的实现体:把"写状态"与"缓存失效"分开,保证提前返回也统一失效 */
function doInfinityResetInner(forced: boolean): void {
  if (!(forced || canInfinityReset())) return
  if (!forced) {
    //先算收益:IP经加成管道后向下取整
    const gain = infinityGain()
    player.infinityPoints = player.infinityPoints.add(gain)
    player.totalInfinityPoints = player.totalInfinityPoints.add(gain)
    player.infinityResets = player.infinityResets.add(1)
    logNewInfinityMilestones()
    addLog(
      'info',
      `无限重置!用时${formatTime(player.infinityRunTime)},获得${formatWhole(gain)}无限点数`,
    )

    const time = player.infinityRunTime
    const rate = time.gt(0) ? gain.div(time) : new Decimal(0)
    //记录最佳"无限点数/秒"(收益÷本次无限时长),供无限里程碑im100的被动收益使用
    //时长不设下限,仅用>0挡住同一帧内连续两次重置导致的除零
    player.infinityBestRate = Decimal.max(player.infinityBestRate, rate)
    //记录最短重置时间(取历史最小值),并归零本次无限经历的时间
    player.infinityBestResetTime = Decimal.min(player.infinityBestResetTime, time)
    //记录本次重置(统计页"重置记录"页展示最近若干次的用时/获得/速率;强制重置不记录)
    player.infinityResetLog = [{ time, gain, rate }, ...player.infinityResetLog].slice(
      0,
      INFINITY_RESET_LOG_SIZE,
    )
    //无限重置瞬间的成就判定(如a65"不解锁其它层级进行无限重置"):必须在下面删层之前求值
    checkInfinityResetAchievements({ gain })
  }
  //无论是否强制重置，都重置本次无限经过的时间
  player.infinityRunTime = new Decimal(0)
  //删除全部0阶层级(编号为后继序数的层级),只保留层级0
  //更高阶层级与元层数据不受影响(无限层与序数层互不重置)
  wipeLayersWhere((pos) => getLayerOrder(pos) == 0 && !isLayer0(pos))
  //层级0重建为全新初始状态(1点数),无视成就a24"速通高手"的保留1点(此时即1点,天然一致)
  recreateLayer0()
  //清空普通挑战的完成记录(im8解锁后完成次数变为min(x,1));无限挑战的完成次数不随无限重置删除
  //挑战的层归属按id约定判定(见access/challengeState),不引用挑战注册表以避免循环引用
  for (const id of Object.keys(player.challenges)) {
    if (isInfinityChallenge(id)) continue
    if (hasInfinityMilestone('im8')) {
      player.challenges[id] = Decimal.min(player.challenges[id] || new Decimal(0), 1)
    } else {
      delete player.challenges[id]
    }
  }
  //无限重置只退出普通挑战:无限挑战保持激活(其惩罚持续生效),完成次数也不受影响
  player.activeChallenges = activeInfinityChallengeIds()
  //复位当前层级与临时层、自动化配置(automationUnlocked永久保留)
  player.layerSubtab = [0]
  clearTempLayers()
  resetAutomationsForInfinityReset()
}

/**记录本次无限重置刚解锁的里程碑(重置次数只增不减,故"上一轮未达阈值、本轮达到"即刚解锁) */
function logNewInfinityMilestones() {
  for (const def of getInfinityMilestones()) {
    if (!player.infinityResets.sub(1).lt(def.resets) || !player.infinityResets.gte(def.resets))
      continue
    addLog('progress', `解锁无限里程碑:${def.name}`)
  }
}

/**购买无限升级 */
export function buyInfinityUpgrade(id: string) {
  if (!canBuyInfinityUpgrade(id)) return
  player.infinityPoints = player.infinityPoints.sub(infinityUpgradeCost(id))
  player.infinityUpgrades.push(id)
}

//------无限里程碑相关操作------
/**
 * 无限里程碑的每帧维护
 * im100:按"最佳无限点数/秒"每秒被动获得无限点数(不经infinityGain管道)
 * 注:im10的自动解锁新层级与im15的自动无限重置都是元层自动化,注册在logic/metaAutomations.ts,不在这里处理
 */
export function updateInfinityMilestones(dt: Decimal) {
  if (!hasInfinityMilestone('im100')) return
  const gain = infinityPassiveRate().mul(dt)
  player.infinityPoints = player.infinityPoints.add(gain)
  player.totalInfinityPoints = player.totalInfinityPoints.add(gain)
}
