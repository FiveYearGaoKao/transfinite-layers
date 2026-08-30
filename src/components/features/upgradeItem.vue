<script setup lang="ts">
import { formatWhole } from '@/tools/format'
import type { LayerId } from '@/data/types'
import type { UpgradeDef } from '@/compute/upgrades'
import { canBuyUpgrade, hasUpgrade, upgradeCost, upgradeEffectValue } from '@/compute/upgrades'
import { renderLayerPlaceholders } from '@/compute/effects'
import { buyUpgrade } from '@/logic/purchase'
import { isAutoItem } from '@/logic/automations'

//自动升级的样式暂时放弃
const props = defineProps<{
  pos: LayerId
  def: UpgradeDef
}>()
/**该升级是否在本层自动购买列表中(用于边框高亮指示) */
const autoOn = () => isAutoItem(props.pos, 'upgrades', props.def.id)
</script>
<template>
  <button
    :class="[
      'upgrade',
      hasUpgrade(props.pos, props.def.id) ? 'bought' : '',
      canBuyUpgrade(props.pos, props.def.id) ? 'affordable' : '',
      // autoOn() ? 'auto' : '',
    ]"
    :disabled="!canBuyUpgrade(props.pos, props.def.id)"
    @click="buyUpgrade(props.pos, props.def.id)"
  >
    <span class="text bold">{{ props.def.name }}</span>
    <span class="text">{{ renderLayerPlaceholders(props.def.description, props.pos) }}</span>
    <span class="text">当前: {{ upgradeEffectValue(props.def, props.pos) }}</span>
    <span class="text" v-if="!hasUpgrade(props.pos, props.def.id)">
      价格: {{ formatWhole(upgradeCost(props.pos, props.def.id)) }}
    </span>
    <span v-if="autoOn()" class="autoTag">Auto</span>
  </button>
</template>
<style scoped>
button.upgrade {
  position: relative;
  /*升级文字较多,缩小字号避免拥挤(玩家反馈);.text全局为14px,须直接作用到span上*/
}
button.upgrade span.text {
  font-size: 12px;
}
button.upgrade span.text.bold {
  font-size: 13px;
}
button.upgrade.auto {
  border-color: var(--accent);
}
span.autoTag {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 10px;
  color: var(--text);
  /* color: var(--accent);
  border: 1px solid var(--accent); */
  padding: 0 3px;
  border-radius: 3px;
}
</style>
