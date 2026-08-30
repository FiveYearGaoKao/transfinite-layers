//指令输入框聚焦的共享入口:工具栏挂载时注册处理函数,快捷键("/")调用
/**指令输入框的聚焦处理函数(由工具栏在挂载/卸载时注册,未挂载时为null) */
let handler: (() => void) | null = null
/**注册指令输入框的聚焦处理函数(工具栏挂载时调用) */
export function setCommandFocusHandler(fn: (() => void) | null) {
  handler = fn
}
/**请求聚焦指令输入框并输入一个"/"(快捷键调用;指令输入框未挂载时无效果) */
export function focusCommandInput() {
  handler?.()
}
