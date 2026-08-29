//存档工作流:槽位选择对话框 + 存档/读档/硬重置动作(UI层编排,供选项页/工具栏复用)
//依赖对话框(ui)与存档操作,不能下沉到logic/save层,否则违反单向依赖
import { openConfirm, openSlots } from '@/app/dialog'
import { addLog } from '@/app/log'
import { hardReset, hasSlotSave, localLoad, localSave, setCurrentSlot } from '@/save/save'

/**保存到所选槽位(弹出槽位选择框) */
export async function doSave() {
  const slot = await openSlots({ title: '选择保存槽位', mode: 'save' })
  if (slot != null) {
    localSave(slot)
    setCurrentSlot(slot)
    addLog('info', `已保存到槽位 ${slot + 1}`)
  }
}
/**从所选槽位读档(读档前自动保存当前进度;空槽位自动创建新存档) */
export async function doLoad() {
  const slot = await openSlots({ title: '选择读档槽位', mode: 'load' })
  if (slot == null) return
  localSave()
  let ok = false
  try {
    ok = localLoad(slot)
  } catch {
    ok = false
  }
  if (ok) {
    setCurrentSlot(slot)
    addLog('info', `已从槽位 ${slot + 1} 读档`)
  } else if (hasSlotSave(slot)) {
    addLog('error', `槽位 ${slot + 1} 读档失败,存档内容可能无效`)
  } else {
    setCurrentSlot(slot)
    hardReset()
    addLog('info', `槽位 ${slot + 1} 为空,已自动创建新存档`)
  }
}
/**硬重置(始终二次确认) */
export async function doHardReset() {
  const confirmed = await openConfirm({
    title: '硬重置',
    text: '将清空所有进度并重新开始!\n此操作不可撤销,建议先导出存档。',
    confirmText: '确认重置',
    cancelText: '取消',
  })
  if (confirmed) hardReset()
}