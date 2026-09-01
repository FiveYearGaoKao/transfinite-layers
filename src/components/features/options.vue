<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Decimal from 'break_eternity.js'
import { format, formatTime, formatWhole } from '@/tools/format'
import { player } from '@/data/player'
import type { LayerId } from '@/data/types'
import { registerSubtabCycler, unregisterSubtabCycler } from '@/app/navigation'
import { getActiveLayers, getLayerName, hasAchievement } from '@/access'
import { NEWS_COUNT } from '@/app/news'
import { buildGlobalNodes, buildLayerNodes, type StatNode } from '@/compute/statistics'
import LayerSelect from './layerSelect.vue'
import StatTree from './statTree.vue'
import { importSaveString, exportSaveString, getCurrentSlot, localSave } from '@/save/save'
import { settings, saveSettings, cycleTheme, THEMES, type Settings } from '@/app/settings'
import { temp } from '@/app/temp'
import { type logType, addLog } from '@/app/log'
import { doHardReset, doLoad, doSave } from '@/app/saveActions'
import { unlockAllUi } from '@/logic/knowledge'
import { gameVersion, gameName } from '@/data/constants'
import { CHANGELOG } from '@/data/changelog'
import { hasKnowledge } from '@/compute/knowledge'
import { RESOURCE_ITEMS } from '@/app/resourceRegistry'

type optionsTab = 'settings' | 'hotkeys' | 'about' | 'changelog' | 'statistics'
const subtab = ref<optionsTab>('settings')
/**选项页子标签的循环切换(快捷键左右键用) */
const OPTIONS_TABS: optionsTab[] = ['settings', 'hotkeys', 'about', 'changelog', 'statistics']
onMounted(() =>
  registerSubtabCycler('options', (dir) => {
    const idx = OPTIONS_TABS.indexOf(subtab.value)
    subtab.value =
      OPTIONS_TABS[(idx + dir + OPTIONS_TABS.length) % OPTIONS_TABS.length] ?? 'settings'
  }),
)
onUnmounted(() => unregisterSubtabCycler('options'))
/**是否为生产构建(发布版),调试区入口在发布版中隐藏 */
const isProd = import.meta.env.PROD

/**快捷键说明列表(快捷键页显示) */
const HOTKEY_HELP: { keys: string; desc: string }[] = [
  { keys: '1~9 / 0', desc: '切换主标签' },
  { keys: '← / →', desc: '层级页切换所选层级,其余页切换子标签' },
  { keys: 'Shift+1~4', desc: '购买当前层维度1~4' },
  { keys: 'R', desc: '重置当前层(受二次确认设置控制)' },
  { keys: 'I', desc: '无限重置(点数达到1.79e308时可用)' },
  { keys: 'S', desc: '弹出存档对话框' },
  { keys: 'L', desc: '弹出读档对话框' },
  { keys: 'A', desc: '开关当前层自动化' },
  { keys: 'Shift+A', desc: '开关全部自动化' },
  { keys: 'B', desc: '循环切换加速倍率' },
  { keys: '/', desc: '聚焦指令输入框并输入"/"' },
]

