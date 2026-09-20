<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { player } from '@/data/player'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import { getChallenges, isInfinityChallengeUnlocked, type ChallengeLayer } from '@/logic/challenges'
import ChallengeCard from './challengeCard.vue'

/**子标签列表(普通常显;无限挑战购买IU15后出现,其余按注册表自动出现) */
const subtabs = computed<ChallengeLayer[]>(() => {
  const layers: ChallengeLayer[] = ['normal']
  if (isInfinityChallengeUnlocked()) layers.push('infinity')
  return layers
})
/**子标签显示名 */
const layerName: Record<string, string> = { normal: '普通挑战', infinity: '无限挑战' }
const subtab = ref<ChallengeLayer>(
  subtabs.value.includes(player.challengeTab as ChallengeLayer)
    ? (player.challengeTab as ChallengeLayer)
    : 'normal',
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
      <ChallengeCard v-for="def in challengeList" :key="def.id" :def="def" />
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
</style>
