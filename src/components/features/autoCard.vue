<script setup lang="ts">
//自动化卡片外壳:只处理所有自动化共用的部分(标题/未解锁徽标/总开关/优先级/页脚插槽)
//类型专用配置由默认插槽提供(自动购买类/自动重置类各一个组件)
//本组件不引用任何logic:开关状态与配置对象都由调用方传入,改动经事件上抛
import type { AutoConfig } from '@/data/types'

const props = defineProps<{
  /**卡片标题 */
  title: string
  /**总开关状态(由调用方按该自动化的isActive判定) */
  on: boolean
  /**配置对象(取优先级用) */
  cfg: AutoConfig
  /**是否显示"未解锁"徽标 */
  locked?: boolean
  /**是否显示优先级(元层等全局唯一实例的自动化没有优先级概念) */
  showPriority?: boolean
}>()
const emit = defineEmits<{
  /**切换总开关 */
  toggle: []
  /**共用字段(优先级)改动 */
  change: [patch: Partial<AutoConfig>]
}>()

/**解析优先级输入,非法时保持原值 */
function parsePriority(v: string): number {
  const n = Number(v)
  return isFinite(n) ? n : props.cfg.priority
}
</script>
<template>
  <div class="card section box">
    <div class="row">
      <span class="text bold">{{ props.title }}</span>
      <span v-if="props.locked" class="text badge">未解锁</span>
    </div>
    <div class="row">
      <button :class="['toggle', props.on ? 'toggle-on' : 'toggle-off']" @click="emit('toggle')">
        开关:{{ props.on ? '开' : '关' }}
      </button>
      <template v-if="props.showPriority !== false">
        <span class="text">优先级</span>
        <input
          type="number"
          :value="props.cfg.priority"
          @change="
            emit('change', { priority: parsePriority(($event.target as HTMLInputElement).value) })
          "
        />
      </template>
    </div>
    <slot />
    <slot name="footer" />
  </div>
</template>
<style scoped>
div.card {
  gap: 6px;
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
