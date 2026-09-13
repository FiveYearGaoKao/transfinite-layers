<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { logs, clearLogs } from '@/data/log'
import { settings } from '@/app/settings'

/**按设置过滤后的日志 */
const filteredLogs = computed(() => logs.filter((l) => settings.logFilter[l.type]))
/**日志列表元素(用于自动滚动) */
const logListEl = ref<HTMLElement>()
//新增可见日志时自动滚动到底部,让玩家能看见最新日志
watch(
  () => filteredLogs.value.length,
  () => {
    nextTick(() => {
      const el = logListEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)
</script>
<template>
  <div id="logBar">
    <div id="logList" ref="logListEl">
      <div v-for="item in filteredLogs" :key="item.id" class="logItem">
        <span style="color: var(--dim)">[{{ new Date(item.time).toLocaleTimeString() }}]</span>
        <span :class="item.type">{{ item.text }}</span>
        <span v-if="item.count > 1" style="color: var(--dim)"> x{{ item.count }}</span>
      </div>
    </div>
    <div id="logFooter">
      <button class="toggle" @click="clearLogs()">清空</button>
    </div>
  </div>
</template>
<style scoped>
div#logBar {
  border-left: 2px solid var(--dim);
  border-right: 2px solid var(--dim);
  margin: 0px;
  width: 300px;
  height: 100%;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
div#logList {
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: scroll;
  scrollbar-width: none;
}
div#logFooter {
  display: flex;
  flex-direction: row;
  justify-content: center;
  padding: 2px;
}
div.logItem {
  border: 1px solid var(--faint);
  width: 100%;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  transition: all 200ms;
}
div.logItem:hover {
  background-color: var(--hover);
}
span.info {
  color: skyblue;
}
span.warning {
  color: orange;
}
span.error {
  color: red;
}
span.progress {
  color: gold;
}
span.automator {
  color: pink;
}
/*窄屏或矮屏(横屏):日志栏位于底部，只显示1~2条*/
@media (max-width: 700px), (max-height: 500px) {
  div#logBar {
    width: 100%;
    height: 100px;
    border: none;
    border-top: 2px solid var(--dim);
  }
}
</style>
