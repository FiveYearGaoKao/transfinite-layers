//主标签列表/层级选择/子标签循环的公共计算(导航栏与快捷键共用)
import { computed } from 'vue'
import { player, type mainTabs as MainTabId } from '@/data/player'
import type { LayerId } from '@/data/types'
import { getLayer, getLayerRows, hasAchievement, hasAnyUpgrade } from '@/access'
import { getMetaLayers } from '@/meta/registry'

export interface TabInfo {
  id: MainTabId
  name: string
  meta: boolean
}

/**主标签列表(按解锁条件过滤,导航栏显示与数字键切换共用) */
export const mainTabsList = computed<TabInfo[]>(() => {
  const list: TabInfo[] = [
    { id: 'layers', name: '层级', meta: false },
    { id: 'options', name: '选项', meta: false },
    { id: 'achievements', name: '成就', meta: false },
    { id: 'knowledge', name: '知识', meta: false },
  ]
  if (hasAchievement('a28')) {
    list.push({ id: 'challenges', name: '挑战', meta: false })
  }
  //自动化标签页:首次购买u4后永久解锁(即使u4~u6被重置,配置仍在,需要能调整开关)
  if (hasAnyUpgrade(4) || player.automationUnlocked) {
    list.push({ id: 'automation', name: '自动化', meta: false })
  }
  for (const m of getMetaLayers()) {
    if (m.isUnlocked()) list.push({ id: m.id as MainTabId, name: m.name ?? m.id, meta: true })
  }
  return list
})

/**层级选择列表:与层级页按钮矩阵一致(含临时层),用于左右键循环切换 */
function layerSelection(): LayerId[] {
  return getLayerRows(player.layerSubtab)
    .flat()
    .filter((c) => getLayer(c.pos))
    .map((c) => c.pos)
}

/**左右键循环切换所选层级 */
export function cycleLayer(dir: 1 | -1) {
  const list = layerSelection()
  if (list.length == 0) return
  const idx = list.findIndex((p) => p.toString() == player.layerSubtab.toString())
  const base = idx < 0 ? 0 : idx
  player.layerSubtab = list[(base + dir + list.length) % list.length] ?? player.layerSubtab
}

//------子标签循环(各页面挂载时注册)------
/**子标签循环函数 */
type SubtabCycler = (dir: 1 | -1) => void
const subtabCyclers = new Map<string, SubtabCycler>()
/**注册某主标签的子标签循环器(页面挂载时调用) */
export function registerSubtabCycler(mainTab: string, fn: SubtabCycler) {
  subtabCyclers.set(mainTab, fn)
}
/**注销某主标签的子标签循环器(页面卸载时调用) */
export function unregisterSubtabCycler(mainTab: string) {
  subtabCyclers.delete(mainTab)
}
/**左右键循环当前页面的子标签 */
export function cycleCurrentSubtab(dir: 1 | -1) {
  subtabCyclers.get(player.mainTab)?.(dir)
}
