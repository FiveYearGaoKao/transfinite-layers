<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getLayer } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { getBuyables } from '@/compute/buyables'
import { getUpgrades } from '@/compute/upgrades'
import { renderLayerPlaceholders } from '@/compute/effects'
import { hasKnowledge } from '@/compute/knowledge'
import { DIMENSION_COUNT } from '@/data/constants'
import type {
  AutoBuyConfig,
  AutoConfig,
  AutoResetConfig,
  AutomationDef,
  LayerId,
  MetaAutomationDef,
} from '@/data/types'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import { getMetaAutoCfg, getMetaAutomations, toggleMetaAuto } from '@/logic/metaAutomations'
import {
  AUTO_BUYABLES_ID,
  AUTO_DIMS_ID,
  AUTO_UPGRADES_ID,
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
import ResetAutoConfig from './resetAutoConfig.vue'
import AutoCard from './autoCard.vue'
import AutoBuyConfigView from './autoBuyConfig.vue'

/**自动化页视图:内部自动化/全局配置/元层自动化 */
type AutoView = 'internal' | 'global' | 'meta'
const view = ref<AutoView>('internal')
/**全局配置是否解锁(知识升级auto-global-config) */
const globalUnlocked = computed(() => hasKnowledge('auto-global-config'))
/**当前已解锁的元层自动化(全局唯一实例,如自动无限重置) */
const metaAutoDefs = computed(() => getMetaAutomations().filter((d) => d.isUnlocked()))
/**当前可见的视图列表(左右键循环与子标签行共用) */
const views = computed<{ id: AutoView; name: string }[]>(() => {
  const list: { id: AutoView; name: string }[] = [{ id: 'internal', name: '内部自动化' }]
  if (globalUnlocked.value) list.push({ id: 'global', name: '全局配置' })
  if (metaAutoDefs.value.length > 0) list.push({ id: 'meta', name: '元层自动化' })
  return list
})
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
/**按自动购买形状取配置(仅类型断言,实际形状由该自动化的configKind声明) */
function buyCfg(id: string): AutoBuyConfig {
  return cfgOf(id) as AutoBuyConfig
}
/**按自动重置形状取配置(仅类型断言) */
function resetCfg(id: string): AutoResetConfig {
  return cfgOf(id) as AutoResetConfig
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
    const list = views.value.map((v) => v.id)
    if (list.length == 0) return
    const idx = list.indexOf(view.value)
    view.value = list[(idx + dir + list.length) % list.length] ?? 'internal'
  }),
)
onUnmounted(() => unregisterSubtabCycler('automation'))

