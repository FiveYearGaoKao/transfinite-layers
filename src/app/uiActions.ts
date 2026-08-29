//UI层的共享动作(快捷键与工具栏/层级页复用)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayerName, isChallengeActive } from '@/access'
import { formatWhole } from '@/tools/format'
import { resetGain } from '@/compute/prestige'
import { doReset, resetRunWithoutGain } from '@/logic/reset'
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
      text: `晋升并获得 ${formatWhole(resetGain(pos))} ${getLayerName(pos)}点数?\n这将重置下层进度。`,
      confirmText: '确认重置',
      cancelText: '取消',
    }))
  if (confirmed) doReset(pos)
}

/**挑战4"后悔"按钮:不获得资源的强制重置(点数清零恢复价格),始终二次确认 */
export async function resetRunConfirm() {
  const pos = player.layerSubtab
  if (!isChallengeActive('c4')) return
  const confirmed = await openConfirm({
    title: '放弃本轮',
    text: `将重置${getLayerName(pos)}及下层进度(点数清零),以恢复挑战4的价格。\n已购升级保留,此操作无法撤销。`,
    confirmText: '确认重置',
    cancelText: '取消',
  })
  if (confirmed) resetRunWithoutGain(pos)
}

/**循环切换加速倍率(在已解锁档位间轮转) */
export function cycleBoost() {
  const presets = getBoostPresets()
  const cur = player.boostSpeed.toNumber()
  player.boostSpeed = new Decimal(presets[(presets.indexOf(cur) + 1) % presets.length] ?? 1)
}
