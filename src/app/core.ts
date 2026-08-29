//游戏循环的核心函数
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { addValue, localSave } from '@/save/save'
import { updateLayers, applyChallengePenalties } from '@/logic/update'
import { updateAutomations } from '@/logic/automations'
import { getMetaLayers } from '@/meta/registry'
import { updateAchievements } from '@/logic/achievements'
import { addLog } from '@/app/log'
import { formatTime } from '@/tools/format'
import { settings } from '@/app/settings'
import { getPsdSpeed, hasKnowledge } from '@/compute/knowledge'
import { OFFLINE_THRESHOLD } from '@/data/constants'
import { openConfirm } from '@/app/dialog'

const FPS: number = 30
let saveTimer = 0
/**自动保存循环，每秒检测一次 */
export function autoSaveLoop() {
  if (!settings.autoSave) {
    saveTimer = 0
    return
  }
  saveTimer++
  if (saveTimer >= settings.autoSaveInterval) {
    saveTimer = 0
    localSave()
    addLog('info', '游戏已保存')
  }
}
/**游戏循环，dt以秒为单位
 * 一帧内顺序(全局三段式):所有层生产→元层tick→所有层自动化→挑战C5等每帧惩罚→成就检查
 */
function gameLoop(dt: Decimal) {
  dt = dt.mul(getPsdSpeed())
  addValue('totalTime', dt)
  updateLayers(dt)
  for (const meta of getMetaLayers()) meta.onTick(dt)
  updateAutomations(dt)
  applyChallengePenalties(dt)
  updateAchievements()
}
/**游戏暂停和恢复 */
export function pause() {
  player.paused = !player.paused
}
/**游戏前进1帧 */
export function tick() {
  addValue('realTime', new Decimal(1 / FPS))
  gameLoop(new Decimal(1 / FPS))
}
/**真·主循环 */
export function mainLoop() {
  let dt = new Decimal((Date.now() - player.lastPlay) / 1000)
  const realDt = new Decimal(dt)
  player.lastPlay = Date.now()
  if (player.paused) {
    //检测游戏是否暂停:能暂停必然已购买升级"暂停功能",期间时间储存为离线时间
    addValue('offlineTime', dt)
  } else if (dt.gte(OFFLINE_THRESHOLD)) {
    //若距上一次加载超过一定时间，则认为玩家离线
    addLog('info', `欢迎回来!你离线了${formatTime(dt)}.`)
    if (hasKnowledge('time-offline')) {
      //离线进度:默认(或仅有离线进度升级时)全部转为加速时间,购买"离线去向"后可选择储存或询问
      if (player.offlineMode == 'ask') {
        //询问:离线结束时弹出对话框,由玩家决定储存或加速
        openConfirm({
          title: '离线时间去向',
          text: `你离线了${formatTime(dt)}。\n这段离线时间要如何处理?`,
          confirmText: '储存为离线时间',
          cancelText: '转为加速时间',
        }).then((store) => {
          if (store) addValue('offlineTime', dt)
          else addValue('warpTime', dt)
        })
      } else if (player.offlineMode == 'store') {
        addValue('offlineTime', dt)
      } else {
        addValue('warpTime', dt)
      }
    }
  } else {
    //加速先于时间扭曲计算,在未被扭曲放大的dt上消耗,使加速消耗的离线时间较小
    if (player.boostSpeed.gt(1)) {
      //加速:稳定消耗离线时间,不足时关闭
      const consume = dt.mul(player.boostSpeed.sub(1))
      if (player.offlineTime.gte(consume)) {
        addValue('offlineTime', consume.neg())
      } else {
        addValue('offlineTime', player.offlineTime.neg())
        player.boostSpeed = new Decimal(1)
        addLog('warning', '加速因离线时间不足而关闭')
      }
    }
    //时间扭曲:始终自动开启,加速时间>=1秒时每帧消耗1%,快速消耗
    if (player.warpTime.gte(1)) {
      const consumeWarpTime: Decimal = player.warpTime.mul(0.01)
      addValue('warpTime', consumeWarpTime.neg())
      dt = dt.add(consumeWarpTime)
    }
    addValue('realTime', realDt)
    gameLoop(dt)
  }
  setTimeout(mainLoop, 1000 / FPS)
}
