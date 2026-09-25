<script setup lang="ts">
import { computed } from 'vue'
import { settings } from '@/app/settings'
import { RESOURCE_ITEMS } from '@/app/resourceRegistry'

/**按设置过滤后的资源条目(表格布局,行优先填充) */
const resources = computed(() => {
  const items: { label: string; value: string }[] = []
  for (const r of RESOURCE_ITEMS) {
    if (!settings.resourceBarItems[r.id]) continue
    items.push(...r.resolve())
  }
  return items
})
</script>
<template>
  <div id="resourceBar">
    <div class="resItem" v-for="(r, i) in resources" :key="r.label + i">
      <span class="label">{{ r.label }}</span>
      <span class="value">{{ r.value }}</span>
    </div>
  </div>
</template>
<style scoped>
div#resourceBar {
  border: 2px solid var(--dim);
  width: 100%;
  box-sizing: border-box;
  /*表格布局:4行,从上到下、从左到右填充*/
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(4, auto);
  gap: 4px 28px;
  padding: 6px 12px;
  justify-content: start;
  align-content: start;
  /*条目多(层级多)时列数会超过容器宽度:横向滚动而不是溢出到视口外*/
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
div.resItem {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}
span.label {
  font-size: 13px;
  color: var(--dim);
}
span.value {
  font-size: 14px;
  font-weight: bold;
  color: var(--text);
}
</style>
