<script setup lang="ts">
import { computed, reactive } from 'vue'
import { format } from '@/tools/format'
import type { StatNode } from '@/compute/statistics'

const props = defineProps<{
  nodes: StatNode[]
}>()

/**已展开的节点key */
const expanded = reactive(new Set<string>())
/**切换某节点的展开状态 */
function toggle(key: string) {
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
}
/**展开状态下的拍平行 */
interface FlatRow {
  key: string
  label: string
  /**整行数值文本(软上限是"原值 → 新值") */
  display: string
  note?: string
  depth: number
  hasChildren: boolean
}
/**该节点的子节点是否值得展开:只有"初始值"一个子节点时展开没有信息(本行已经显示了同一个值) */
function hasExpandableChildren(n: StatNode): boolean {
  return n.children.length > 1 || (n.children.length == 1 && n.children[0]!.label != '初始值')
}
const flatTree = computed<FlatRow[]>(() => {
  const out: FlatRow[] = []
  const walk = (nodes: StatNode[], depth: number) => {
    for (const n of nodes) {
      out.push({
        key: n.key,
        label: n.label,
        display: n.text ?? `${n.sign}${format(n.value)}`,
        note: n.note,
        depth,
        hasChildren: hasExpandableChildren(n),
      })
      if (expanded.has(n.key)) walk(n.children, depth + 1)
    }
  }
  walk(props.nodes, 0)
  return out
})
</script>
<template>
  <div class="statTree">
    <div
      v-for="row in flatTree"
      :key="row.key"
      class="statRow"
      :class="{ clickable: row.hasChildren }"
      :style="{ paddingLeft: row.depth * 18 + 'px' }"
      @click="row.hasChildren && toggle(row.key)"
    >
      <span class="text">
        <span class="statArrow">{{
          row.hasChildren ? (expanded.has(row.key) ? '▼' : '▶') : '·'
        }}</span
        >{{ row.label }} {{ row.display
        }}<span v-if="row.note" class="statNote"> ({{ row.note }})</span>
      </span>
    </div>
  </div>
</template>
<style scoped>
div.statTree {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 260px;
}
div.statRow {
  cursor: default;
  width: 100%;
  padding: 1px 4px;
  transition: all 200ms;
}
div.statRow.clickable {
  cursor: pointer;
}
div.statRow.clickable:hover {
  background-color: var(--hover);
}
span.statArrow {
  display: inline-block;
  width: 14px;
  color: var(--dim);
}
span.statNote {
  color: var(--dim);
}
</style>
