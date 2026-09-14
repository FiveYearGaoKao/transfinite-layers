<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatWhole } from '@/tools/format'
import { player, type InfinitySubtab } from '@/data/player'
import { INFINITY_UNLOCK_POINTS } from '@/data/constants'
import {
  canInfinityReset,
  getInfinityUpgrade,
  infinityGain,
  type InfinityUpgradeDef,
} from '@/compute/infinity'
import { hasInfinityMilestone } from '@/compute/infinityMilestones'
import { getInfinityAuto, toggleAutoInfinity } from '@/logic/infinity'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import { infinityResetConfirm } from '@/app/uiActions'
import InfinityUpgradeItem from './infinityUpgradeItem.vue'
import InfinityMilestones from './infinityMilestones.vue'

/**无限页的子标签 */
const SUBTABS: { id: InfinitySubtab; name: string }[] = [
  { id: 'upgrades', name: '无限升级' },
  { id: 'milestones', name: '无限里程碑' },
]
/**当前子标签(非法值回落"无限升级") */
const subtab = ref<InfinitySubtab>(
  SUBTABS.some((t) => t.id == player.infinityTab) ? player.infinityTab : 'upgrades',
)
watch(subtab, (v) => (player.infinityTab = v))
/**无限页子标签的循环切换(快捷键左右键用) */
onMounted(() =>
  registerSubtabCycler('infinity', (dir) => {
    const idx = SUBTABS.findIndex((t) => t.id == subtab.value)
    subtab.value = SUBTABS[(idx + dir + SUBTABS.length) % SUBTABS.length]?.id ?? 'upgrades'
  }),
)
onUnmounted(() => unregisterSubtabCycler('infinity'))

/**自动无限重置是否已解锁(无限里程碑im10);本页只控制总开关,精细配置在自动化页 */
const autoUnlocked = computed(() => hasInfinityMilestone('im10'))
/**自动无限重置配置 */
const autoCfg = computed(() => getInfinityAuto())
/**自动已开启但一个触发条件都没设(条件配置在自动化页的"无限"子标签) */
const autoNeedsConfig = computed(
  () =>
    autoCfg.value.enabled &&
    !(autoCfg.value.useTime || autoCfg.value.usePoint || autoCfg.value.useMult),
)

/**5x5升级表:行×列(25格全部已定义) */
const iuGrid = computed<InfinityUpgradeDef[][]>(() =>
  Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => getInfinityUpgrade(`iu${r + 1}${c + 1}`)!),
  ),
)

/**
 * 无限重置按钮的文字:可重置时为收益,否则为解锁门槛
 * 自动无限重置下"点数是否达标"会高频变化,按钮因此改用固定宽度,避免文字长短变化导致下方内容抖动
 */
const resetButtonText = computed(() =>
  canInfinityReset()
    ? `+${formatWhole(infinityGain())} 无限点数`
    : `需要${formatWhole(INFINITY_UNLOCK_POINTS)}点数`,
)
</script>
<template>
  <div id="infinity">
    <div class="subtabRow">
      <button
        v-for="t in SUBTABS"
        :key="t.id"
        :class="['subTab', { selected: subtab == t.id }]"
        @click="subtab = t.id"
      >
        {{ t.name }}
      </button>
    </div>

    <div class="prestigeRow">
      <button
        :class="['prestige', 'meta', canInfinityReset() ? 'affordable' : '']"
        :disabled="!canInfinityReset()"
        @click="infinityResetConfirm()"
      >
        {{ resetButtonText }}
      </button>
      <button
        v-if="autoUnlocked"
        :class="['toggle', autoCfg.enabled ? 'toggle-on' : 'toggle-off']"
        @click="toggleAutoInfinity()"
      >
        自动:{{ autoCfg.enabled ? '开' : '关' }}
      </button>
    </div>
    <span class="text">
      你拥有 <span class="text-highlight">{{ formatWhole(player.infinityPoints) }}</span> 无限点数
    </span>
    <span v-if="autoNeedsConfig" class="text faint">
      自动无限重置已开启,但尚未设置触发条件(见自动化页→无限)
    </span>

    <div v-if="subtab == 'upgrades'" id="infinityUpgrades">
      <div v-for="(row, r) in iuGrid" :key="r" class="iuRow">
        <InfinityUpgradeItem v-for="(def, c) in row" :key="c" :def="def" />
      </div>
      <span class="text faint"> 同一列必须从上到下购买。部分升级的效果与价格仍在测试调整中。 </span>
    </div>

    <InfinityMilestones v-else />
  </div>
</template>
<style scoped>
.text-highlight {
  font-size: 18px;
  color: var(--strong);
  text-shadow: 1px 1px var(--shadow);
}
div#infinity {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  min-height: 100%;
  box-sizing: border-box;
  background-color: var(--bg);
}
div.prestigeRow {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
}
div#infinityUpgrades {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
div.iuRow {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
span.faint {
  color: var(--faint);
  font-size: 12px;
}
</style>
