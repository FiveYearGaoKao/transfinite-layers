<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  currentDialog,
  closeDialog,
  type AlertDialogOptions,
  type ConfirmDialogOptions,
  type QuizDialogOptions,
  type SlotDialogOptions,
} from '@/app/dialog'
import { getCurrentSlot, getSlotSummaries, type SlotSummary } from '@/save/save'
import { getAchievementCount } from '@/logic/achievements'
import { format, formatTime } from '@/tools/format'

/**当前是否为确认框 */
const isConfirm = computed(() => currentDialog.value?.kind == 'confirm')
/**当前是否为提示框(单按钮) */
const isAlert = computed(() => currentDialog.value?.kind == 'alert')
/**当前是否为答题框 */
const isQuiz = computed(() => currentDialog.value?.kind == 'quiz')
/**是否必须点按钮才能关闭(确认框与提示框不允许点遮罩/按ESC关闭) */
const buttonOnly = computed(() => isConfirm.value || isAlert.value)
/**确认框选项 */
const confirmOptions = computed<ConfirmDialogOptions | undefined>(() =>
  currentDialog.value?.kind == 'confirm'
    ? (currentDialog.value.options as ConfirmDialogOptions)
    : undefined,
)
/**确认框文字(支持函数形式,以便随游戏状态实时更新,如重置收益随时间变化) */
const confirmText = computed(() => {
  const t = confirmOptions.value?.text
  return typeof t == 'function' ? t() : (t ?? '')
})
/**提示框选项 */
const alertOptions = computed<AlertDialogOptions | undefined>(() =>
  currentDialog.value?.kind == 'alert'
    ? (currentDialog.value.options as AlertDialogOptions)
    : undefined,
)
/**提示框文字(同确认框,支持函数形式) */
const alertText = computed(() => {
  const t = alertOptions.value?.text
  return typeof t == 'function' ? t() : (t ?? '')
})
/**答题框选项 */
const quizOptions = computed<QuizDialogOptions | undefined>(() =>
  currentDialog.value?.kind == 'quiz'
    ? (currentDialog.value.options as QuizDialogOptions)
    : undefined,
)
/**槽位框选项 */
const slotOptions = computed<SlotDialogOptions | undefined>(() =>
  currentDialog.value?.kind == 'slots'
    ? (currentDialog.value.options as SlotDialogOptions)
    : undefined,
)
/**答题输入框的答案 */
const quizAnswer = ref('')
/**答题输入框元素(填空题弹出时聚焦) */
const quizInput = ref<HTMLInputElement>()
//答题框弹出时,若为填空题则将光标聚焦到文本输入框
watch(currentDialog, async (d) => {
  if (d?.kind == 'quiz' && !(d.options as QuizDialogOptions).options?.length) {
    await nextTick()
    quizInput.value?.focus()
  }
})
/**全部存档槽位的摘要(对话框打开时实时读取) */
const summaries = computed<SlotSummary[]>(() => (slotOptions.value ? getSlotSummaries() : []))
/**成就总数(用于摘要显示) */
const achievementTotal = computed(() => getAchievementCount())
/**生成一行槽位摘要文字 */
function slotText(s: SlotSummary): string {
  if (!s.exists) return '空'
  return `游玩${formatTime(s.totalTime)} · 点数${format(s.points)} · 成就${s.achievements}/${achievementTotal.value}`
}
/**按下ESC时取消槽位/答题选择框 */
function onKeydown(e: KeyboardEvent) {
  if (e.key == 'Escape' && !buttonOnly.value) closeDialog(null)
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>
<template>
  <div v-if="currentDialog" class="overlay" @click.self="!buttonOnly && closeDialog(null)">
    <!-- 确认框 -->
    <div v-if="isConfirm" class="panel">
      <span class="text bold title">{{ confirmOptions?.title }}</span>
      <span class="text content">{{ confirmText }}</span>
      <div class="row buttons">
        <button class="subTab" @click="closeDialog(false)">
          {{ confirmOptions?.cancelText ?? '取消' }}
        </button>
        <button class="subTab affordable" @click="closeDialog(true)">
          {{ confirmOptions?.confirmText ?? '确认' }}
        </button>
      </div>
    </div>
    <!-- 提示框(单按钮) -->
    <div v-else-if="isAlert" class="panel">
      <span class="text bold title">{{ alertOptions?.title }}</span>
      <span class="text content">{{ alertText }}</span>
      <div class="row buttons">
        <button class="subTab affordable" @click="closeDialog(null)">
          {{ alertOptions?.confirmText ?? '知道了' }}
        </button>
      </div>
    </div>
    <!-- 答题框 -->
    <div v-else-if="isQuiz" class="panel quizPanel">
      <span class="text bold title">{{ quizOptions?.title }}</span>
      <span class="text content">{{ quizOptions?.question }}</span>
      <template v-if="quizOptions?.options?.length">
        <button
          v-for="(opt, idx) in quizOptions.options"
          :key="idx"
          class="subTab quizOption"
          @click="closeDialog(idx)"
        >
          {{ opt }}
        </button>
      </template>
      <template v-else>
        <input
          ref="quizInput"
          v-model="quizAnswer"
          class="quizInput"
          @keydown.enter="closeDialog(quizAnswer)"
        />
        <div class="row buttons">
          <button class="subTab" @click="closeDialog(null)">取消</button>
          <button class="subTab affordable" @click="closeDialog(quizAnswer)">提交</button>
        </div>
      </template>
    </div>
    <!-- 存档槽位选择框 -->
    <div v-else class="panel slotsPanel">
      <span class="text bold title">{{ slotOptions?.title }}</span>
      <button
        v-for="s in summaries"
        :key="s.slot"
        :class="['slotRow', s.slot == getCurrentSlot() ? 'current' : '']"
        @click="closeDialog(s.slot)"
      >
        <span class="text slotLabel">槽位 {{ s.slot + 1 }}</span>
        <span v-if="s.slot == getCurrentSlot()" class="text slotCurrent">当前</span>
        <span class="text slotInfo" :class="{ empty: !s.exists }">{{ slotText(s) }}</span>
      </button>
      <button class="subTab" @click="closeDialog(null)">取消</button>
    </div>
  </div>
</template>
<style scoped>
div.overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.6);
}
div.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border: 2px solid var(--dim);
  background-color: var(--panel);
  box-shadow: 4px 4px 8px var(--shadow);
  max-width: 80vw;
}
span.title {
  font-size: 16px;
}
span.content {
  max-width: 320px;
  text-align: center;
  white-space: pre-wrap;
}
div.buttons {
  margin-top: 4px;
}
div.slotsPanel {
  min-width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  overflow-x: hidden;
}
div.quizPanel {
  min-width: 240px;
  max-width: 360px;
}
input.quizInput {
  width: 160px;
  padding: 4px;
}
button.quizOption {
  width: 100%;
  text-align: center;
}
button.slotRow {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 12px;
  padding: 6px 10px;
}
button.slotRow.current {
  border-color: var(--accent);
}
button.slotRow:hover:not(:disabled) {
  background-color: var(--selected-bg);
}
span.slotInfo {
  color: var(--dim);
}
span.slotInfo.empty {
  color: var(--faint);
}
span.slotCurrent {
  color: var(--accent);
  font-size: 12px;
}
</style>
