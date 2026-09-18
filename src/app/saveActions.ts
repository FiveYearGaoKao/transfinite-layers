//存档工作流:槽位选择对话框 + 存档/读档/硬重置动作(UI层编排,供选项页/工具栏复用)
//依赖对话框(ui)与存档操作,不能下沉到logic/save层,否则违反单向依赖
import { openAlert, openConfirm, openSlots } from '@/app/dialog'
import { addLog } from '@/data/log'
import { gameName, gameVersion } from '@/data/constants'
import {
  LOAD_EMPTY,
  clearSlot,
  getCurrentSlot,
  getLastSaveProblems,
  getRawSaveString,
  hardReset,
  localLoad,
  localSave,
  setCurrentSlot,
} from '@/save/save'

/**下载一个文本文件(存档导出用) */
export function downloadTextFile(text: string, fileName: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**导出某槽位的原始存档字符串为文件(读档失败时用:不经序列化,导出的一定是原先存下的内容) */
export function exportRawSave(slot: number = getCurrentSlot()) {
  const raw = getRawSaveString(slot)
  if (raw == null) {
    addLog('warning', '该槽位没有存档内容可导出')
    return
  }
  downloadTextFile(raw, `${gameName}-${gameVersion}-slot${slot + 1}-raw.txt`)
  addLog('info', `槽位 ${slot + 1} 的原始存档已导出为文件`)
}

/**
 * 读档失败的处理:询问玩家导出原存档文本,或跳过(清空该槽位)
 * 从输入框/文件导入时玩家手里已有存档文件,不需要调用本函数
 * 注:这里只负责导出/清空,**不"保护"坏档**——启动路径在对话框关闭前不会开始自动保存,
 *   对话框关闭后该槽位即不再受保护(导出分支下会被后续自动保存覆盖)
 * @returns 玩家是否选择了"跳过"(即该槽位已被清空)
 */
export async function handleFailedLoad(code: number, slot: number): Promise<boolean> {
  const exportIt = await openConfirm({
    title: '读档失败',
    text:
      `槽位 ${slot + 1} 的存档加载失败(错误码 ${code})。\n` +
      `你可以导出存档文本(之后该槽位会被新存档覆盖),或点击"跳过"清空该槽位。`,
    confirmText: '导出存档文本',
    cancelText: '跳过',
  })
  if (exportIt) {
    exportRawSave(slot)
    return false
  }
  clearSlot(slot)
  addLog('warning', `槽位 ${slot + 1} 的存档已清空`)
  return true
}

/**上一次保存失败的问题签名(同一问题不再弹窗,只在日志里降级提示) */
let lastSaveIssue = ''

/**
 * 保存并对失败做统一反馈
 * 首次出现(或问题内容变化):写 error 日志并弹一次警告;同一问题再次出现:只写 warning 日志
 * @returns 是否保存成功
 */
export function saveGame(slot?: number): boolean {
  const ok = slot == undefined ? localSave() : localSave(slot)
  if (ok) {
    lastSaveIssue = ''
    return true
  }
  const problems = getLastSaveProblems()
  const signature = problems.join('|')
  if (signature == lastSaveIssue) {
    addLog('warning', '当前存档存在问题,已跳过本次保存,请及时导出存档,防止进度丢失。')
    return false
  }
  lastSaveIssue = signature
  addLog(
    'error',
    `保存失败:存档中存在${problems.length}处非法值,已跳过本次保存(原存档未被覆盖)\n` +
      `${problems.join('\n')}`,
  )
  void openAlert({
    title: '保存失败',
    text:
      `当前存档存在${problems.length}处非法值(见日志),已跳过本次保存。\n` +
      `你可以导出存档以查看问题,或读档回到上一次成功的存档。`,
    confirmText: '知道了',
  })
  return false
}

/**保存到所选槽位(弹出槽位选择框) */
export async function doSave() {
  const slot = await openSlots({ title: '选择保存槽位', mode: 'save' })
  if (slot == null) return
  if (!saveGame(slot)) return
  setCurrentSlot(slot)
  addLog('info', `已保存到槽位 ${slot + 1}`)
}

/**从所选槽位读档(读档前自动保存当前进度;空槽位自动创建新存档;失败时不覆盖并询问是否导出) */
export async function doLoad() {
  const slot = await openSlots({ title: '选择读档槽位', mode: 'load' })
  if (slot == null) return
  saveGame()
  let code: number
  try {
    code = localLoad(slot)
  } catch {
    code = 101
  }
  if (code == 0) {
    setCurrentSlot(slot)
    addLog('info', `已从槽位 ${slot + 1} 读档`)
  } else if (code == LOAD_EMPTY) {
    setCurrentSlot(slot)
    hardReset()
    addLog('info', `槽位 ${slot + 1} 为空,已自动创建新存档`)
  } else {
    addLog('error', `槽位 ${slot + 1} 读档失败(错误码 ${code})`)
    //此时尚未切换到该槽位:自动保存继续写原槽位,目标槽位由玩家选择导出或清空
    await handleFailedLoad(code, slot)
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
