<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { pause, tick } from '@/app/core'
import { player } from '@/data/player'
import { hasKnowledge } from '@/compute/knowledge'
import { doLoad, doSave } from '@/app/saveActions'
import { cycleBoost } from '@/app/uiActions'
import { executeCommand } from '@/app/commandRunner'
import { setCommandFocusHandler } from '@/app/commandFocus'

/**指令输入框内容 */
const cmdText = ref('')
/**指令输入框元素 */
const cmdInput = ref<HTMLInputElement>()
/**执行指令并清空输入框 */
function runCommand() {
  if (cmdText.value.trim()) executeCommand(cmdText.value)
  cmdText.value = ''
}
//注册"/"快捷键的聚焦处理:填入"/"并聚焦到指令输入框
onMounted(() =>
  setCommandFocusHandler(() => {
    cmdText.value = '/'
    nextTick(() => cmdInput.value?.focus())
  }),
)
onUnmounted(() => setCommandFocusHandler(null))
</script>
<template>
  <div id="toolBar">
    <button
      v-if="hasKnowledge('time-pause')"
      class="tool"
      :title="player.paused ? '恢复(需购买知识升级:暂停功能)' : '暂停(需购买知识升级:暂停功能)'"
      @click="pause()"
    >
      <!--按钮显示"点击后执行的动作":运行时显示暂停图标,暂停时显示播放图标-->
      <svg v-if="!player.paused" viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
        <rect x="3" y="2" width="3.5" height="12" rx="1" />
        <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
      </svg>
      <svg v-else viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
        <path d="M3 2 L13 8 L3 14 Z" />
      </svg>
    </button>
    <button
      v-if="hasKnowledge('time-tick')"
      class="tool"
      title="时间流逝1帧(需购买知识升级:TAS)"
      @click="tick()"
    >
      <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
        <rect x="2.5" y="2.5" width="3" height="11" rx="1" />
        <path d="M8.5 3 L14.5 8 L8.5 13 Z" />
      </svg>
    </button>
    <button
      v-if="hasKnowledge('time-boost')"
      class="tool boost"
      title="加速倍速,消耗离线时间,点击循环切换(需购买知识升级:离线加速)"
      @click="cycleBoost()"
    >
      <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
        <path d="M9 1 L3 9 H7 L6 15 L13 6 H8.5 Z" />
      </svg>
      <span class="boostMult">x{{ player.boostSpeed.toNumber() }}</span>
    </button>
    <button class="tool" title="存档(选择槽位)" @click="doSave()">
      <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
        <path d="M3 2 H11 L14 5 V14 H2 V2 Z" />
        <rect x="4" y="2" width="5" height="4" />
        <rect x="4" y="9" width="8" height="5" />
      </svg>
    </button>
    <button class="tool" title="读档(选择槽位)" @click="doLoad()">
      <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor">
        <path d="M1 4 H8 L10 6 H15 V13 H1 Z" />
      </svg>
    </button>
    <input
      v-if="hasKnowledge('command-checkin')"
      ref="cmdInput"
      v-model="cmdText"
      class="commandInput"
      placeholder="/指令"
      title="输入指令(需购买知识升级:指令系统)"
      @keydown.enter="runCommand()"
    />
  </div>
</template>
<style scoped>
div#toolBar {
  border: 2px solid var(--dim);
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
}
button.tool {
  margin: 0px;
  width: 32px;
  border: 0px;
  height: 100%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
button.tool.boost {
  width: auto;
  gap: 3px;
  padding: 0 5px;
}
span.boostMult {
  font-size: 14px;
}
input.commandInput {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  margin-left: 4px;
  padding: 0 6px;
  font-size: 13px;
}
</style>
