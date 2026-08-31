<script setup lang="ts">
import { computed, ref } from 'vue'
import Decimal from 'break_eternity.js'
import { getLayer } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { getBuyables } from '@/compute/buyables'
import { getUpgrades } from '@/compute/upgrades'
import { hasKnowledge } from '@/compute/knowledge'
import type { AutoBuyConfig, AutoConfig, AutoResetConfig, LayerId } from '@/data/types'
import {
  AUTOMATIONS,
  getLayerAutomation,
  isAllAutoActive,
  isLayerAutoActive,
  toggleLayerAuto,
  toggleAllAuto,
  toggleAutoItem,
  isAutoItem,
} from '@/logic/automations'
import LayerSelect from './layerSelect.vue'

/**当前选择的层级 */
const selectedPos = ref<LayerId>([0])
/**当前层级的自动化配置 */
const auto = computed(() => getLayerAutomation(selectedPos.value))
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
/**类型化的配置访问 */
function cfgOf(id: string): AutoConfig {
  return auto.value.cfgs[id] as AutoConfig
}
function buyCfg(id: string): AutoBuyConfig {
  return auto.value.cfgs[id] as AutoBuyConfig
}
function resetCfg(): AutoResetConfig {
  return auto.value.cfgs.reset as AutoResetConfig
}
/**解析大数字输入，非法时保持原值 */
function parseDecimal(v: string): Decimal {
  const d = new Decimal(v)
  return Decimal.isNaN(d) ? new Decimal(0) : d
}
/**是否显示某自动化卡片:只要配置存在即可修改;层级0不能重置,不显示自动重置 */
function showAutoCard(def: { id: string }): boolean {
  if (def.id == 'reset' && isLayer0(selectedPos.value)) return false
  return true
}
</script>
<template>
  <div id="automation">
    <div class="subtabRow">
      <button class="subTab selected">内部自动化</button>
    </div>
    <div id="autoHeader">
      <button :class="['toggle', allAutoOn ? 'toggle-on' : 'toggle-off']" @click="toggleAllAuto()">
        全部自动化:{{ allAutoOn ? '开' : '关' }}
      </button>
      <LayerSelect v-model="selectedPos" />
      <button
        :class="['toggle', layerAutoOn ? 'toggle-on' : 'toggle-off']"
        @click="toggleLayerAuto(selectedPos)"
      >
        本层:{{ layerAutoOn ? '开' : '关' }}
      </button>
    </div>

    <template v-for="def in AUTOMATIONS" :key="def.id">
      <div v-if="showAutoCard(def)" class="card section box">
        <div class="row">
          <span class="text bold">{{ def.name }}</span>
          <span v-if="!def.isUnlocked(selectedPos)" class="text badge">未解锁</span>
        </div>
        <div class="row">
          <button
            :class="['toggle', def.isActive(cfgOf(def.id)) ? 'toggle-on' : 'toggle-off']"
            @click="def.setAll(selectedPos, cfgOf(def.id), !def.isActive(cfgOf(def.id)))"
          >
            开关:{{ def.isActive(cfgOf(def.id)) ? '开' : '关' }}
          </button>
          <span class="text">优先级</span>
          <input type="number" v-model.number="cfgOf(def.id).priority" />
        </div>

        <template v-if="def.id == 'dims' || def.id == 'buyables'">
          <div class="row">
            <button @click="buyCfg(def.id).order = buyCfg(def.id).order == 'asc' ? 'desc' : 'asc'">
              {{ buyCfg(def.id).order == 'asc' ? '从低到高' : '从高到低' }}
            </button>
            <span class="text">消耗%</span>
            <input type="number" v-model.number="buyCfg(def.id).percent" />
            <button
              v-if="hasKnowledge('auto-batch')"
              title="需知识升级:自动批量"
              @click="buyCfg(def.id).buyAmount = buyCfg(def.id).buyAmount == 'one' ? 'max' : 'one'"
            >
              {{ buyCfg(def.id).buyAmount == 'one' ? '买1个' : '买最大' }}
            </button>
          </div>
          <div v-if="def.id == 'dims'" class="row">
            <button
              v-for="i in dimCount"
              :key="i"
              :class="[
                'toggle',
                isAutoItem(selectedPos, 'dims', i - 1) ? 'toggle-on' : 'toggle-off',
              ]"
              @click="toggleAutoItem(selectedPos, 'dims', i - 1)"
            >
              维度{{ i }}:{{ isAutoItem(selectedPos, 'dims', i - 1) ? '开' : '关' }}
            </button>
          </div>
          <div v-if="def.id == 'buyables'" class="row">
            <button
              v-for="b in buyableList"
              :key="b.id"
              :class="[
                'toggle',
                isAutoItem(selectedPos, 'buyables', b.id) ? 'toggle-on' : 'toggle-off',
              ]"
              @click="toggleAutoItem(selectedPos, 'buyables', b.id)"
            >
              {{ b.name }}:{{ isAutoItem(selectedPos, 'buyables', b.id) ? '开' : '关' }}
            </button>
          </div>
        </template>

        <template v-else-if="def.id == 'upgrades'">
          <div class="row">
            <button @click="buyCfg(def.id).order = buyCfg(def.id).order == 'asc' ? 'desc' : 'asc'">
              {{ buyCfg(def.id).order == 'asc' ? '从低到高' : '从高到低' }}
            </button>
            <span class="text">消耗%</span>
            <input type="number" v-model.number="buyCfg(def.id).percent" />
          </div>
          <div class="row autoToggles">
            <button
              v-for="u in upgradeList"
              :key="u.id"
              :class="[
                'toggle',
                isAutoItem(selectedPos, 'upgrades', u.id) ? 'toggle-on' : 'toggle-off',
              ]"
              @click="toggleAutoItem(selectedPos, 'upgrades', u.id)"
            >
              {{ u.name }}:{{ isAutoItem(selectedPos, 'upgrades', u.id) ? '开' : '关' }}
            </button>
          </div>
        </template>

        <template v-if="def.id == 'reset'">
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
div#autoHeader {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
div.card {
  gap: 6px;
}
/*升级开关较多,限制宽度强制换行*/
div.autoToggles {
  max-width: 540px;
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
