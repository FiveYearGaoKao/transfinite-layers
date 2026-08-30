<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { player } from '@/data/player'
import { getLayerName } from '@/access'
import { format, formatWhole } from '@/tools/format'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import {
  challengeDone,
  challengeGoal,
  challengeGoalLayer,
  challengeResource,
  challengeRewardValue,
  completions,
  completeChallenge,
  enterChallenge,
  exitChallenge,
  getAllChallenges,
  getChallenges,
  isActive,
  isUnlocked,
  type ChallengeDef,
} from '@/logic/challenges'

/**子标签列表(普通常显,其余按注册表自动出现) */
const subtabs = computed(() => {
  const layers = ['normal']
  for (const c of getAllChallenges()) {
    if (!layers.includes(c.layer)) layers.push(c.layer)
  }
  return layers
})
/**子标签显示名 */
const layerName: Record<string, string> = { normal: '普通' }
const subtab = ref<string>(
  subtabs.value.includes(player.challengeTab) ? player.challengeTab : 'normal',
)
watch(subtab, (v) => (player.challengeTab = v))
/**挑战页子标签的循环切换(快捷键左右键用) */
onMounted(() =>
  registerSubtabCycler('challenges', (dir) => {
    const list = subtabs.value
    if (list.length == 0) return
    const idx = list.indexOf(subtab.value)
    subtab.value = list[(idx + dir + list.length) % list.length] ?? 'normal'
  }),
)
onUnmounted(() => unregisterSubtabCycler('challenges'))

/**当前子标签下的所有挑战 */
const challengeList = computed(() => getChallenges(subtab.value))

/**目标资源文字(如"层级1点数") */
function goalTypeText(def: ChallengeDef): string {
  const type = def.goalType == 'energy' ? '能量' : '点数'
  return getLayerName(challengeGoalLayer(def)) + type
}

/**进度百分比(0~100,溢出或非法时取边界) */
function progressPercent(def: ChallengeDef): number {
  const ratio = challengeResource(def).div(challengeGoal(def))
  if (!ratio.isFinite()) return 100
  return Math.max(0, Math.min(100, ratio.mul(100).toNumber()))
}
</script>
<template>
  <div id="challenges">
    <div class="subtabRow">
      <button
        v-for="layer in subtabs"
        :key="layer"
        :class="{ subTab: true, selected: subtab == layer }"
        @click="subtab = layer"
      >
        {{ layerName[layer] ?? layer }}
      </button>
    </div>

    <div id="challengeList">
      <div
        v-for="def in challengeList"
        :key="def.id"
        class="challenge"
        :class="{ active: isActive(def), locked: !isUnlocked(def) }"
      >
        <span class="text bold name">{{ def.name }}({{ formatWhole(completions(def)) }})</span>
        <span class="text">{{ def.description }}</span>
        <span class="text">进入后重置: {{ getLayerName(def.resetTarget) }}</span>
        <span class="text reward">奖励: {{ def.rewardText }}</span>
        <span class="text rewardValue">当前: {{ challengeRewardValue(def) }}</span>
        <div class="info">
          <span v-if="!isUnlocked(def)" class="text lockInfo">
            解锁条件: 达到{{ getLayerName(def.unlockLayer) }}
          </span>
          <template v-else-if="isActive(def)">
            <span class="text">
              进度: {{ format(challengeResource(def)) }} / {{ formatWhole(challengeGoal(def)) }}
              {{ goalTypeText(def) }}
            </span>
            <div class="progressBar">
              <div class="progressFill" :style="{ width: progressPercent(def) + '%' }"></div>
            </div>
          </template>
          <span v-else class="text">
            目标: {{ formatWhole(challengeGoal(def)) }} {{ goalTypeText(def) }}
          </span>
        </div>
        <button
          v-if="isUnlocked(def) && !isActive(def)"
          class="toggle selected"
          @click="enterChallenge(def)"
        >
          进入
        </button>
        <button
          v-else-if="isActive(def) && !challengeDone(def)"
          class="toggle toggle-off"
          @click="exitChallenge(def)"
        >
          提前退出
        </button>
        <button
          v-else-if="isActive(def) && challengeDone(def)"
          class="toggle toggle-on"
          @click="completeChallenge(def)"
        >
          完成并退出
        </button>
        <button v-else class="toggle" disabled>未解锁</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
div#challenges {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
div#challengeList {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  width: 100%;
}
div.challenge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  border: 2px solid var(--dim);
  padding: 6px;
  width: 240px;
  height: 240px;
  box-sizing: border-box;
  &.active {
    border-color: var(--good-border);
  }
  &.locked {
    color: var(--faint);
    opacity: 0.7;
  }
}
div.challenge .name {
  font-size: 16px;
}
div.challenge .reward {
  color: var(--good-border);
}
div.challenge .rewardValue {
  color: var(--accent);
  font-size: 13px;
}
div.challenge .lockInfo {
  color: var(--faint);
}
div.challenge .info {
  height: 48px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
div.progressBar {
  width: 100%;
  height: 12px;
  border: 1px solid var(--dim);
  background-color: var(--input-bg);
  box-sizing: border-box;
}
div.progressFill {
  height: 100%;
  background-color: var(--good-bg);
}
</style>