//快捷键注册表:同一份定义驱动全局按键分发与"选项→快捷键"页的说明列表
//(输入控件聚焦或对话框打开时不响应;设置里可整体开关)
import { player } from '@/data/player'
import { settings } from '@/app/settings'
import { currentDialog } from '@/app/dialog'
import { buyDimension, buyDimensionMax, maxBuyAll } from '@/logic/purchase'
import { toggleAllAuto, toggleLayerAuto } from '@/logic/automations'
import { canReset } from '@/compute/prestige'
import { canInfinityReset } from '@/compute/infinity'
import { hasKnowledge } from '@/compute/knowledge'
import { doLoad, doSave } from '@/app/saveActions'
import { cycleBoost, infinityResetConfirm, resetLayerConfirm } from '@/app/uiActions'
import { cycleCurrentSubtab, cycleLayer, mainTabsList } from '@/app/navigation'
import { focusCommandInput } from '@/app/commandFocus'
import { DIMENSION_COUNT } from '@/data/constants'
import { pause } from './core'

/**快捷键注册表条目:同一份定义同时用于按键分发与"选项→快捷键"页显示 */
export interface HotkeyDef {
  /**唯一标识(调试/排序用) */
  id: string
  /**选项页显示的按键名(组合键如'Shift+A';系列键如'1~4') */
  keys: string
  /**选项页显示的描述 */
  desc: string
  /**该按键事件是否命中本快捷键(组合键/系列范围/适用页面等判断都在这里) */
  isPressed(e: KeyboardEvent): boolean
  /**命中后执行的动作(需要吞掉默认行为时自行调用e.preventDefault) */
  run(e: KeyboardEvent): void
}

//------匹配辅助------
/**是否按下了Ctrl/Alt/Meta(浏览器或系统快捷键占用,字母/符号快捷键不应响应) */
function hasSysMod(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.altKey || e.metaKey
}
/**是否按下了指定单字母键(忽略大小写,排除Ctrl/Alt/Meta;Shift由调用方另行区分) */
function pressLetter(e: KeyboardEvent, key: string): boolean {
  return e.key.toLowerCase() == key && !hasSysMod(e)
}
/**从数字键事件解析维度序号(0基);非顶排数字键返回-1 */
function digitIndex(e: KeyboardEvent): number {
  const m = /^Digit([1-9])$/.exec(e.code)
  return m ? Number(m[1]) - 1 : -1
}

