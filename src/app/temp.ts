//储存各种不写入存档的缓存数据
import { reactive } from 'vue'
import type { LayerList } from '@/data/types'
import Decimal from 'break_eternity.js'
export const temp = reactive({
  tempLayers: {} as LayerList,
  /**伪现实速度初始值(调试用,不存档) */
  debugSpeed: new Decimal(1),
  /**调试模式开关(不存档,生产构建中入口隐藏) */
  debugMode: false,
})
