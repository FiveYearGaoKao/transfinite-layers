<script setup lang="ts">
import { computed } from 'vue'
import { format, formatWhole } from '@/tools/format'
import { getPoints } from '@/access'
import { player } from '@/data/player'
import { INFINITY_UNLOCK_POINTS } from '@/data/constants'
import {
  canInfinityReset,
  getInfinityUpgrade,
  infinityGain,
  type InfinityUpgradeDef,
} from '@/compute/infinity'
import { infinityResetConfirm } from '@/app/uiActions'
import InfinityUpgradeItem from './infinityUpgradeItem.vue'

/**5x5升级表:行×列(25格全部已定义) */
const iuGrid = computed<InfinityUpgradeDef[][]>(() =>
  Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => getInfinityUpgrade(`iu${r + 1}${c + 1}`)!),
  ),
)
</script>
<template>
  <div id="infinity">
    <span class="text bold">无限</span>
    <span class="text">
      你拥有 <span class="text-highlight">{{ formatWhole(player.infinityPoints) }}</span> 无限点数
      (IP)
    </span>
    <span class="text">已进行 {{ formatWhole(player.infinityResets) }} 次无限重置</span>
    <div class="prestigeRow">
      <button
        :class="['prestige', 'meta', canInfinityReset() ? 'affordable' : '']"
        :disabled="!canInfinityReset()"
        @click="infinityResetConfirm()"
      >
        +{{ formatWhole(infinityGain()) }} 无限点数
      </button>
      <span class="text">(快捷键 I)</span>
    </div>
    <span v-if="!canInfinityReset()" class="text">
      需要 {{ formatWhole(INFINITY_UNLOCK_POINTS) }} 层级0点数才能无限重置 (当前
      {{ format(getPoints([0])) }})
    </span>

    <div id="infinityUpgrades">
      <span class="sectionTitle">无限升级</span>
      <div v-for="(row, r) in iuGrid" :key="r" class="iuRow">
        <InfinityUpgradeItem v-for="(def, c) in row" :key="c" :def="def" />
      </div>
      <span class="text faint">
        同一列必须从上到下购买。部分升级的效果与价格仍在测试调整中。
      </span>
    </div>
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
  gap: 6px;
}
div#infinityUpgrades {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
}
div.iuRow {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
span.sectionTitle {
  font-size: 14px;
  font-weight: bold;
  color: var(--dim);
  border-bottom: 1px solid var(--faint);
  padding-bottom: 2px;
}
span.faint {
  color: var(--faint);
  font-size: 12px;
}
</style>