//------注册表(顺序即"选项→快捷键"页的显示顺序)------
export const HOTKEYS: HotkeyDef[] = [
  //↑/↓:切换主标签(与导航栏共用同一份按解锁过滤的列表,循环取模)
  {
    id: 'switch-tab',
    keys: '↑ / ↓',
    desc: '切换主标签',
    isPressed: (e) => (e.key == 'ArrowUp' || e.key == 'ArrowDown') && !hasSysMod(e),
    run: (e) => {
      e.preventDefault()
      const list = mainTabsList.value
      if (list.length == 0) return
      const idx = list.findIndex((t) => t.id == player.mainTab)
      const dir = e.key == 'ArrowUp' ? -1 : 1
      const t = list[((idx < 0 ? 0 : idx) + dir + list.length) % list.length]
      if (t) player.mainTab = t.id
    },
  },
  //←/→:层级页切换所选层级,其余页切换子标签
  {
    id: 'cycle-layer-or-subtab',
    keys: '← / →',
    desc: '层级页切换所选层级,其余页切换子标签',
    isPressed: (e) => (e.key == 'ArrowLeft' || e.key == 'ArrowRight') && !hasSysMod(e),
    run: (e) => {
      e.preventDefault()
      const dir = e.key == 'ArrowLeft' ? -1 : 1
      if (player.mainTab == 'layers') cycleLayer(dir)
      else cycleCurrentSubtab(dir)
    },
  },
  //数字键1~n:仅层级页内购买本层对应维度(用e.code按物理键位判断,与键盘布局无关;Shift+数字已废除)
  {
    id: 'buy-dim',
    keys: `1~${DIMENSION_COUNT}`,
    desc: '层级页内购买本层对应维度',
    isPressed: (e) => {
      if (player.mainTab != 'layers') return false
      if (e.shiftKey || hasSysMod(e)) return false
      const idx = digitIndex(e)
      return idx >= 0 && idx < DIMENSION_COUNT
    },
    run: (e) => {
      e.preventDefault()
      const idx = digitIndex(e)
      if (idx < 0 || idx >= DIMENSION_COUNT) return
      //解锁"最大购买"且"购买模式:买最大"时数字键也买最大
      if (hasKnowledge('max-buy') && settings.buyMax) buyDimensionMax(player.layerSubtab, idx)
      else buyDimension(player.layerSubtab, idx)
    },
  },
  //M:一键买满本层(维度从高到低,再可购买;需知识升级max-buy)
  {
    id: 'buy-all',
    keys: 'M',
    desc: '买满本层全部维度与可购买(需知识升级解锁)',
    isPressed: (e) => pressLetter(e, 'm'),
    run: () => {
      if (hasKnowledge('max-buy')) maxBuyAll(player.layerSubtab)
    },
  },
  {
    id: 'pause-game',
    keys: 'SPACE',
    desc: '暂停/恢复游戏',
    isPressed: (e) => pressLetter(e, ' '),
    run: () => {
      if (hasKnowledge('time-pause')) pause()
    },
  },
  {
    id: 'reset-layer',
    keys: 'R',
    desc: '重置当前层(受二次确认设置控制)',
    isPressed: (e) => pressLetter(e, 'r'),
    run: () => {
      if (canReset(player.layerSubtab)) void resetLayerConfirm()
    },
  },
  {
    id: 'infinity-reset',
    keys: 'I',
    desc: '无限重置(点数达到1.79e308时可用)',
    isPressed: (e) => pressLetter(e, 'i'),
    run: () => {
      if (canInfinityReset()) void infinityResetConfirm()
    },
  },
  {
    id: 'save',
    keys: 'S',
    desc: '弹出存档对话框',
    isPressed: (e) => pressLetter(e, 's'),
    run: () => void doSave(),
  },
  {
    id: 'load',
    keys: 'L',
    desc: '弹出读档对话框',
    isPressed: (e) => pressLetter(e, 'l'),
    run: () => void doLoad(),
  },
  {
    id: 'auto-layer',
    keys: 'A',
    desc: '开关当前层自动化',
    isPressed: (e) => pressLetter(e, 'a') && !e.shiftKey,
    run: () => toggleLayerAuto(player.layerSubtab),
  },
  {
    id: 'auto-all',
    keys: 'Shift+A',
    desc: '开关全部自动化',
    isPressed: (e) => pressLetter(e, 'a') && e.shiftKey,
    run: () => toggleAllAuto(),
  },
  {
    id: 'cycle-boost',
    keys: 'X',
    desc: '循环切换加速倍率',
    isPressed: (e) => pressLetter(e, 'x'),
    run: () => cycleBoost(),
  },
  {
    id: 'command-slash',
    keys: '/',
    desc: '聚焦指令输入框并输入"/"',
    isPressed: (e) => e.key == '/' && !hasSysMod(e),
    run: (e) => {
      //工具栏显示时聚焦指令输入框(指令输入框未挂载时无效果)
      if (!settings.showToolBar) return
      e.preventDefault()
      focusCommandInput()
    },
  },
]

/**获取全部已注册快捷键(选项页"快捷键"页显示用,新增快捷键无需改动该页) */
export function getHotkeys(): HotkeyDef[] {
  return HOTKEYS
}

/**全局按键处理:顶部守卫后按注册表顺序匹配,第一个命中者执行动作 */
function onKeydown(e: KeyboardEvent) {
  //快捷键开关、输入控件聚焦或对话框打开时不响应
  if (!settings.hotkeys) return
  const target = e.target as HTMLElement
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
  if (currentDialog.value) return
  for (const h of HOTKEYS) {
    if (h.isPressed(e)) {
      h.run(e)
      return
    }
  }
}

/**启用全局快捷键(应用挂载时调用) */
export function initHotkeys() {
  window.addEventListener('keydown', onKeydown)
}
/**禁用全局快捷键(应用卸载时调用) */
export function disposeHotkeys() {
  window.removeEventListener('keydown', onKeydown)
}
