//设置(纯呈现偏好，独立于存档，存放在localStorage)
import { reactive } from 'vue'
import { gameName } from '@/data/constants'
import { unlockAchievementById } from '@/logic/achievements'
import { type logType } from '@/app/log'

export type themeType = 'dark' | 'light'

/**主题定义 */
export interface ThemeDef {
  id: themeType
  name: string
}

/**所有可选的主题(加入新主题时在此添加，并到style.css中补充body.<id>的变量覆盖) */
export const THEMES: ThemeDef[] = [
  { id: 'dark', name: '深色' },
  { id: 'light', name: '浅色' },
]

export interface Settings {
  /**主题 */
  theme: themeType
  /**是否显示滚动新闻 */
  showNews: boolean
  /**是否显示工具栏 */
  showToolBar: boolean
  /**是否自动保存 */
  autoSave: boolean
  /**自动保存间隔(秒) */
  autoSaveInterval: number
  /**是否显示日志栏 */
  showLog: boolean
  /**各类型日志是否显示 */
  logFilter: Record<logType, boolean>
  /**知识页是否隐藏已满级的知识升级 */
  hideMaxedKnowledge: boolean
  /**知识页各类别是否显示(缺省视为显示),键为类别id */
  knowledgeCategoryVisible: Record<string, boolean>
  /**普通重置前是否二次确认 */
  resetConfirm: boolean
  /**是否启用快捷键 */
  hotkeys: boolean
  /**资源栏显示的条目(键为资源id,见resourceRegistry) */
  resourceBarItems: Record<string, boolean>
}

/**默认设置 */
export function defaultSettings(): Settings {
  return {
    theme: 'dark',
    showNews: true,
    showToolBar: true,
    autoSave: true,
    autoSaveInterval: 10,
    showLog: true,
    logFilter: { info: true, warning: true, error: true, progress: true, automator: true },
    hideMaxedKnowledge: true,
    knowledgeCategoryVisible: {},
    resetConfirm: true,
    hotkeys: true,
    resourceBarItems: { highest: true, points: true, otherLayers: true, knowledge: true, challenge: true },
  }
}

export const settings: Settings = reactive(defaultSettings())

const SETTINGS_KEY = gameName + '-settings'

/**从localStorage读取设置 */
export function loadSettings() {
  const s = localStorage.getItem(SETTINGS_KEY)
  if (s) {
    try {
      Object.assign(settings, defaultSettings(), JSON.parse(s))
    } catch {
      //设置损坏时使用默认值
    }
  }
}

/**保存设置到localStorage */
export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

/**应用主题到页面 */
export function applyTheme() {
  for (const t of THEMES) document.body.classList.remove(t.id)
  document.body.classList.add(settings.theme)
}

/**隐藏成就"闪瞎狗眼"的连击跟踪(连续切换主题且间隔<=1秒) */
let themeSwitchStreak = 0
let lastThemeSwitch = 0

/**循环切换主题 */
export function cycleTheme() {
  const idx = THEMES.findIndex((t) => t.id == settings.theme)
  const next = THEMES[(idx + 1) % THEMES.length]
  if (next) {
    const now = Date.now()
    themeSwitchStreak = now - lastThemeSwitch <= 1000 ? themeSwitchStreak + 1 : 1
    lastThemeSwitch = now
    if (themeSwitchStreak >= 100) unlockAchievementById('s16')
    settings.theme = next.id
    applyTheme()
    saveSettings()
  }
}
