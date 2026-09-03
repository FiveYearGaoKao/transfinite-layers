<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Decimal from 'break_eternity.js'
import { getLayer } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { getBuyables } from '@/compute/buyables'
import { getUpgrades } from '@/compute/upgrades'
import { hasKnowledge } from '@/compute/knowledge'
import { DIMENSION_COUNT } from '@/data/constants'
import type {
  AutoBuyConfig,
  AutoConfig,
  AutoResetConfig,
  AutomationDef,
  LayerId,
} from '@/data/types'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import {
  AUTOMATIONS,
  applyAllGlobalAuto,
  applyGlobalAuto,
  getGlobalAutomation,
  getLayerAutomation,
  initGlobalFromLayer,
  isAllAutoActive,
  isLayerAutoActive,
  toggleAllAuto,
  toggleLayerAuto,
} from '@/logic/automations'
import LayerSelect from './layerSelect.vue'

/**自动化页视图:内部自动化/全局配置 */
type AutoView = 'internal' | 'global'
const view = ref<AutoView>('internal')
/**全局配置是否解锁(知识升级auto-global-config) */
const globalUnlocked = computed(() => hasKnowledge('auto-global-config'))
/**当前选择的层级(内部自动化用) */
const selectedPos = ref<LayerId>([0])
/**当前层级(或全局模板)的自动化配置 */
const auto = computed(() => getLayerAutomation(selectedPos.value))
const globalAuto = computed(() => getGlobalAutomation())
/**全部层级自动化是否全开 */
const allAutoOn = computed(() => isAllAutoActive())
/**当前层级是否有自动化激活 */
const layerAutoOn = computed(() => isLayerAutoActive(selectedPos.value))
/**当前层维度数量 */
const dimCount = computed(() => getLayer(selectedPos.value)?.dimensions.length ?? 0)
/**当前层可购买列表 */
const buyableList = computed(() => getBuyables(getLayerOrder(selectedPos.value)))
/**当前层升级列表(升级自动化用) */
const upgradeList = computed(() => getUpgrades(getLayerOrder(selectedPos.value)))

/**当前视图下某类型的配置(内部=所选层,全局=模板) */
function cfgOf(id: string): AutoConfig {
  return (view.value == 'global' ? globalAuto.value : auto.value).cfgs[id] as AutoConfig
}
/**当前视图下某自动购买的配置 */
function buyCfg(id: string): AutoBuyConfig {
  return cfgOf(id) as AutoBuyConfig
}
/**当前视图下自动重置的配置 */
function resetCfg(): AutoResetConfig {
  return cfgOf('reset') as AutoResetConfig
}
/**切换视图(首次进入全局配置时初始化模板:复制选中层的整套配置) */
function switchView(v: AutoView) {
  view.value = v
}
watch(view, (v) => {
  if (v == 'global') initGlobalFromLayer(selectedPos.value)
})
/**自动化页子标签的循环切换(快捷键左右键用) */
onMounted(() =>
  registerSubtabCycler('automation', (dir) => {
    const list: AutoView[] = globalUnlocked.value ? ['internal', 'global'] : ['internal']
    const idx = list.indexOf(view.value)
    view.value = list[(idx + dir + list.length) % list.length] ?? 'internal'
  }),
)
onUnmounted(() => unregisterSubtabCycler('automation'))

