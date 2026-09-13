//运行期缓存数据(不写入存档)
//放在data层:access/compute/logic/app都需要读取,避免出现向上引用app的依赖倒挂
import { reactive } from 'vue'
import Decimal from 'break_eternity.js'
import type { LayerList } from './types'

export const temp = reactive({
  /**
   * 临时层(预览层)表,键为含-1的坐标字符串
   * 临时层只是"将要解锁的最高层级"的预览:不参与生产、不提供任何加成、没有自动化配置,
   * 唯一作用是作为重置目标来解锁下一个层级(见logic/layerStructure.unlockNextLayer)
   */
  tempLayers: {} as LayerList,
  /**伪现实速度初始值(调试用,不存档) */
  debugSpeed: new Decimal(1),
  /**调试模式开关(不存档,生产构建中入口隐藏) */
  debugMode: false,
})

/**清空全部临时层(读档/硬重置/无限重置时调用) */
export function clearTempLayers() {
  for (const key of Object.keys(temp.tempLayers)) delete temp.tempLayers[key]
}