/**导出存档 */
const exportText = ref('')
function doExport() {
  localSave()
  exportText.value = exportSaveString()
}
async function copyExport() {
  if (!exportText.value) return
  try {
    await navigator.clipboard.writeText(exportText.value)
  } catch {
    //剪贴板不可用时忽略
  }
}
/**导入存档(从同一文本框读取) */
function doImport() {
  if (importSaveString(exportText.value)) {
    exportText.value = ''
  }
}
/**文件选择器(从文件导入用) */
const fileInput = ref<HTMLInputElement>()
/**当前时间戳(文件名用):YYYYMMDD-HHMMSS */
function fileTimestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
/**把存档导出为txt文件(文件名:游戏名-版本号-当前时间.txt) */
function exportToFile() {
  localSave()
  const blob = new Blob([exportSaveString()], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${gameName}-${gameVersion}-${fileTimestamp()}.txt`
  a.click()
  URL.revokeObjectURL(url)
}
/**从txt文件读取并导入存档 */
function importFromFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result ?? '')
    if (importSaveString(text)) exportText.value = ''
    input.value = ''
  }
  reader.readAsText(file)
}
/**当前主题的名称 */
const themeName = computed(() => THEMES.find((t) => t.id == settings.theme)?.name ?? settings.theme)
/**boolean类型的顶层设置键 */
type booleanSettingKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never
}[keyof Settings]
/**通用的设置项修改:赋新值并保存 */
function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings[key] = value
  saveSettings()
}
/**反转boolean设置项并保存 */
function toggleSettings(key: booleanSettingKey) {
  settings[key] = !settings[key]
  saveSettings()
}
/**切换资源栏某条目的显示并保存 */
function toggleResource(id: string) {
  settings.resourceBarItems[id] = !settings.resourceBarItems[id]
  saveSettings()
}
/**所有日志类型 */
const logTypes: logType[] = ['info', 'warning', 'error', 'progress', 'automator']
/**切换某类型日志的显示 */
function toggleLogType(t: logType) {
  settings.logFilter[t] = !settings.logFilter[t]
  saveSettings()
}
/**离线时间去向的三种模式 */
const OFFLINE_MODES: ('warp' | 'store' | 'ask')[] = ['warp', 'store', 'ask']
/**离线时间去向模式的显示名称 */
function offlineModeName(m: string): string {
  return m == 'store' ? '储存' : m == 'ask' ? '询问' : '加速'
}
/**循环切换离线时间去向模式 */
function cycleOfflineMode() {
  const idx = OFFLINE_MODES.indexOf(player.offlineMode)
  player.offlineMode = OFFLINE_MODES[(idx + 1) % OFFLINE_MODES.length] ?? 'warp'
}
/**手动保存到当前槽位 */
function doManualSave() {
  localSave()
  addLog('info', '游戏已保存')
}
/**设置自动保存间隔(秒),非法输入保持原值 */
function setAutoSaveInterval(v: string) {
  const n = Math.floor(Number(v))
  if (Number.isFinite(n) && n > 0) setSetting('autoSaveInterval', n)
}
/**解析全局速度初始值输入,非法时保持原值 */
function setDebugSpeed(v: string) {
  const d = new Decimal(v)
  if (!Decimal.isNaN(d) && d.gt(0)) temp.debugSpeed = d
}
/**当前所选层级的加成树(每维度一棵产量树) */
const layerNodes = computed<StatNode[]>(() => buildLayerNodes(statLayer.value))
/**全局(层级无关)加成树 */
const globalNodes = computed<StatNode[]>(() => buildGlobalNodes())
/**统计页查看的层级(缺省跟随当前层,可在统计页内切换) */
const statLayer = ref<LayerId>([0])
watch(
  () => player.layerSubtab,
  (v) => (statLayer.value = v),
  { immediate: true },
)

//------资源明细页------
/**统计页内部子标签 */
const statsTab = ref<'buffs' | 'resources'>('buffs')
/**全部活跃层级(资源明细页用) */
const activeLayers = computed(() =>
  getActiveLayers().map(({ key, pos, L }) => ({ key, name: getLayerName(pos), L })),
)
</script>
<template>
  <div id="options">
    <div class="subtabRow">
      <button
        :class="{ subTab: true, selected: subtab == 'settings' }"
        @click="subtab = 'settings'"
      >
        设置
      </button>
      <button :class="{ subTab: true, selected: subtab == 'hotkeys' }" @click="subtab = 'hotkeys'">
        快捷键
      </button>
      <button :class="{ subTab: true, selected: subtab == 'about' }" @click="subtab = 'about'">
        关于游戏
      </button>
      <button
        :class="{ subTab: true, selected: subtab == 'changelog' }"
        @click="subtab = 'changelog'"
      >
        更新记录
      </button>
      <button
        :class="{ subTab: true, selected: subtab == 'statistics' }"
        @click="subtab = 'statistics'"
      >
        统计
      </button>
    </div>

    <div v-if="subtab == 'settings'" id="settings">
      <div class="section">
        <span class="text bold">界面</span>
        <div class="row">
          <button :class="{ toggle: true, selected: true }" @click="cycleTheme()">
            主题：{{ themeName }}
          </button>
          <button
            :class="['toggle', settings.showToolBar ? 'toggle-on' : 'toggle-off']"
            @click="toggleSettings('showToolBar')"
          >
            工具栏：{{ settings.showToolBar ? '开' : '关' }}
          </button>
          <button
            :class="['toggle', settings.showLog ? 'toggle-on' : 'toggle-off']"
            @click="toggleSettings('showLog')"
          >
            日志栏：{{ settings.showLog ? '开' : '关' }}
          </button>
          <button
            :class="['toggle', settings.showNews ? 'toggle-on' : 'toggle-off']"
            @click="toggleSettings('showNews')"
          >
            滚动新闻：{{ settings.showNews ? '开' : '关' }}
          </button>
        </div>
      </div>
      <div class="section">
        <span class="text bold">资源栏</span>
        <div class="row">
          <button
            v-for="r in RESOURCE_ITEMS"
            :key="r.id"
            :class="['toggle', settings.resourceBarItems[r.id] ? 'toggle-on' : 'toggle-off']"
            @click="toggleResource(r.id)"
          >
            {{ r.label }}:{{ settings.resourceBarItems[r.id] ? '开' : '关' }}
          </button>
        </div>
      </div>
      <div class="section">
        <span class="text bold">日志</span>
        <div class="row">
          <button
            v-for="t in logTypes"
            :key="t"
            :class="['toggle', settings.logFilter[t] ? 'toggle-on' : 'toggle-off']"
            @click="toggleLogType(t)"
          >
            {{ t }}
          </button>
        </div>
      </div>
      <div class="section">
        <span class="text bold">确认</span>
        <div class="row">
          <button
            :class="['toggle', settings.resetConfirm ? 'toggle-on' : 'toggle-off']"
            @click="toggleSettings('resetConfirm')"
          >
            普通重置:{{ settings.resetConfirm ? '开' : '关' }}
          </button>
          <button
            :class="['toggle', settings.infinityResetConfirm ? 'toggle-on' : 'toggle-off']"
            @click="toggleSettings('infinityResetConfirm')"
          >
            无限重置:{{ settings.infinityResetConfirm ? '开' : '关' }}
          </button>
        </div>
      </div>
      <div class="section">
        <span class="text bold">其它</span>
        <div class="row">
          <button
            :class="['toggle', settings.hotkeys ? 'toggle-on' : 'toggle-off']"
            @click="toggleSettings('hotkeys')"
          >
            快捷键：{{ settings.hotkeys ? '开' : '关' }}
          </button>
          <button
            v-if="hasKnowledge('time-store')"
            class="toggle"
            title="询问模式会在离线结束时弹出选择"
            @click="cycleOfflineMode()"
          >
            离线时间去向:{{ offlineModeName(player.offlineMode) }}
          </button>
        </div>
      </div>
      <div class="section">
        <span class="text bold">存档</span>
        <div class="row">
          <span class="text">当前存档槽位: {{ getCurrentSlot() + 1 }}</span>
        </div>
        <div class="row">
          <button @click="doManualSave()">手动保存</button>
          <button @click="doSave()">存档</button>
          <button @click="doLoad()">读档</button>
        </div>
        <div class="row">
          <button
            :class="['toggle', settings.autoSave ? 'toggle-on' : 'toggle-off']"
            @click="toggleSettings('autoSave')"
          >
            自动保存：{{ settings.autoSave ? '开' : '关' }}
          </button>
          <span class="text">间隔</span>
          <input
            type="number"
            min="1"
            max="3600"
            :value="settings.autoSaveInterval"
            :disabled="!settings.autoSave"
            @change="setAutoSaveInterval(($event.target as HTMLInputElement).value)"
          />
          <span class="text">秒</span>
        </div>
        <textarea
          v-model="exportText"
          placeholder="点击导出生成存档，或粘贴存档后导入"
          rows="5"
        ></textarea>
        <div class="row">
          <button @click="doExport()">导出</button>
          <button @click="copyExport()">复制</button>
          <button @click="doImport()">导入</button>
          <button @click="exportToFile()">导出到文件</button>
          <button @click="fileInput?.click()">从文件导入</button>
          <input
            ref="fileInput"
            type="file"
            accept=".txt"
            style="display: none"
            @change="importFromFile($event)"
          />
        </div>
        <div class="row">
          <button class="bad" @click="doHardReset()">硬重置</button>
        </div>
      </div>
      <div v-if="!isProd" class="section">
        <span class="text bold">调试</span>
        <div class="row">
          <button
            :class="['toggle', temp.debugMode ? 'toggle-on' : 'toggle-off']"
            @click="temp.debugMode = !temp.debugMode"
          >
            调试模式：{{ temp.debugMode ? '开' : '关' }}
          </button>
        </div>
        <div v-if="temp.debugMode" class="row">
          <button
            class="toggle"
            title="将QoL类知识升级直接设满并解锁知识页,无需前置与知识"
            @click="unlockAllUi()"
          >
            解锁所有UI
          </button>
        </div>
        <div v-if="temp.debugMode" class="row">
          <span class="text">全局速度初始值(不存档)</span>
          <input
            :value="temp.debugSpeed.toString()"
            @change="setDebugSpeed(($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
    </div>

    <div v-if="subtab == 'hotkeys'" id="hotkeys" class="section">
      <span class="text">快捷键列表(可在设置中整体开关)</span>
      <div class="section box hotkeyGrid">
        <template v-for="h in HOTKEY_HELP" :key="h.keys">
          <span class="text bold hotkey">{{ h.keys }}</span>
          <span class="text">{{ h.desc }}</span>
        </template>
      </div>
    </div>

    <div v-if="subtab == 'about'" id="about" class="section">
      <span class="text bold"
        >版本: <span class="version">{{ gameVersion }}</span></span
      >
      <div class="section box left">
        <span class="text bold">版本终局(v0.1.0)</span>
        <span class="text">目标: 层级0点数达到 1.79e308,解锁"无限"。</span>
        <span class="text">推荐进度: C1~C4 完成次数 10 / 10 / 1 / 1。</span>
        <span class="text">成就: 除 a44"永无止境"(获得层级4点数)外的其他 31 个普通成就。</span>
        <span class="text">其它内容见"更新记录"页。</span>
      </div>
      <div class="section box left">
        <span class="text bold">如何游玩</span>
        <span class="text"
          >核心循环: 生产点数 → 重置晋升 → 解锁更高层级 → 能量反馈 → 更快生产。</span
        >
        <span class="text">知识是跨重置货币: 成就/签到/答题获得,用于购买知识升级。</span>
        <span class="text">挑战页在成就 a28(Googol)后解锁;自动化首次购买 u4 后永久开放。</span>
        <span class="text">快捷键列表见"快捷键"页;详细玩法见文档 docs/面向玩家/玩法指南.md。</span>
      </div>
    </div>

    <div v-if="subtab == 'changelog'" id="changelog" class="section">
      <div v-for="c in CHANGELOG" :key="c.version" class="changelog">
        <span class="text bold version">{{ c.version }}{{ c.name ? ` - ${c.name}` : '' }} </span>
        <ul class="changelogNotes">
          <li v-for="note in c.notes" :key="note" class="text">{{ note }}</li>
        </ul>
      </div>
    </div>

    <div v-if="subtab == 'statistics'" id="statistics">
      <div class="subtabRow">
        <button
          :class="{ subTab: true, selected: statsTab == 'buffs' }"
          @click="statsTab = 'buffs'"
        >
          加成明细
        </button>
        <button
          :class="{ subTab: true, selected: statsTab == 'resources' }"
          @click="statsTab = 'resources'"
        >
          资源明细
        </button>
      </div>

      <div v-if="statsTab == 'buffs'" id="buffStats">
        <div class="section">
          <span class="text bold">层级加成 · {{ getLayerName(statLayer) }}</span>
          <LayerSelect v-model="statLayer" />
          <StatTree :nodes="layerNodes" />
        </div>
        <div class="section">
          <span class="text bold">全局加成(层级无关)</span>
          <StatTree :nodes="globalNodes" />
        </div>
      </div>

      <div v-else id="resourceStats" class="section">
        <div class="section box left">
          <span class="text bold">存档与时间</span>
          <span class="text">存档创建时间: {{ new Date(player.firstPlay).toLocaleString() }}</span>
          <span class="text">游戏时间(现实): {{ formatTime(player.realTime) }}</span>
          <span class="text">游戏时间: {{ formatTime(player.totalTime) }}</span>
          <span class="text">离线时间: {{ formatTime(player.offlineTime) }}</span>
          <span class="text">加速时间: {{ formatTime(player.warpTime) }}</span>
          <span class="text">层级0累计生产: {{ format(player.totalPoints) }}</span>
        </div>
        <div class="section box left">
          <span class="text bold">全局统计</span>
          <span class="text">已看新闻: {{ player.seenNews.length }} / {{ NEWS_COUNT }}</span>
          <span class="text">成功使用的指令: {{ player.commandCount }}</span>
          <span class="text">答题次数: {{ player.quizCount }}</span>
          <span class="text"
            >签到: 连续{{ player.checkin.streak }}天 · 上次:{{
              player.checkin.lastDay || '从未'
            }}</span
          >
        </div>
        <div v-if="hasAchievement('a48')" class="section box left">
          <span class="text bold">无限</span>
          <span class="text">本次无限经历时间: {{ formatTime(player.infinityRunTime) }}</span>
          <span class="text">无限重置最短时间: {{ formatTime(player.infinityBestResetTime) }}</span>
          <span class="text">总无限点数: {{ format(player.totalInfinityPoints) }}</span>
        </div>
        <div class="section box left">
          <span class="text bold">层级资源</span>
          <div v-for="l in activeLayers" :key="l.key" class="layerStats">
            <span class="text bold layerName">{{ l.name }}</span>
            <span class="text"
              >点数: {{ format(l.L.points) }} · 能量: {{ format(l.L.energy) }}</span
            >
            <span class="text"
              >重置时间: {{ formatTime(l.L.resetTime) }} · 重置次数:
              {{ formatWhole(l.L.resetCount) }}</span
            >
            <span class="text"
              >最高重置点数: {{ format(l.L.bestPoints) }} · 累计点数:
              {{ format(l.L.totalPoints) }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
div#options {
  display: flex;
  flex-direction: column;
  align-items: center;
}
textarea {
  width: 320px;
  resize: none;
  color: var(--dim);
  border-color: var(--faint);
  padding: 4px;
}
input {
  width: 120px;
  padding: 4px;
}
span.hotkey {
  min-width: 96px;
  color: var(--accent);
}
div.hotkeyGrid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 16px;
  justify-items: start;
  align-items: center;
}
/*左对齐区块(资源明细/更新日志)*/
div.left {
  align-items: flex-start;
  text-align: left;
  width: 100%;
  max-width: 560px;
  box-sizing: border-box;
}
div.layerStats {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  border-top: 1px solid var(--faint);
  padding: 4px 0;
}
span.layerName {
  color: var(--good-border);
}
/*更新日志:紧凑+左对齐*/
div.changelog {
  width: 100%;
  max-width: 560px;
  text-align: left;
  margin-top: 6px;
}
span.version {
  color: var(--accent);
}
ul.changelogNotes {
  margin: 2px 0 0 0;
  padding-left: 20px;
}
ul.changelogNotes li {
  line-height: 1.5;
}
</style>