/**当前视图显示的自动化卡片(内部:层级0不显示自动重置;全局:全部类型) */
const visibleDefs = computed(() => {
  if (view.value == 'global') return AUTOMATIONS
  return AUTOMATIONS.filter((def) => !(def.id == 'reset' && isLayer0(selectedPos.value)))
})
/**某类型卡片的逐项列表(维度/可购买/升级;全局模式以order 0为准) */
function cardItems(def: AutomationDef): { id: number; name: string }[] {
  if (def.id == 'dims') {
    const n = view.value == 'global' ? DIMENSION_COUNT : dimCount.value
    return Array.from({ length: n }, (_, i) => ({ id: i, name: `维度${i + 1}` }))
  }
  if (def.id == 'buyables') {
    const list = view.value == 'global' ? getBuyables(0) : buyableList.value
    return list.map((b) => ({ id: b.id, name: b.name }))
  }
  if (def.id == 'upgrades') {
    const list = view.value == 'global' ? getUpgrades(0) : upgradeList.value
    return list.map((u) => ({ id: u.id, name: u.name }))
  }
  return []
}
/**某类型在该层是否解锁(仅内部视图显示徽标) */
function defUnlocked(def: AutomationDef): boolean {
  return def.isUnlocked(selectedPos.value)
}
/**某类型卡片当前是否激活(有任意项开启) */
function isCardOn(def: AutomationDef): boolean {
  return def.isActive(cfgOf(def.id))
}
/**切换某类型卡片的主开关(逐项全部开/关;重置切换enabled) */
function toggleCard(def: AutomationDef) {
  const cfg = cfgOf(def.id)
  const on = !def.isActive(cfg)
  if (def.id == 'reset') {
    ;(cfg as AutoResetConfig).enabled = on
    return
  }
  const buy = cfg as AutoBuyConfig
  for (const it of cardItems(def)) buy.perItem[it.id] = on
}
/**某项是否自动 */
function itemOn(cfg: AutoBuyConfig, id: number): boolean {
  return cfg.perItem[id] === true
}
/**切换某项的自动开关 */
function toggleItem(cfg: AutoBuyConfig, id: number) {
  cfg.perItem[id] = !(cfg.perItem[id] === true)
}
/**解析大数字输入，非法时保持原值 */
function parseDecimal(v: string): Decimal {
  const d = new Decimal(v)
  return Decimal.isNaN(d) ? new Decimal(0) : d
}
</script>
<template>
  <div id="automation">
    <div class="subtabRow">
      <button :class="['subTab', { selected: view == 'internal' }]" @click="switchView('internal')">
        内部自动化
      </button>
      <button
        v-if="globalUnlocked"
        :class="['subTab', { selected: view == 'global' }]"
        @click="switchView('global')"
      >
        全局配置
      </button>
    </div>

    <div v-if="view == 'internal'" id="autoMasterRow">
      <button :class="['toggle', allAutoOn ? 'toggle-on' : 'toggle-off']" @click="toggleAllAuto()">
        全部自动化:{{ allAutoOn ? '开' : '关' }}
      </button>
      <button
        :class="['toggle', layerAutoOn ? 'toggle-on' : 'toggle-off']"
        @click="toggleLayerAuto(selectedPos)"
      >
        本层:{{ layerAutoOn ? '开' : '关' }}
      </button>
    </div>
    <div v-else-if="globalUnlocked" id="autoMasterRow">
      <button :class="['toggle', allAutoOn ? 'toggle-on' : 'toggle-off']" @click="toggleAllAuto()">
        全部自动化:{{ allAutoOn ? '开' : '关' }}
      </button>
      <button class="toggle selected" @click="applyAllGlobalAuto()">应用全部到所有层</button>
    </div>

    <LayerSelect v-if="view == 'internal'" v-model="selectedPos" />

    <span v-if="view == 'global'" class="text infoHint">
      全局配置是自动化配置的模板:新解锁层级的自动化将自动套用此配置;修改后点各卡片"应用该配置"可覆盖所有已有层级
    </span>

    <template v-for="def in visibleDefs" :key="def.id">
      <div class="card section box">
        <div class="row">
          <span class="text bold">{{ def.name }}</span>
          <span v-if="view == 'internal' && !defUnlocked(def)" class="text badge">未解锁</span>
        </div>
        <div class="row">
          <button
            :class="['toggle', isCardOn(def) ? 'toggle-on' : 'toggle-off']"
            @click="toggleCard(def)"
          >
            开关:{{ isCardOn(def) ? '开' : '关' }}
          </button>
          <span class="text">优先级</span>
          <input type="number" v-model.number="cfgOf(def.id).priority" />
        </div>

        <template v-if="def.id == 'dims' || def.id == 'buyables' || def.id == 'upgrades'">
          <div class="row">
            <button @click="buyCfg(def.id).order = buyCfg(def.id).order == 'asc' ? 'desc' : 'asc'">
              {{ buyCfg(def.id).order == 'asc' ? '从低到高' : '从高到低' }}
            </button>
            <span class="text">消耗%</span>
            <input type="number" v-model.number="buyCfg(def.id).percent" />
            <button
              v-if="def.id != 'upgrades' && hasKnowledge('auto-batch')"
              title="需知识升级:自动批量"
              @click="buyCfg(def.id).buyAmount = buyCfg(def.id).buyAmount == 'one' ? 'max' : 'one'"
            >
              {{ buyCfg(def.id).buyAmount == 'one' ? '买1个' : '买最大' }}
            </button>
          </div>
          <div class="row" :class="def.id == 'upgrades' ? 'autoToggles' : ''">
            <button
              v-for="it in cardItems(def)"
              :key="it.id"
              :class="['toggle', itemOn(buyCfg(def.id), it.id) ? 'toggle-on' : 'toggle-off']"
              @click="toggleItem(buyCfg(def.id), it.id)"
            >
              {{ it.name }}:{{ itemOn(buyCfg(def.id), it.id) ? '开' : '关' }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="row">
            <button @click="resetCfg().combine = resetCfg().combine == 'any' ? 'all' : 'any'">
              {{ resetCfg().combine == 'any' ? '任一满足' : '全部满足' }}
            </button>
          </div>
          <div class="row">
            <button
              :class="['toggle', resetCfg().useTime ? 'toggle-on' : 'toggle-off']"
              @click="resetCfg().useTime = !resetCfg().useTime"
            >
              时间:{{ resetCfg().useTime ? '开' : '关' }}
            </button>
            <input v-if="resetCfg().useTime" type="number" v-model.number="resetCfg().time" />
            <span class="text">秒</span>
          </div>
          <div class="row">
            <button
              :class="['toggle', resetCfg().usePoint ? 'toggle-on' : 'toggle-off']"
              @click="resetCfg().usePoint = !resetCfg().usePoint"
            >
              点数:{{ resetCfg().usePoint ? '开' : '关' }}
            </button>
            <input
              v-if="resetCfg().usePoint"
              :value="resetCfg().point.toString()"
              @change="resetCfg().point = parseDecimal(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="row">
            <button
              :class="['toggle', resetCfg().useMult ? 'toggle-on' : 'toggle-off']"
              @click="resetCfg().useMult = !resetCfg().useMult"
            >
              倍率:{{ resetCfg().useMult ? '开' : '关' }}
            </button>
            <input
              v-if="resetCfg().useMult"
              :value="resetCfg().mult.toString()"
              @change="resetCfg().mult = parseDecimal(($event.target as HTMLInputElement).value)"
            />
            <span class="text">倍</span>
          </div>
        </template>

        <div v-if="view == 'global'" class="row">
          <button class="toggle selected" @click="applyGlobalAuto(def.id)">应用该配置</button>
          <span class="text">将所有层级的{{ def.name }}替换为上方模板</span>
        </div>
      </div>
    </template>
  </div>
</template>
<style scoped>
div#automation {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
div#autoMasterRow {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}
div.card {
  gap: 6px;
}
/*升级开关较多,限制宽度强制换行*/
div.autoToggles {
  max-width: 540px;
}
span.infoHint {
  max-width: 520px;
  text-align: center;
}
span.badge {
  color: var(--faint);
  border: 1px solid var(--faint);
  padding: 0 4px;
  font-size: 11px;
}
input {
  width: 100px;
}
</style>
