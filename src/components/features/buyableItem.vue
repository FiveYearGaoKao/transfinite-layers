<script setup lang="ts">
import { formatWhole } from '@/tools/format'
import type { LayerId } from '@/data/types'
import type { BuyableDef } from '@/compute/buyables'
import {
  buyableAmount,
  buyableCost,
  buyableDescription,
  buyableEffectText,
  buyableFreeLevels,
  canBuyBuyable,
} from '@/compute/buyables'
import { buyBuyable, buyBuyableMax } from '@/logic/purchase'
import {
  AUTO_BUYABLES_ID,
  buyablesAutoUnlocked,
  isAutoItem,
  toggleAutoItem,
} from '@/logic/automations'

const props = withDefaults(
  defineProps<{
    pos: LayerId
    def: BuyableDef
    /**是否"买最大"(知识升级max-buy解锁的购买模式) */
    maxBuy?: boolean
  }>(),
  { maxBuy: false },
)
/**已购等级 */
const bought = () => buyableAmount(props.pos, props.def.id)
/**免费等级 */
const free = () => buyableFreeLevels(props.pos, props.def.id)
/**描述(支持模板) */
const description = () => buyableDescription(props.def, props.pos)
/**总效果文字 */
const effectText = () => buyableEffectText(props.def, props.pos)
/**购买该可购买:买最大模式下一次尽量买满,否则买1个 */
function buy() {
  if (props.maxBuy) buyBuyableMax(props.pos, props.def.id)
  else buyBuyable(props.pos, props.def.id)
}
/**该可购买是否在自动购买列表中 */
const autoOn = () => isAutoItem(props.pos, AUTO_BUYABLES_ID, props.def.id)
/**切换该可购买的自动购买开关 */
function toggleAuto() {
  toggleAutoItem(props.pos, AUTO_BUYABLES_ID, props.def.id)
}
</script>
<template>
  <div class="buyableItem">
    <div class="buyableInfo">
      <span class="text name"
        >{{ props.def.name }}({{ formatWhole(bought())
        }}<template v-if="free().gt(0)"
          ><span class="freeLevel">+{{ formatWhole(free()) }}</span></template
        >)</span
      >
      <span class="text">{{ description() }}</span>
      <span class="text">{{ effectText() }}</span>
    </div>
    <div class="row tight">
      <button
        :class="['buyable', canBuyBuyable(props.pos, props.def.id) ? 'affordable' : '']"
        @click="buy()"
      >
        价格: {{ formatWhole(buyableCost(props.pos, props.def.id)) }}
      </button>
      <button
        v-if="buyablesAutoUnlocked(props.pos)"
        :class="['toggle', 'compact', autoOn() ? 'toggle-on' : 'toggle-off']"
        @click="toggleAuto()"
      >
        自动:{{ autoOn() ? '开' : '关' }}
      </button>
    </div>
  </div>
</template>
<style scoped>
.freeLevel {
  color: #ff7f00;
}
div.buyableItem {
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 2px solid var(--dim);
  padding: 4px;
  gap: 4px;
}
div.buyableInfo {
  display: flex;
  flex-direction: column;
  align-items: center;
}
span.name {
  font-size: 16px;
}
</style>
