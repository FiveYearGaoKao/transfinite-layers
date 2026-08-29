<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Decimal from 'break_eternity.js'
import { format, formatTime } from '@/tools/format'
import { player } from '@/data/player'
import { settings, saveSettings } from '@/app/settings'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import {
  canShow,
  getBoostPresets,
  getKnowledgeCategories,
  getPsdSpeed,
  getUpgradesByCategory,
  hasKnowledge,
} from '@/compute/knowledge'
import {
  buyOfflineTime,
  buyOfflineTimePct,
  convertOfflineToWarp,
  convertOfflineToWarpPct,
  offlineTimeCost,
} from '@/logic/knowledge'
import KnowledgeItem from './knowledgeItem.vue'

/**知识页的子标签 */
const SUBTABS = [
  { id: 'upgrades', name: '知识升级' },
  { id: 'time', name: '时间' },
] as const
/**知识类别的显示名(未知类别显示原始id) */
const CATEGORY_NAMES: Record<string, string> = {
  time: '时间',
  bonus: '加成',
  command: '指令',
  auto: '自动化',
}
const subtab = ref('upgrades')
/**知识页子标签的循环切换(快捷键左右键用) */
onMounted(() =>
  registerSubtabCycler('knowledge', (dir) => {
    const ids = SUBTABS.map((t) => t.id)
    const idx = ids.indexOf(subtab.value as (typeof SUBTABS)[number]['id'])
    subtab.value = ids[(idx + dir + ids.length) % ids.length] ?? 'upgrades'
  }),
)
onUnmounted(() => unregisterSubtabCycler('knowledge'))
/**所有已使用的升级类别 */
const cats = computed(() => getKnowledgeCategories())
/**类别的显示名 */
function catName(c: string): string {
  return CATEGORY_NAMES[c] ?? c
}
/**某类别当前是否显示(缺省视为显示) */
function isCatVisible(c: string): boolean {
  return settings.knowledgeCategoryVisible[c] !== false
}
/**切换单个类别的显示 */
function toggleCat(c: string) {
  settings.knowledgeCategoryVisible[c] = !isCatVisible(c)
  saveSettings()
}
/**是否所有类别都显示 */
function allCatsVisible(): boolean {
  return cats.value.every(isCatVisible)
}
/**总开关:全部显示时全部隐藏,否则全部显示 */
function toggleAllCats() {
  const target = !allCatsVisible()
  for (const c of cats.value) settings.knowledgeCategoryVisible[c] = target
  saveSettings()
}
/**当前显示的升级(按类别开关与"隐藏已满级"过滤) */
const visibleUpgrades = computed(() => {
  const res = []
  for (const c of cats.value) {
    if (!isCatVisible(c)) continue
    for (const def of getUpgradesByCategory(c)) {
      if (canShow(def, settings.hideMaxedKnowledge)) res.push(def)
    }
  }
  return res
})
/**切换"隐藏已满级升级" */
function toggleHideMaxed() {
  settings.hideMaxedKnowledge = !settings.hideMaxedKnowledge
  saveSettings()
}