/**当前视图显示的自动化卡片(内部:层级0没有自动重置;全局:全部类型;元层:不显示层级卡片) */
const visibleDefs = computed(() => {
  if (view.value == 'meta') return []
  if (view.value == 'global') return AUTOMATIONS
  return AUTOMATIONS.filter((def) => !(def.configKind == 'reset' && isLayer0(selectedPos.value)))
})
/**某类型卡片的逐项列表(维度/可购买/升级;全局模式以order 0为准;name为按钮文字,title为悬浮说明) */
function cardItems(def: AutomationDef): { id: number; name: string; title?: string }[] {
  if (def.id == AUTO_DIMS_ID) {
    const n = view.value == 'global' ? DIMENSION_COUNT : dimCount.value
    return Array.from({ length: n }, (_, i) => ({ id: i, name: `维度${i + 1}` }))
  }
  if (def.id == AUTO_BUYABLES_ID) {
    const list = view.value == 'global' ? getBuyables(0) : buyableList.value
    return list.map((b) => ({
      id: b.id,
      name: b.name,
      title: renderLayerPlaceholders(b.description, selectedPos.value),
    }))
  }
  if (def.id == AUTO_UPGRADES_ID) {
    const list = view.value == 'global' ? getUpgrades(0) : upgradeList.value
    //升级数量多,按钮只显示编号u1~u9,全名与说明放tooltip,避免卡片被撑宽
    return list.map((u) => ({
      id: u.id,
      name: `${u.name}`,
      title: `${renderLayerPlaceholders(u.description, selectedPos.value)}`,
    }))
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
/**切换某类型卡片的主开关(逐项全部开/关;自动重置类切换总开关enabled) */
function toggleCard(def: AutomationDef) {
  const cfg = cfgOf(def.id)
  const on = !def.isActive(cfg)
  if (def.configKind == 'reset') {
    ;(cfg as AutoResetConfig).enabled = on
    return
  }
  const buy = cfg as AutoBuyConfig
  for (const it of cardItems(def)) buy.perItem[it.id] = on
}
/**某项是否自动 */
function toggleItemAt(id: string, itemId: number) {
  const cfg = buyCfg(id)
  cfg.perItem[itemId] = !(cfg.perItem[itemId] === true)
}
/**通用写回:把子组件上抛的配置改动写入配置对象 */
function applyPatch(cfg: AutoConfig, patch: Partial<AutoConfig>) {
  Object.assign(cfg, patch)
}
/**取某元层自动化的配置(元层卡片目前只有自动重置类,故按该形状断言) */
function metaCfg(id: string): AutoResetConfig {
  return getMetaAutoCfg<AutoResetConfig>(id)
}
/**某元层自动化是否已开启 */
function metaOn(def: MetaAutomationDef): boolean {
  return def.isActive(metaCfg(def.id))
}
</script>
<template>
  <div id="automation">
    <div class="subtabRow">
      <button
        v-for="t in views"
        :key="t.id"
        :class="['subTab', { selected: view == t.id }]"
        @click="switchView(t.id)"
      >
        {{ t.name }}
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
    <div v-else-if="view == 'global'" id="autoMasterRow">
      <button :class="['toggle', allAutoOn ? 'toggle-on' : 'toggle-off']" @click="toggleAllAuto()">
        全部自动化:{{ allAutoOn ? '开' : '关' }}
      </button>
      <button class="toggle selected" @click="applyAllGlobalAuto()">应用全部到所有层</button>
    </div>

    <LayerSelect v-if="view == 'internal'" v-model="selectedPos" />

    <span v-if="view == 'global'" class="text infoHint">
      全局配置是自动化配置的模板:新解锁层级的自动化将自动套用此配置;修改后点各卡片"应用该配置"可覆盖所有已有层级
    </span>

    <div id="autoCards">
      <template v-if="view == 'meta'">
        <AutoCard
          v-for="def in metaAutoDefs"
          :key="def.id"
          :title="def.name"
          :on="metaOn(def)"
          :cfg="metaCfg(def.id)"
          :show-priority="false"
          @toggle="toggleMetaAuto(def.id)"
          @change="applyPatch(metaCfg(def.id), $event)"
        >
          <ResetAutoConfig
            :cfg="metaCfg(def.id)"
            :hide-mult="def.hideMult === true"
            @change="applyPatch(metaCfg(def.id), $event)"
          />
        </AutoCard>
      </template>

      <AutoCard
        v-for="def in visibleDefs"
        :key="def.id"
        :title="def.name ?? def.id"
        :on="isCardOn(def)"
        :cfg="cfgOf(def.id)"
        :locked="view == 'internal' && !defUnlocked(def)"
        @toggle="toggleCard(def)"
        @change="applyPatch(cfgOf(def.id), $event)"
      >
        <AutoBuyConfigView
          v-if="def.configKind == 'buy'"
          :cfg="buyCfg(def.id)"
          :items="cardItems(def)"
          :batch-unlocked="hasKnowledge('auto-batch')"
          :show-batch="def.supportsBatch !== false"
          @change="applyPatch(cfgOf(def.id), $event)"
          @toggle-item="toggleItemAt(def.id, $event)"
        />
        <ResetAutoConfig
          v-else
          :cfg="resetCfg(def.id)"
          @change="applyPatch(cfgOf(def.id), $event)"
        />
        <template #footer>
          <div v-if="view == 'global'" class="row">
            <button class="toggle selected" @click="applyGlobalAuto(def.id)">应用该配置</button>
            <span class="text">将所有层级的{{ def.name }}替换为上方模板</span>
          </div>
        </template>
      </AutoCard>
    </div>
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
/*卡片区:等宽卡片的自适应网格(窄屏1列、宽屏自动排2~4列),宽度上下限避免超宽屏被拉伸或窄屏溢出*/
div#autoCards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 360px));
  justify-content: center;
  align-items: start;
  gap: 8px;
  width: 100%;
}
span.infoHint {
  max-width: 520px;
  text-align: center;
}
</style>
