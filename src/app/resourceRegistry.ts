//资源栏条目注册表:显示哪些资源可在选项页自定义
import { computed } from 'vue'
import { format } from '@/tools/format'
import { getActiveLayers, getEnergy, getHighestActiveLayer, getLayerName, getPoints } from '@/access'
import { isLayer0 } from '@/tools/ordinal'
import { player } from '@/data/player'
import { getChallenge } from '@/logic/challenges'

/**一条资源(可展开为多个显示行,如"其它层") */
export interface ResourceDef {
  id: string
  label: string
  resolve(): { label: string; value: string }[]
}

/**当前最高的活跃层级 */
const highestLayer = computed(() => getHighestActiveLayer())

/**所有可显示的资源 */
export const RESOURCE_ITEMS: ResourceDef[] = [
  {
    id: 'highest',
    label: '最高层级',
    resolve() {
      return highestLayer.value ? [{ label: '最高层级', value: getLayerName(highestLayer.value) }] : []
    },
  },
  {
    id: 'points',
    label: '点数',
    resolve() {
      return [{ label: '点数', value: format(getPoints([0])) }]
    },
  },
  {
    id: 'knowledge',
    label: '知识',
    resolve() {
      return player.knowledge.gt(0) ? [{ label: '知识', value: format(player.knowledge) }] : []
    },
  },
  {
    id: 'challenge',
    label: '当前挑战',
    resolve() {
      return [
        {
          label: '当前挑战',
          value: player.activeChallenges.length
            ? player.activeChallenges.map((id) => getChallenge(id)?.name ?? id).join(',')
            : '无',
        },
      ]
    },
  },
  {
    id: 'otherLayers',
    label: '其它层',
    resolve() {
      const rows: { label: string; value: string }[] = []
      for (const { pos, L } of getActiveLayers()) {
        if (isLayer0(pos)) continue
        const name = getLayerName(pos)
        rows.push({ label: `${name} 点数`, value: format(L.points) })
        if (getEnergy(pos).gt(0)) rows.push({ label: `${name} 能量`, value: format(L.energy) })
      }
      return rows
    },
  },
]
