//指令执行(UI编排):解析"/"开头的指令→调用logic/commands→弹答题对话框→写日志
//指令均为ascii字符,不能使用中文
import { player } from '@/data/player'
import { addLog } from '@/data/log'
import { temp } from '@/data/temp'
import { hasKnowledge } from '@/compute/knowledge'
import { openQuiz } from '@/app/dialog'
import {
  doCheckin,
  getQuizQuestion,
  quizAvailable,
  quizCooldownLeft,
  submitQuizAnswer,
} from '@/logic/commands'
import { getPlayerValue, setPlayerValue } from '@/logic/debug'
import { unlockAchievementById } from '@/logic/achievements'
import { settings, saveSettings, applyTheme } from '@/app/settings'
import { formatTime } from '@/tools/format'
import { cacheStats, resetCacheStats } from '@/compute/frameCache'
import { resetSearchStats, searchStats } from '@/tools/bisect'

/**调试指令是否可用:仅开发构建(非发布版)且在调试模式下 */
function debugCommandsAvailable(): boolean {
  return !import.meta.env.PROD && temp.debugMode
}

/**指令定义 */
interface CommandInfo {
  cmd: string
  usage: string
  description: string
  /**是否已解锁(缺省为已解锁指令系统) */
  unlocked(): boolean
  /**是否为调试指令(不受"指令系统"知识升级限制,仅调试模式可用) */
  debugOnly?: boolean
  run(args: string): void | Promise<void>
}

/**彩蛋文本 */
const EGG_LINES = [
  '你找到了一颗彩蛋,但它只是一个蛋。',
  '这枚蛋有1.79e308层,但里面什么都没有。',
  '彩蛋之所以叫彩蛋,是因为它不会孵出鸡。',
  '蛋疼。',
  '你被骗了,这里没有彩蛋。',
]

/**几个著名的Minecraft指令(隐藏成就"这里不是MC"只看这些名字,不实现任何MC行为) */
const MC_COMMANDS = [
  'gamemode',
  'give',
  'tp',
  'teleport',
  'time',
  'kill',
  'effect',
  'summon',
  'setblock',
  'weather',
]

/**set指令可修改的布尔设置键 */
type BoolSettingKey =
  | 'autoSave'
  | 'showLog'
  | 'showNews'
  | 'showToolBar'
  | 'resetConfirm'
  | 'hideMaxedKnowledge'
const boolSettingKeys: Record<string, BoolSettingKey> = {
  autosave: 'autoSave',
  showlog: 'showLog',
  shownews: 'showNews',
  showtoolbar: 'showToolBar',
  resetconfirm: 'resetConfirm',
  hidemaxedknowledge: 'hideMaxedKnowledge',
}