/**固定时长预设(秒与显示名) */
const fixedPresets: { sec: Decimal; label: string }[] = [
  { sec: new Decimal(60), label: '1分钟' },
  { sec: new Decimal(600), label: '10分钟' },
  { sec: new Decimal(3600), label: '1小时' },
  { sec: new Decimal(21600), label: '6小时' },
]
/**消耗/转换的比例预设 */
const pctPresets: number[] = [0.1, 0.5, 1]
/**按档位过滤可见的加速倍率按钮 */
const boostPresets = computed(() => getBoostPresets())
/**当前全局速度 */
const psdSpeed = computed(() => getPsdSpeed())
</script>
<template>
  <div id="knowledge">
    <span class="text bold">知识: {{ format(player.knowledge) }}</span>
    <div class="subtabRow">
      <button
        v-for="t in SUBTABS"
        :key="t.id"
        :class="{ subTab: true, selected: subtab == t.id }"
        @click="subtab = t.id"
      >
        {{ t.name }}
      </button>
    </div>

    <template v-if="subtab == 'upgrades'">
      <div class="row">
        <button
          :class="['toggle', allCatsVisible() ? 'toggle-on' : 'toggle-off']"
          @click="toggleAllCats()"
        >
          全部:{{ allCatsVisible() ? '开' : '关' }}
        </button>
        <button
          v-for="c in cats"
          :key="c"
          :class="['toggle', isCatVisible(c) ? 'toggle-on' : 'toggle-off']"
          @click="toggleCat(c)"
        >
          {{ catName(c) }}:{{ isCatVisible(c) ? '开' : '关' }}
        </button>
        <button
          :class="['toggle', settings.hideMaxedKnowledge ? 'toggle-on' : 'toggle-off']"
          @click="toggleHideMaxed()"
        >
          隐藏已满级:{{ settings.hideMaxedKnowledge ? '开' : '关' }}
        </button>
      </div>
      <div id="knowledgeUpgrades">
        <KnowledgeItem v-for="def in visibleUpgrades" :key="def.id" :def="def" />
      </div>
    </template>

    <div v-else id="offline" class="section">
      <div class="section">
        <span class="text bold">时间资源</span>
        <span class="text">离线时间: {{ formatTime(player.offlineTime) }}</span>
        <span v-if="player.warpTime.gte(1)" class="text">
          时间扭曲剩余: {{ formatTime(player.warpTime) }}
        </span>
        <span v-else class="text">时间扭曲未开启</span>
      </div>

      <div class="section">
        <span class="text bold">兑换离线时间</span>
        <span class="text">汇率: 1知识 = 1分钟离线时间</span>
        <div class="row">
          <button
            v-for="p in fixedPresets"
            :key="p.label"
            :class="['toggle', { affordable: player.knowledge.gte(offlineTimeCost(p.sec)) }]"
            :disabled="player.knowledge.lt(offlineTimeCost(p.sec))"
            @click="buyOfflineTime(p.sec)"
          >
            {{ p.label }}
          </button>
          <button
            v-for="pct in pctPresets"
            :key="pct"
            :class="['toggle', { affordable: player.knowledge.gt(0) }]"
            :disabled="player.knowledge.lte(0)"
            @click="buyOfflineTimePct(pct)"
          >
            {{ pct * 100 }}%
          </button>
        </div>
      </div>

      <div class="section">
        <span class="text bold">时间扭曲</span>
        <span class="text">消耗离线时间以获得等量的加速时间</span>
        <div class="row">
          <button
            v-for="p in fixedPresets"
            :key="p.label"
            :class="['toggle', { affordable: player.offlineTime.gte(p.sec) }]"
            :disabled="player.offlineTime.lt(p.sec)"
            @click="convertOfflineToWarp(p.sec)"
          >
            {{ p.label }}
          </button>
          <button
            v-for="pct in pctPresets"
            :key="pct"
            :class="['toggle', { affordable: player.offlineTime.gt(0) }]"
            :disabled="player.offlineTime.lte(0)"
            @click="convertOfflineToWarpPct(pct)"
          >
            {{ pct * 100 }}%
          </button>
        </div>
      </div>

      <div class="section" v-if="hasKnowledge('time-boost')">
        <span class="text bold">加速</span>
        <span class="text">加速消耗离线时间,稳定提升全局速度</span>
        <span class="text">当前全局速度: x{{ format(psdSpeed) }}</span>
        <div class="row">
          <button
            v-for="p in boostPresets"
            :key="p"
            :class="['subTab', { selected: player.boostSpeed.eq(p) }]"
            @click="player.boostSpeed = new Decimal(p)"
          >
            x{{ p }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
div#knowledge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
div#knowledgeUpgrades {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
</style>
