<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { player } from '@/data/player'
import {
  getNormalAchievements,
  getSecretAchievements,
  type AchievementDef,
} from '@/logic/achievements'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import { STORY } from '@/data/story'

type achTab = 'achievements' | 'secrets' | 'story'
const subtab = ref<achTab>('achievements')
/**成就页子标签的循环切换(快捷键左右键用) */
const ACH_TABS: achTab[] = ['achievements', 'secrets', 'story']
onMounted(() =>
  registerSubtabCycler('achievements', (dir) => {
    const idx = ACH_TABS.indexOf(subtab.value)
    subtab.value = ACH_TABS[(idx + dir + ACH_TABS.length) % ACH_TABS.length] ?? 'achievements'
  }),
)
onUnmounted(() => unregisterSubtabCycler('achievements'))
/**普通(非隐藏)成就列表 */
const normalAchs = computed(() => getNormalAchievements())
/**隐藏成就列表 */
const secretAchs = computed(() => getSecretAchievements())
/**已解锁的非隐藏成就数 */
const unlockedNormalCount = computed(
  () => player.achievements.filter((id) => normalAchs.value.some((a) => a.id == id)).length,
)
/**某成就是否已解锁 */
function isUnlocked(a: AchievementDef): boolean {
  return player.achievements.includes(a.id)
}
/**成就显示名称(隐藏成就的名称作为提示,始终显示) */
function achName(a: AchievementDef): string {
  return a.name
}
/**成就显示描述(未解锁的隐藏成就显示"???") */
function achDesc(a: AchievementDef): string {
  return a.secret && !isUnlocked(a) ? '???' : a.description
}
/**当前悬停的成就及其tooltip位置 */
const tip = ref<{ def: AchievementDef; x: number; y: number } | null>(null)
/**显示成就tooltip(定位在卡片上方) */
function showTip(def: AchievementDef, e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tip.value = { def, x: rect.left + rect.width / 2, y: rect.top }
}
</script>
<template>
  <div id="achievements">
    <div class="subtabRow">
      <button
        :class="{ subTab: true, selected: subtab == 'achievements' }"
        @click="subtab = 'achievements'"
      >
        成就
      </button>
      <button :class="{ subTab: true, selected: subtab == 'secrets' }" @click="subtab = 'secrets'">
        隐藏成就
      </button>
      <button :class="{ subTab: true, selected: subtab == 'story' }" @click="subtab = 'story'">
        剧情
      </button>
    </div>

    <div v-if="subtab == 'achievements'">
      <span class="text">已解锁成就: {{ unlockedNormalCount }} / {{ normalAchs.length }}</span>
      <div id="achievementList">
        <div
          v-for="a in normalAchs"
          :key="a.id"
          :class="['achievement', isUnlocked(a) ? 'bought' : '']"
          @mouseenter="showTip(a, $event)"
          @mouseleave="tip = null"
        >
          <span class="text name">{{ achName(a) }}</span>
          <span class="text reward">+{{ a.reward }} 知识</span>
        </div>
      </div>
    </div>

    <div v-else-if="subtab == 'secrets'">
      <span class="text"
        >已解锁隐藏成就:
        {{ player.achievements.filter((id) => secretAchs.some((a) => a.id == id)).length }} /
        {{ secretAchs.length }}</span
      >
      <div id="achievementList">
        <div
          v-for="a in secretAchs"
          :key="a.id"
          :class="['achievement', isUnlocked(a) ? 'bought' : '']"
          @mouseenter="showTip(a, $event)"
          @mouseleave="tip = null"
        >
          <span class="text name">{{ achName(a) }}</span>
          <span class="text reward">+{{ a.reward }} 知识</span>
        </div>
      </div>
    </div>

    <div v-else id="storyList">
      <span v-if="STORY.length == 0" class="text">暂无剧情</span>
      <div v-for="c in STORY" :key="c.id" class="story" :class="{ locked: !c.isUnlocked() }">
        <span class="text bold">{{ c.title }}</span>
        <span class="text" v-if="c.isUnlocked()">{{ c.text }}</span>
        <span class="text" v-else>未解锁</span>
      </div>
    </div>
  </div>
  <Teleport to="body">
    <div v-if="tip" class="achievementTip" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">
      {{ achDesc(tip.def) }}
      <div v-if="tip.def.effectText" class="effect">{{ tip.def.effectText }}</div>
    </div>
  </Teleport>
</template>
<style scoped>
div#achievements {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
div#achievementList {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  width: 100%;
  box-sizing: border-box;
}
div.achievement {
  border: 2px solid var(--faint);
  padding: 4px;
  background-color: var(--panel);
  color: var(--faint);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 52px;
  box-sizing: border-box;
  &.bought {
    border-color: var(--good-border);
    background-color: var(--good-bg);
    color: var(--text);
  }
}
div.achievement .name {
  font-size: 13px;
}
div.achievement .reward {
  font-size: 11px;
}
div.achievementTip {
  position: fixed;
  transform: translate(-50%, -100%);
  background-color: var(--panel);
  border: 1px solid var(--dim);
  color: var(--text);
  padding: 4px;
  z-index: 1000;
  max-width: 260px;
  font-size: 12px;
  pointer-events: none;
}
div.achievementTip .effect {
  color: var(--accent);
  margin-top: 2px;
}
div.story {
  border: 2px solid var(--faint);
  width: 360px;
  padding: 4px;
  &.locked {
    color: var(--faint);
  }
}
/*按主体实际宽度调整列数(容器查询,而非视口宽度)*/
@container (max-width: 900px) {
  div#achievementList {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
@container (max-width: 680px) {
  div#achievementList {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@container (max-width: 460px) {
  div#achievementList {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
