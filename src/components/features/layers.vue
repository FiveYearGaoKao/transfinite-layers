<script setup lang="ts">
import { format, formatWhole } from '@/tools/format'
import { getLayer, getLayerName, dimensionAmount, levelGap, prevLayer } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { dimensionCost, dimensionExponent, dimensionMultiplier } from '@/compute/dimensions'
import { getBuyables, isUnlocked as isBuyableUnlocked } from '@/compute/buyables'
import { getUpgrades, isUnlocked as isUpgradeUnlocked } from '@/compute/upgrades'
import { energyBonus } from '@/compute/energy'
import { canReset, resetGain } from '@/compute/prestige'
import { crossLayerFactor, crossLayerPenalty, crossLayerReward } from '@/compute/crossLayer'
import { buyDimension, buyDimensionMax, canAfford, maxBuyAll } from '@/logic/purchase'
import {
  AUTO_DIMS_ID,
  dimsAutoUnlocked,
  isAutoItem,
  resetAutoEnabled,
  resetAutoUnlocked,
  toggleAutoItem,
  toggleResetAuto,
} from '@/logic/automations'
import { hasKnowledge } from '@/compute/knowledge'
import { resetLayerConfirm, resetRunConfirm } from '@/app/uiActions'
import { settings, saveSettings } from '@/app/settings'
import { isChallengeActive } from '@/access'
import { player } from '@/data/player'
import { computed, nextTick, ref, watch } from 'vue'
import BuyableItem from './buyableItem.vue'
import UpgradeItem from './upgradeItem.vue'
import LayerSelect from './layerSelect.vue'
/**当前选择的层级 */
const selectedLayer = computed(() => {
  return getLayer(player.layerSubtab)
})
/**是否临时禁用过渡动画(层级切换时升级等状态应立即变化,不应有动画) */
const suppressTransition = ref(false)
watch(
  () => player.layerSubtab,
  () => {
    suppressTransition.value = true
    nextTick(() => requestAnimationFrame(() => (suppressTransition.value = false)))
  },
)
/**当前层能量给低层维度的加成数值 */
const layerEnergyBonus = computed(() => energyBonus(player.layerSubtab))
/**跨层重置提示:与下层间隔>1层时显示(惩罚侧按k次幂,奖励侧按k次幂强化) */
const crossLayerInfo = computed(() => {
  const pos = player.layerSubtab
  if (isLayer0(pos)) return ''
  const gap = levelGap(pos)
  if (gap.lte(1)) return ''
  const lowerName = getLayerName(prevLayer(pos))
  //惩罚侧倍率k = penalty^(gap-1):重置需求取k次幂、收益指数除以k
  const k = formatWhole(crossLayerFactor(gap, crossLayerPenalty()))
  //奖励侧倍率 = reward^(gap-1):本层对下层的加成取该次幂
  const rewarded = formatWhole(crossLayerFactor(gap, crossLayerReward()))
  return (
    `由于和${lowerName}间隔${format(gap, 0)}层：重置需求^${k}、收益指数÷${k}，` +
    `但本层对${lowerName}提供的加成取 ${rewarded} 次幂`
  )
})
/**当前层级可显示的可购买 */
const buyableList = computed(() =>
  getBuyables(getLayerOrder(player.layerSubtab)).filter((b) =>
    isBuyableUnlocked(player.layerSubtab, b.id),
  ),
)
/**当前层级可显示的升级(按升级的解锁条件过滤) */
const upgradeList = computed(() =>
  getUpgrades(getLayerOrder(player.layerSubtab)).filter((u) =>
    isUpgradeUnlocked(player.layerSubtab, u.id),
  ),
)
/**是否显示"放弃本轮"(挑战4激活且当前层不是临时层,临时层重置会无条件解锁新层级) */
const showResetRun = computed(() => isChallengeActive('c4') && !player.layerSubtab.includes(-1))
/**是否已解锁"最大购买"(知识升级max-buy):控制"购买模式"与"全部最大"的显示 */
const maxBuyUnlocked = computed(() => hasKnowledge('max-buy'))
/**购买模式是否为"买最大"(需已解锁) */
const buyMaxMode = computed(() => settings.buyMax && maxBuyUnlocked.value)
/**切换购买模式(买1个/买最大)并保存设置 */
function toggleBuyMax() {
  settings.buyMax = !settings.buyMax
  saveSettings()
}
/**购买某维度:按当前购买模式买1个或买最大 */
function buyDim(id: number) {
  if (buyMaxMode.value) buyDimensionMax(player.layerSubtab, id)
  else buyDimension(player.layerSubtab, id)
}
/**维度表的行数:按所选层级实际拥有的维度数(每层的维度上限可以不同) */
const dimTableCount = computed(() => selectedLayer.value?.dimensions.length ?? 0)
/**本层维度id是否自动购买 */
function dimAutoOn(id: number): boolean {
  return isAutoItem(player.layerSubtab, AUTO_DIMS_ID, id)
}
/**切换本层某维度的自动购买开关 */
function toggleDimAuto(id: number) {
  toggleAutoItem(player.layerSubtab, AUTO_DIMS_ID, id)
}
</script>
<template>
  <div id="layers" :class="{ noTransition: suppressTransition }" style="height: 100%">
    <LayerSelect v-model="player.layerSubtab" />
    <div class="prestigeRow">
      <button
        v-if="!isLayer0(player.layerSubtab)"
        :class="{ prestige: true, affordable: canReset(player.layerSubtab) }"
        @click="resetLayerConfirm()"
      >
        +{{ formatWhole(resetGain(player.layerSubtab)) }} {{ getLayerName(player.layerSubtab) }}点数
      </button>
      <button
        v-if="!isLayer0(player.layerSubtab) && resetAutoUnlocked(player.layerSubtab)"
        :class="['toggle', resetAutoEnabled(player.layerSubtab) ? 'toggle-on' : 'toggle-off']"
        title="本层自动重置开关(需购买升级:自动重置)"
        @click="toggleResetAuto(player.layerSubtab)"
      >
        自动:{{ resetAutoEnabled(player.layerSubtab) ? '开' : '关' }}
      </button>
      <button
        v-if="showResetRun"
        class="toggle toggle-off"
        title="不获得资源强制重置本层及下层,清除已购以恢复价格"
        @click="resetRunConfirm()"
      >
        重开本轮
      </button>
    </div>

    <!--购买模式与"全部最大"(需知识升级max-buy;置于层选择/重置行之下,维度表之上)-->
    <div v-if="maxBuyUnlocked" class="purchaseRow">
      <button @click="toggleBuyMax()">购买模式:{{ buyMaxMode ? '买最大' : '买1个' }}</button>
      <button title="买满本层全部维度与可购买(维度从高到低)" @click="maxBuyAll(player.layerSubtab)">
        全部最大
      </button>
    </div>

    <span v-if="!isLayer0(player.layerSubtab)" class="text"
      >你有<span class="text-highlight">{{ formatWhole(selectedLayer?.points ?? 0) }} </span
      >{{ getLayerName(player.layerSubtab) }}点数
    </span>
    <span v-if="!isLayer0(player.layerSubtab)" class="text"
      >你有<span class="text-highlight">{{ format(selectedLayer?.energy ?? 0) }} </span
      >{{ getLayerName(player.layerSubtab) }}能量，使{{
        getLayerName(prevLayer(player.layerSubtab))
      }}维度生产 <span class="text-highlight">x{{ format(layerEnergyBonus) }}</span></span
    >
    <span v-if="crossLayerInfo" class="text crossLayerHint">{{ crossLayerInfo }}</span>

    <br />
    <div id="dimensionTable">
      <template v-for="i in dimTableCount" :key="i">
        <div class="cell">
          <span class="text">{{ getLayerName(player.layerSubtab) }}维度{{ i }}</span>
          <span class="text"
            >x{{ format(dimensionMultiplier(player.layerSubtab, i - 1), 3) }} ^{{
              format(dimensionExponent(player.layerSubtab, i - 1), 3)
            }}</span
          >
        </div>
        <div class="cell">
          <span class="text"
            >{{ format(dimensionAmount(selectedLayer, i - 1)) }}({{
              formatWhole(dimensionAmount(selectedLayer, i - 1, 1))
            }})
          </span>
        </div>
        <div class="cell" :class="{ horizontal: dimsAutoUnlocked(player.layerSubtab) }">
          <button
            :class="['buyable', canAfford(player.layerSubtab, i - 1) ? 'affordable' : '']"
            @click="buyDim(i - 1)"
          >
            价格: {{ formatWhole(dimensionCost(player.layerSubtab, i - 1)) }}
          </button>
          <button
            v-if="dimsAutoUnlocked(player.layerSubtab)"
            :class="['toggle', 'compact', dimAutoOn(i - 1) ? 'toggle-on' : 'toggle-off']"
            @click="toggleDimAuto(i - 1)"
          >
            自动:{{ dimAutoOn(i - 1) ? '开' : '关' }}
          </button>
        </div>
      </template>
    </div>
    <div id="upgrades">
      <span class="sectionTitle">升级</span>
      <div class="upgradeRow">
        <UpgradeItem
          v-for="upgrade in upgradeList"
          :key="upgrade.id"
          :pos="player.layerSubtab"
          :def="upgrade"
        />
      </div>
    </div>
    <div id="buyables">
      <span class="sectionTitle">可购买</span>
      <div class="buyableRow">
        <BuyableItem
          v-for="buyable in buyableList"
          :key="buyable.id"
          :pos="player.layerSubtab"
          :def="buyable"
          :max-buy="buyMaxMode"
        />
      </div>
    </div>
  </div>
