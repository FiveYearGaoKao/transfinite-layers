<script setup lang="ts">
import { formatWhole } from '@/tools/format'
import type { InfinityUpgradeDef } from '@/compute/infinity'
import {
  canBuyInfinityUpgrade,
  hasInfinityUpgrade,
  infinityUpgradeCost,
  infinityUpgradeEffectValue,
} from '@/compute/infinity'
import { buyInfinityUpgrade } from '@/logic/infinity'

const props = defineProps<{
  def: InfinityUpgradeDef
}>()
</script>
<template>
  <button
    :class="[
      'upgrade',
      hasInfinityUpgrade(props.def.id) ? 'bought' : '',
      canBuyInfinityUpgrade(props.def.id) ? 'affordable' : '',
    ]"
    :disabled="!canBuyInfinityUpgrade(props.def.id)"
    @click="buyInfinityUpgrade(props.def.id)"
  >
    <span class="text bold">{{ props.def.name }}</span>
    <span class="text">{{ props.def.description }}</span>
    <span class="text">当前: {{ infinityUpgradeEffectValue(props.def) }}</span>
    <span v-if="!hasInfinityUpgrade(props.def.id)" class="text">
      价格: {{ formatWhole(infinityUpgradeCost(props.def.id)) }} 无限点数
    </span>
  </button>
</template>
<style scoped>
/*与普通升级(upgradeItem)一致:正文12px、标题13px,节省空间 */
button.upgrade span.text {
  font-size: 12px;
}
button.upgrade span.text.bold {
  font-size: 13px;
}
</style>