/**所有指令(注册表) */
const COMMANDS: CommandInfo[] = [
  {
    cmd: 'checkin',
    usage: '/checkin',
    description: '每日签到,获得(0~100)+10*连续天数知识',
    unlocked: () => true,
    run() {
      const res = doCheckin()
      if (!res) addLog('info', '今天已经签过到了')
    },
  },
  {
    cmd: 'help',
    usage: '/help',
    description: '列出所有可用指令',
    unlocked: () => true,
    run() {
      //按行列出,配合日志栏换行显示
      const text = COMMANDS.filter((c) => c.unlocked())
        .map((c) => `${c.usage} ${c.description}`)
        .join('\n')
      addLog('info', text)
    },
  },
  {
    cmd: 'set',
    usage: '/set <键> <值>',
    description:
      '修改设置(theme/autoSave/showLog/showNews/showToolBar/resetConfirm/hideMaxedKnowledge)',
    unlocked: () => true,
    run(args) {
      const [key, value] = args.trim().toLowerCase().split(/\s+/)
      if (!key || value == null) {
        addLog('warning', '用法:/set <键> <值>')
        return
      }
      if (key == 'theme') {
        if (value == 'dark' || value == 'light') {
          settings.theme = value
          applyTheme()
          saveSettings()
          addLog('info', `主题已设为${value == 'dark' ? '深色' : '浅色'}`)
        } else {
          addLog('warning', '主题只能是dark或light')
        }
        return
      }
      const k = boolSettingKeys[key]
      if (k) {
        if (value != 'true' && value != 'false') {
          addLog('warning', '值只能是true或false')
          return
        }
        settings[k] = value == 'true'
        saveSettings()
        addLog('info', `${key} 已设为${value}`)
        return
      }
      addLog('warning', `未知设置键:${key}`)
    },
  },
  {
    cmd: 'quiz',
    usage: '/quiz',
    description: '答题,答对获得知识(有冷却)',
    unlocked: () => hasKnowledge('command-quiz'),
    async run() {
      if (!quizAvailable()) {
        addLog('warning', `答题冷却中,剩余${formatTime(quizCooldownLeft())}`)
        return
      }
      const question = getQuizQuestion()
      const answer = await openQuiz({
        title: '答题',
        question: question.text,
        options: question.options,
      })
      if (answer == null) {
        addLog('info', '答题已取消(该题保留,下次/quiz继续作答)')
        return
      }
      submitQuizAnswer(question, answer)
    },
  },
  {
    cmd: 'egg',
    usage: '/egg',
    description: '彩蛋',
    unlocked: () => true,
    run() {
      const line = EGG_LINES[Math.floor(Math.random() * EGG_LINES.length)]
      addLog('info', line ?? EGG_LINES[0] ?? '彩蛋')
    },
  },
  {
    cmd: 'getvalue',
    usage: '/getvalue <路径>',
    description: '调试:读取存档字段(如 infinityResets、challenges.c1、layers.0.points)',
    debugOnly: true,
    unlocked: () => debugCommandsAvailable(),
    run(args) {
      const path = args.trim()
      if (!path) {
        addLog('warning', '用法:/getvalue <路径>')
        return
      }
      const text = getPlayerValue(path)
      if (text == undefined) addLog('warning', `读取失败:路径不存在或不可读(${path})`)
      else addLog('info', `${path} = ${text}`)
    },
  },
  {
    cmd: 'setvalue',
    usage: '/setvalue <路径> <值>',
    description: '调试:写入存档字段(按字段原类型转换;顶层字段必须已存在)',
    debugOnly: true,
    unlocked: () => debugCommandsAvailable(),
    run(args) {
      const [path, ...rest] = args.trim().split(/\s+/)
      const value = rest.join(' ')
      if (!path || !value) {
        addLog('warning', '用法:/setvalue <路径> <值>')
        return
      }
      const res = setPlayerValue(path, value)
      addLog(res.ok ? 'info' : 'warning', res.ok ? `已设置:${res.text}` : `设置失败:${res.text}`)
    },
  },
  {
    cmd: 'perf',
    usage: '/perf',
    description: '调试:输出帧内缓存命中统计与搜索求值次数,并清零计数',
    debugOnly: true,
    unlocked: () => debugCommandsAvailable(),
    run() {
      //未命中次数即"缓存没起作用"的次数:改动缓存/锚点后用它对比(见docs/面向开发者/性能.md)
      const lines = cacheStats()
        .slice(0, 12)
        .map((s) => `${s.label} 命中${s.hits} 未命中${s.misses}`)
      lines.push(`搜索求值 ${searchStats().evals} 次(计数已清零)`)
      addLog('info', lines.join('\n'))
      resetCacheStats()
      resetSearchStats()
    },
  },
]

/**
 * 解析并执行一条指令
 * @param input 用户输入的原始文本
 * @returns 是否被识别为指令输入(否则调用方按普通文本处理)
 */
export function executeCommand(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (!trimmed.startsWith('/')) {
    addLog('warning', '指令必须以"/"开头')
    return true
  }
  //指令必须为ascii字符
  if (!/^\/[a-z][a-z0-9]*(\s+.*)?$/i.test(trimmed)) {
    addLog('warning', '指令格式错误:只能使用英文字母与数字')
    return true
  }
  const [raw, ...rest] = trimmed.slice(1).split(/\s+/)
  const cmd = (raw ?? '').toLowerCase()
  //隐藏成就"这里不是MC":MC指令只是彩蛋,不走指令系统的解锁判定
  if (MC_COMMANDS.includes(cmd)) {
    unlockAchievementById('s17')
    addLog('info', '这里不是MC,没有这条指令。')
    return true
  }
  const info = COMMANDS.find((c) => c.cmd == cmd)
  //指令系统整体由知识升级"指令系统"解锁;调试指令不受此限制(仅开发构建+调试模式可用)
  if (!hasKnowledge('command-checkin') && info?.debugOnly !== true) {
    addLog('warning', '未解锁指令系统(需购买知识升级:指令系统)')
    return true
  }
  if (!info) {
    addLog('warning', `未知指令:/${cmd}(输入/help查看可用指令)`)
    return true
  }
  if (!info.unlocked()) {
    addLog('warning', `指令未解锁:${info.usage}`)
    return true
  }
  player.commandCount += 1
  void info.run(rest.join(' '))
  return true
}
