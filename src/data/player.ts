import Decimal from 'break_eternity.js'
import { reactive } from 'vue'
import {
  initializeLayer,
  type LayerList,
  type LayerAutomation,
  type AutoConfig,
  type InfinityResetRecord,
} from './types'
import { gameVersion, INITIAL_BASE, DEFAULT_BOOST_SPEED } from './constants'
import type { QuizQuestion } from '@/tools/quiz'

//------类型声明------
export type mainTabs =
  | 'layers'
  | 'options'
  | 'achievements'
  | 'knowledge'
  | 'automation'
  | 'challenges'
  | 'infinity'
  | 'singularity'
  | 'tree'
  | 'ordinal'

/**
 * 无限页的子标签id(新增子标签时在此追加)
 * 兼作读档兜底的白名单:`player.infinityTab` 只允许这些值(元声望需购买iu25才显示,见infinityLayer.vue)
 */
export const INFINITY_SUBTAB_IDS = ['upgrades', 'milestones', 'metaPrestige'] as const

/**无限页的子标签 */
export type InfinitySubtab = (typeof INFINITY_SUBTAB_IDS)[number]

export interface Player {
  version: string
  firstPlay: number
  lastPlay: number
  seed: number
  /**当前随机数生成器状态(随存档持久化,防止刷新后随机序列重置) */
  rngState: number
  /**待答题(未作答前复用同一题,防止反复刷新题目) */
  pendingQuiz: QuizQuestion | null
  /**游玩时间(游戏时间) */
  totalTime: Decimal
  /**游玩时间(现实时间) */
  realTime: Decimal
  /**储存的离线时间 */
  offlineTime: Decimal
  /**加速时间 */
  warpTime: Decimal
  /**自存档创建以来【层级0维度1】生产的总点数(永不清除) */
  totalPoints: Decimal
  paused: boolean
  /**离线时间的去向:转加速时间/储存为离线时间/离线结束时询问(需升级"离线去向") */
  offlineMode: 'warp' | 'store' | 'ask'
  checkCode: number
  mainTab: mainTabs
  layerSubtab: number[]
  layers: LayerList
  layerDepth: number
  base: number
  achievements: string[]
  knowledge: Decimal
  /**各知识升级的已购数量 */
  knowledgeUpgrades: Record<string, Decimal>
  /**加速的目标倍率(1倍即关闭) */
  boostSpeed: Decimal
  /**各层级的自动化配置 */
  automations: Record<string, LayerAutomation>
  /**自动化全局配置模板(知识升级auto-global-config解锁,详见logic/automations) */
  autoGlobal: LayerAutomation
  /**全局配置模板是否已初始化过(首次打开"全局配置"页时从选中层复制,仅执行一次) */
  autoGlobalInit: boolean
  /**是否曾购买过自动化1(u4)(永久解锁自动化标签页) */
  automationUnlocked: boolean
  /**各挑战的完成次数 */
  challenges: Record<string, Decimal>
  /**当前激活的挑战(可叠加) */
  activeChallenges: string[]
  /**无限点数(Infinity Points,元重置层"无限"的资源) */
  infinityPoints: Decimal
  /**无限重置次数 */
  infinityResets: Decimal
  /**已购买的无限升级id(如'iu11') */
  infinityUpgrades: string[]
  /**本次无限经历的时间(秒,自上次无限重置起累计) */
  infinityRunTime: Decimal
  /**进行无限重置所用最短时间(未重置过为无穷大) */
  infinityBestResetTime: Decimal
  /**总无限点数(累计获得,永不清除) */
  totalInfinityPoints: Decimal
  /**历史最佳"无限点数/秒"(单次无限重置收益÷本次无限时长,供无限里程碑im100使用) */
  infinityBestRate: Decimal
  /**已完成的元维度提升次数(决定每层维度数与维度指数加成;只增不减,不被任何重置清除) */
  metaDimensionBoosts: Decimal
  /**元层自动化配置(键为元层自动化id,如'infinity';全局唯一实例,各机制自己判定解锁) */
  metaAutomations: Record<string, AutoConfig>
  /**无限页当前子标签(无限升级/无限里程碑) */
  infinityTab: InfinitySubtab
  /**挑战页当前子标签 */
  challengeTab: string
  /**签到数据:lastDay为最后签到日期(YYYY-MM-DD),streak为连续签到天数,highStreak为随机奖励>90的连续天数 */
  checkin: { lastDay: string; streak: number; highStreak: number }
  /**当前冷却结束的时间戳(毫秒):冷却结束时若未作答,答题次数按知识升级"答题储存"储存起来 */
  quizNextAt: number
  /**已储存的答题次数(上限为知识升级"答题储存"的等级,0表示不储存) */
  quizStored: number
  /**最近若干次无限重置的记录(新→旧;统计页"重置记录"页用) */
  infinityResetLog: InfinityResetRecord[]
  /**已看过的滚动新闻索引(隐藏成就"新闻收藏家"用) */
  seenNews: number[]
  /**成功使用的指令数(统计用) */
  commandCount: number
  /**答题次数(统计用) */
  quizCount: number
}
export type playerKey = keyof Player

//------初始化存档------
/**创建一个空白存档 */
export function initializeSave(): Player {
  const seed = Math.floor(Math.random() * 1e9)
  const player: Player = {
    version: gameVersion,
    firstPlay: Date.now(),
    lastPlay: Date.now(),
    seed,
    rngState: seed,
    pendingQuiz: null,
    totalTime: new Decimal(0),
    realTime: new Decimal(0),
    offlineTime: new Decimal(0),
    warpTime: new Decimal(0),
    totalPoints: new Decimal(0),
    paused: false,
    offlineMode: 'warp',
    checkCode: 0,
    mainTab: 'layers',
    layerSubtab: [0],
    layers: {
      '0': initializeLayer(0, true),
    },
    layerDepth: 1,
    base: INITIAL_BASE,
    achievements: [],
    knowledge: new Decimal(0),
    knowledgeUpgrades: {},
    boostSpeed: new Decimal(DEFAULT_BOOST_SPEED),
    automations: {},
    autoGlobal: { cfgs: {} },
    autoGlobalInit: false,
    automationUnlocked: false,
    challenges: {},
    activeChallenges: [],
    infinityPoints: new Decimal(0),
    infinityResets: new Decimal(0),
    infinityUpgrades: [],
    infinityRunTime: new Decimal(0),
    infinityBestResetTime: Decimal.dInf,
    totalInfinityPoints: new Decimal(0),
    infinityBestRate: new Decimal(0),
    metaDimensionBoosts: new Decimal(0),
    metaAutomations: {},
    infinityTab: 'upgrades',
    challengeTab: 'normal',
    checkin: { lastDay: '', streak: 0, highStreak: 0 },
    quizNextAt: 0,
    quizStored: 0,
    infinityResetLog: [],
    seenNews: [],
    commandCount: 0,
    quizCount: 0,
  }
  return player
}
export const emptySave: Player = initializeSave()

//Decimal一律不参与Vue的响应式代理:所有Decimal运算都是整体替换(player.x = player.x.add(y)),
//从不就地修改,故代理它的内部字段(sign/mag/layer)没有任何意义,只会让每次运算都多走一层Proxy。
//标记打在原型上,因此运行期新建的Decimal同样跳过代理(逐个markRaw做不到这点)。
//依据与实测见 docs/面向开发者/数值.md;禁止在游戏代码里就地修改Decimal(normalize()等)
Object.defineProperty(Decimal.prototype, '__v_skip', { value: true })
export const player: Player = reactive(initializeSave())