</template>
<style scoped>
.text-highlight {
  font-size: 18px;
  color: var(--text);
  text-shadow: 1px 1px var(--shadow);
}
div#layers {
  display: flex;
  flex-direction: column;
  align-items: center;
}
div.prestigeRow {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
/*购买操作行(购买模式/全部最大):紧凑,窄屏自动换行*/
div.purchaseRow {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px;
  margin: 2px 0;
}
div#dimensionTable {
  display: grid;
  grid-template-columns: 110px 140px 150px;
  grid-auto-rows: 32px;
  .cell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    &.horizontal {
      flex-direction: row;
      gap: 2px;
    }
    .text {
      font-size: 12px;
    }
  }
  /*奇数维度行与偶数维度行颜色不同*/
  .cell:nth-child(6n + 1),
  .cell:nth-child(6n + 2),
  .cell:nth-child(6n + 3) {
    background-color: var(--dim-odd-bg);
  }
  .cell:nth-child(6n + 4),
  .cell:nth-child(6n + 5),
  .cell:nth-child(6n + 6) {
    background-color: var(--dim-even-bg);
  }
}
/*可购买行*/
div#buyables {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
}
div.buyableRow {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
/*升级区*/
div#upgrades {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
}
div.upgradeRow {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}
span.sectionTitle {
  font-size: 14px;
  font-weight: bold;
  color: var(--dim);
  border-bottom: 1px solid var(--faint);
  padding-bottom: 2px;
}
/*跨层重置提示:与下层间隔>1层时显示*/
span.crossLayerHint {
  font-size: 12px;
  color: var(--accent);
  text-align: center;
}
/*窄屏:统一表格列宽自适应，所有行列宽一致*/
@media (max-width: 700px) {
  div#dimensionTable {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  div#dimensionTable button {
    width: 100%;
  }
}
</style>
