<script setup lang="ts">
//自动购买类自动化(维度/可购买/升级)的专用配置UI:购买顺序、消耗预算、买1个/买最大、逐项开关
//只读props,改动经事件上抛;逐项列表由调用方提供(维度/可购买/升级的条目来源各不相同)
import type { AutoBuyConfig } from '@/data/types'

const props = defineProps<{
  /**被编辑的配置(只读,取值用) */
  cfg: AutoBuyConfig
  /**逐项开关的条目(name为按钮文字,title为悬浮说明) */
  items: { id: number; name: string; title?: string }[]
  /**"买最大"是否已解锁(知识升级auto-batch) */
  batchUnlocked: boolean
  /**该类型是否支持"买最大"(升级为逐项购买,不支持) */
  showBatch?: boolean
}>()
const emit = defineEmits<{
  /**配置字段改动 */
  change: [patch: Partial<AutoBuyConfig>]
  /**切换某个购买项的自动开关 */
  toggleItem: [id: number]
}>()

/**解析百分比输入,非法时保持原值 */
function parsePercent(v: string): number {
  const n = Number(v)
  return isFinite(n) ? n : props.cfg.percent
}
/**某项是否自动 */
function itemOn(id: number): boolean {
  return props.cfg.perItem[id] === true
}
</script>
<template>
  <div class="row">
    <button @click="emit('change', { order: props.cfg.order == 'asc' ? 'desc' : 'asc' })">
      {{ props.cfg.order == 'asc' ? '从低到高' : '从高到低' }}
    </button>
    <span class="text">消耗%</span>
    <input
      type="number"
      max="100"
      min="0"
      :value="props.cfg.percent"
      @change="emit('change', { percent: parsePercent(($event.target as HTMLInputElement).value) })"
    />
    <button
      v-if="props.showBatch !== false && props.batchUnlocked"
      title="需知识升级:自动批量"
      @click="emit('change', { buyAmount: props.cfg.buyAmount == 'one' ? 'max' : 'one' })"
    >
      {{ props.cfg.buyAmount == 'one' ? '买1个' : '买最大' }}
    </button>
  </div>
  <div class="row">
    <button
      v-for="it in props.items"
      :key="it.id"
      :class="['toggle', itemOn(it.id) ? 'toggle-on' : 'toggle-off']"
      :title="it.title"
      @click="emit('toggleItem', it.id)"
    >
      {{ it.name }}:{{ itemOn(it.id) ? '开' : '关' }}
    </button>
  </div>
</template>
<style scoped>
input {
  width: 100px;
}
</style>
