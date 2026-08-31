//快捷键:全局键盘监听(输入控件聚焦或对话框打开时不响应;设置里可整体开关)
import { player } from '@/data/player'
import { settings } from '@/app/settings'
import { currentDialog } from '@/app/dialog'
import { buyDimension } from '@/logic/purchase'
import { toggleAllAuto, toggleLayerAuto } from '@/logic/automations'
import { canReset } from '@/compute/prestige'
import { canInfinityReset } from '@/compute/infinity'
import { doLoad, doSave } from '@/app/saveActions'
import { cycleBoost, infinityResetConfirm, resetLayerConfirm } from '@/app/uiActions'
import { cycleCurrentSubtab, cycleLayer, mainTabsList } from '@/app/navigation'
import { focusCommandInput } from '@/app/commandFocus'

/**全局按键处理 */
function onKeydown(e: KeyboardEvent) {
  //快捷键开关、输入控件聚焦或对话框打开时不响应
  if (!settings.hotkeys) return
  const target = e.target as HTMLElement
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  if (currentDialog.value) return

  //Shift+1~4:购买当前层维度(用e.code按物理键位判断,Shift+数字在键盘上会产生!@#$)
  if (e.shiftKey && e.code >= 'Digit1' && e.code <= 'Digit4') {
    e.preventDefault()
    buyDimension(player.layerSubtab, parseInt(e.code.slice(5)) - 1)
    return
  }
  //数字键:切换主标签
  if (!e.shiftKey && e.code.startsWith('Digit')) {
    e.preventDefault()
    const idx = e.code == 'Digit0' ? 9 : parseInt(e.code.slice(5)) - 1
    const t = mainTabsList.value[idx]
    if (t) player.mainTab = t.id
    return
  }
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault()
      if (player.mainTab == 'layers') cycleLayer(-1)
      else cycleCurrentSubtab(-1)
      return
    case 'ArrowRight':
      e.preventDefault()
      if (player.mainTab == 'layers') cycleLayer(1)
      else cycleCurrentSubtab(1)
      return
    case 'r':
    case 'R':
      if (canReset(player.layerSubtab)) void resetLayerConfirm()
      return
    case 'i':
    case 'I':
      if (canInfinityReset()) void infinityResetConfirm()
      return
    case 's':
    case 'S':
      void doSave()
      return
    case 'l':
    case 'L':
      void doLoad()
      return
    case 'a':
    case 'A':
      if (e.shiftKey) toggleAllAuto()
      else toggleLayerAuto(player.layerSubtab)
      return
    case 'b':
    case 'B':
      cycleBoost()
      return
    case '/':
      //工具栏显示时聚焦指令输入框并输入"/"(指令输入框未挂载时无效果)
      if (settings.showToolBar) {
        e.preventDefault()
        focusCommandInput()
      }
      return
  }
}

/**启用全局快捷键(应用挂载时调用) */
export function initHotkeys() {
  window.addEventListener('keydown', onKeydown)
}
/**禁用全局快捷键(应用卸载时调用) */
export function disposeHotkeys() {
  window.removeEventListener('keydown', onKeydown)
}
