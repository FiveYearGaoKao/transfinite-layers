//储存游戏日志
import { reactive } from 'vue'
const MAX_LOG_COUNT = 100
export type logType = 'info' | 'warning' | 'error' | 'progress' | 'automator'
export interface log {
  id: number
  time: number
  type: logType
  text: string
  /**相同日志出现的次数 */
  count: number
}
export const logs = reactive([] as log[])
let logId = 0
export function addLog(type: logType, text: string) {
  //类型和文字均相同的日志合并为一条，标注重复次数
  const last = logs[logs.length - 1]
  if (last?.type == type && last?.text == text) {
    last.count++
    last.time = Date.now()
  } else {
    logs.push({ id: ++logId, time: Date.now(), type: type, text: text, count: 1 })
    if (logs.length > MAX_LOG_COUNT) logs.shift()
  }
}
/**清空所有日志 */
export function clearLogs() {
  logs.splice(0, logs.length)
}
