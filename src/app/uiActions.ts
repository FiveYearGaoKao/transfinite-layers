//UI层的共享动作(快捷键与工具栏/层级页复用)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayerName, isChallengeActive } from '@/access'
import { formatWhole } from '@/tools/format'
import { resetGain } from '@/compute/prestige'
import { canInfinityReset, infinityGain } from '@/compute/infinity'
import { doReset, resetRunWithoutGain } from '@/logic/reset'
import { doInfinityReset } from '@/logic/infinity'
import { openConfirm } from '@/app/dialog'
import { settings } from '@/app/settings'
import { getBoostPresets } from '@/compute/knowledge'

/**重置当前所选层级(带设置里的二次确认,与层级页按钮同一流程) */
export async function resetLayerConfirm() {
  const pos = player.layerSubtab
  const confirmed =
    !settings.resetConfirm ||
    (await openConfirm({
      title: '重置确认',
      //函数形式:游戏持续运行,确认框中的重置收益随时间实时更新
      text: () =>
        `晋升并获得 ${formatWhole(resetGain(pos))} ${getLayerName(pos)}点数?\n这将重置下层进度。`,
      confirmText: '确认重置',
      cancelText: '取消',
    }))
  if (!confirmed) return
  //解锁的后续动作:重置临时层会把它转为真实层级,把视角切到新层级方便后续购买
  const unlocked = doReset(pos)
  if (unlocked) player.layerSubtab = unlocked
}

/**挑战4"后悔"按钮:不获得资源的强制重置(点数清零恢复价格),始终二次确认 */
export async function resetRunConfirm() {
  const pos = player.layerSubtab
  if (!isChallengeActive('c4')) return
  const confirmed = await openConfirm({
    title: '重开本轮',
    text: `将重置${getLayerName(pos)}及下层进度(点数清零),以恢复点数和物品价格。\n已购升级保留,此操作无法撤销。`,
    confirmText: '确认重置',
    cancelText: '取消',
  })
  if (confirmed) resetRunWithoutGain(pos)
}

/**无限重置(带设置里的二次确认,与普通重置同一流程;确认框收益实时更新) */
export async function infinityResetConfirm() {
  if (!canInfinityReset()) return
  const confirmed =
    !settings.infinityResetConfirm ||
    (await openConfirm({
      title: '无限重置确认',
      text: () =>
        `将获得 ${formatWhole(infinityGain())} 无限点数,并删除除层级0外的所有层级、清空普通挑战记录。\n成就与知识不受影响,此操作无法撤销。`,
      confirmText: '确认重置',
      cancelText: '取消',
    }))
  if (confirmed) doInfinityReset()
}

/**循环切换加速倍率(在已解锁档位间轮转) */
export function cycleBoost() {
  const presets = getBoostPresets()
  const cur = player.boostSpeed.toNumber()
  player.boostSpeed = new Decimal(presets[(presets.indexOf(cur) + 1) % presets.length] ?? 1)
}
