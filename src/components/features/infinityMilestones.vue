<script setup lang="ts">
import { computed } from 'vue'
import { formatWhole } from '@/tools/format'
import { player } from '@/data/player'
import {
  getInfinityMilestones,
  hasInfinityMilestone,
  infinityMilestoneEffectValue,
  type InfinityMilestoneDef,
} from '@/compute/infinityMilestones'

/**全部里程碑(按解锁阈值升序) */
const milestones = computed<InfinityMilestoneDef[]>(() => getInfinityMilestones())
/**某里程碑是否已解锁(样式与数值文字共用) */
function unlocked(def: InfinityMilestoneDef): boolean {
  return hasInfinityMilestone(def.id)
}
</script>
<template>
  <div id="milestones">
    <span class="text">已进行 {{ formatWhole(player.infinityResets) }} 次无限重置</span>

    <div id="milestoneList">
      <div
        v-for="def in milestones"
        :key="def.id"
        :class="['card', 'section', 'box', { bought: unlocked(def) }]"
      >
        <span class="text bold title">{{ def.name }}</span>
        <span class="text desc">{{ def.description }}</span>
        <span class="text value">当前: {{ infinityMilestoneEffectValue(def) }}</span>
      </div>
    </div>
  </div>
</template>
<style scoped>
div#milestones {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  box-sizing: border-box;
}
div#milestoneList {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
/*卡片大小与子节点位置固定一致:三行(解锁条件/效果描述/当前数值)高度一致,长描述自动换行*/
div.card {
  width: 250px;
  min-height: 96px;
  justify-content: flex-start;
  box-sizing: border-box;
}
div.card span.title {
  font-size: 14px;
}
div.card span.desc {
  font-size: 12px;
  text-align: center;
}
div.card span.value {
  font-size: 12px;
  color: var(--accent);
}
</style>
