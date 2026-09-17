<script setup lang="ts">
//自动重置类配置(时间/点数/倍率)的共用编辑控件
//层级"自动重置"卡、"自动无限重置"卡与"自动解锁新层级"卡共用同一份UI,避免多处模板分叉
//控件只读props,改动以change事件上抛(由调用方写回player中的配置对象)
//布局:三列网格——判定方式独占一行,第二行为三个条件开关,第三行为三个输入框
//hideMult=true时隐藏"倍率"一列(该条件下恒成立时用,如临时层点数恒为0),网格自动变为两列
//输入框常驻(条件关闭时禁用置灰),开关条件不会改变卡片高度
import Decimal from 'break_eternity.js'
import type { AutoResetConfig } from '@/data/types'

const props = withDefaults(
  defineProps<{
    /**被编辑的配置(只读,取值用) */
    cfg: AutoResetConfig
    /**隐藏"倍率"条件(该条件下恒成立时用,如临时层点数恒为0) */
    hideMult?: boolean
  }>(),
  { hideMult: false },
)
const emit = defineEmits<{ change: [patch: Partial<AutoResetConfig>] }>()

/**条件含义的悬浮说明(层级与无限两种上下文的通用措辞) */
const HINT = {
  combine: '多个条件同时开启时:任一满足,或全部满足',
  time: '时间:计时达到该秒数时触发(层级看下层的重置计时,无限看本次无限经历的时间)',
  point: '点数:本次可获得的资源达到该值时触发(层级看重置收益,无限看可获得的无限点数)',
  mult: '倍率:本次可获得的资源达到当前持有量的该倍率时触发',
}

/**解析大数字输入,非法时保持原值 */
function parseDecimal(v: string, fallback: Decimal): Decimal {
  const d = new Decimal(v)
  return Decimal.isNaN(d) ? fallback : d
}
/**解析秒数输入,非法时保持原值 */
function parseNumber(v: string, fallback: number): number {
  const n = Number(v)
  return isFinite(n) ? n : fallback
}
</script>
<template>
  <div class="condGrid" :class="{ noMult: props.hideMult }">
    <button
      class="spanAll"
      :title="HINT.combine"
      @click="emit('change', { combine: props.cfg.combine == 'any' ? 'all' : 'any' })"
    >
      {{ props.cfg.combine == 'any' ? '任一满足' : '全部满足' }}
    </button>

    <button
      :class="['toggle', props.cfg.useTime ? 'toggle-on' : 'toggle-off']"
      :title="HINT.time"
      @click="emit('change', { useTime: !props.cfg.useTime })"
    >
      时间:{{ props.cfg.useTime ? '开' : '关' }}
    </button>
    <button
      :class="['toggle', props.cfg.usePoint ? 'toggle-on' : 'toggle-off']"
      :title="HINT.point"
      @click="emit('change', { usePoint: !props.cfg.usePoint })"
    >
      点数:{{ props.cfg.usePoint ? '开' : '关' }}
    </button>
    <button
      v-if="!props.hideMult"
      :class="['toggle', props.cfg.useMult ? 'toggle-on' : 'toggle-off']"
      :title="HINT.mult"
      @click="emit('change', { useMult: !props.cfg.useMult })"
    >
      倍率:{{ props.cfg.useMult ? '开' : '关' }}
    </button>

    <input
      type="number"
      :disabled="!props.cfg.useTime"
      :value="props.cfg.time"
      @change="
        emit('change', {
          time: parseNumber(($event.target as HTMLInputElement).value, props.cfg.time),
        })
      "
    />
    <input
      :disabled="!props.cfg.usePoint"
      :value="props.cfg.point.toString()"
      @change="
        emit('change', {
          point: parseDecimal(($event.target as HTMLInputElement).value, props.cfg.point),
        })
      "
    />
    <input
      v-if="!props.hideMult"
      :disabled="!props.cfg.useMult"
      :value="props.cfg.mult.toString()"
      @change="
        emit('change', {
          mult: parseDecimal(($event.target as HTMLInputElement).value, props.cfg.mult),
        })
      "
    />
  </div>
</template>
<style scoped>
/*三列等宽网格:第二行三个开关、第三行三个输入框,列宽一致故上下严格对齐*/
div.condGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px 6px;
  width: 100%;
}
/*隐藏"倍率"条件时改为两列,保持上下对齐*/
div.condGrid.noMult {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
/*判定方式独占一行(避免挤占下面两行的三列),但按钮本身保持内容宽度并居中*/
div.condGrid > button.spanAll {
  grid-column: 1 / -1;
  justify-self: center;
}
div.condGrid > input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
/*条件关闭时输入框仍占位,只置灰*/
div.condGrid > input:disabled {
  color: var(--faint);
}
</style>
