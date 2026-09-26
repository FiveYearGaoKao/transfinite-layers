//模拟玩家(机器人)与无头模拟引擎
//契约:机器人只调用"按钮背后那层"的logic函数(与UI同源,见app/uiActions),不用调试指令、不直接改player状态
//引擎复用app/core的gameLoop与applyTimeResources,保证帧内顺序与时间规则都和真实游玩一致
//自适应步长:有动作时用基础步长,无动作时逐级放大;假时钟让"现实时间"随模拟时间流逝(签到/答题冷却都按它走)
//策略与口径见 docs/面向开发者/测试与平衡.md
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { addValue } from '@/save/save'
import {
  getHighestActiveLayer,
  getLayerName,
  getOrderedLayers,
  getOrderedTempLayers,
  getPoints,
  totalChallengeCompletions,
} from '@/access'
import { format, formatTime, formatWhole } from '@/tools/format'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { canBuyUpgrade, getUpgrades } from '@/compute/upgrades'
import { canReset, resetGain } from '@/compute/prestige'
import {
  canBuyInfinityUpgrade,
  canInfinityReset,
  getInfinityUpgrades,
  infinityGain,
} from '@/compute/infinity'
import {
  canBuyKnowledgeUpgrade,
  getBoostPresets,
  getKnowledgeUpgrade,
  hasKnowledge,
  knowledgeAmount,
} from '@/compute/knowledge'
import { buyBuyableMax, buyDimensionMax, buyUpgrade } from '@/logic/purchase'
import { getBuyables, isUnlocked as isBuyableUnlocked } from '@/compute/buyables'
import { doReset, findUnlockableTempLayer } from '@/logic/reset'
import { buyInfinityUpgrade, doInfinityReset } from '@/logic/infinity'
import { buyKnowledgeUpgrade, buyOfflineTimePct, convertOfflineToWarp } from '@/logic/knowledge'
import {
  checkedInToday,
  doCheckin,
  getQuizQuestion,
  quizAvailable,
  submitQuizAnswer,
} from '@/logic/commands'
import {
  challengeDone,
  completions,
  enterChallenge,
  exitChallenge,
  getAllChallenges,
  isActive,
  isForcedActive,
  isUnlocked,
} from '@/logic/challenges'
import { applyTimeResources, gameLoop } from '@/app/core'
import { freshSave, loadRealSave } from './helpers'

/**机器人策略:每步调用一次act;返回true表示这一步做了动作(自适应步长据此保持小步长) */
export interface BotPolicy {
  name: string
  /**引擎每步更新当前游戏时间(秒),供策略里的超时判定使用 */
  setTime?(t: Decimal): void
  act(): boolean
}

/**什么都不做的策略(等价于"挂机观察":测的是纯游戏内自动化能走多远) */
export function nonePolicy(): BotPolicy {
  return { name: 'none', act: () => false }
}

/**假时钟:把全局Date换成"起点+已过现实时间"的实现,返回"推进现实时间"的函数 */
export function installFakeClock(startMs: number = Date.now()): (realSeconds: number) => void {
  const RealDate = Date
  let fakeMs = startMs
  const FakeDate = class extends RealDate {
    constructor(...args: unknown[]) {
      //游戏只用到无参(现在)与单参(时间戳/字符串)两种构造
      if (args.length == 0) super(fakeMs)
      else super(args[0] as number)
    }
    static now(): number {
      return fakeMs
    }
  }
  globalThis.Date = FakeDate as DateConstructor
  return (realSeconds: number) => {
    fakeMs += realSeconds * 1000
  }
}

/**贪心策略参数 */
export interface GreedyOptions {
  /**层级重置:本次收益 ≥ 当前点数×该倍率 就重置 */
  resetMult: number
  /**层级重置:超过该秒数且收益至少抵得上当前点数时才重置(防止"没进展也重置"的抖动) */
  resetTime: number
  /**无限重置:收益达到该IP值才重置 */
  infinityGain: number
  /**挑战最长尝试时间(游戏秒),超时退出并暂时放弃 */
  challengeTimeout: number
  /**是否主动进挑战:进挑战会强制重置(无限挑战更是直接无限重置),从真实存档继续做实验时可关掉 */
  challenges: boolean
  /**解锁新层级的最低层级0点数:解锁会擦掉本层以下的所有进度,太早解锁等于把刚攒的势头扔掉(0=够条件就解锁) */
  unlockGate: number
  /**每步购买知识升级的级数(1更接近真人:攒够了才买一级) */
  buyPerStep: number
  /**
   * 维度购买顺序:asc=从维度1开始(缺省)。
   * 维度1生产点数/能量,最不该被饿着;游戏自带的"全部最大"是desc(从最高维度开始),会把预算全花在最高维度上
   */
  buyOrder: 'asc' | 'desc'
  /**每步最多用多少比例的知识换离线时间(需知识升级"时间感知";0=不换) */
  knowledgeToTime: number
  /**留给"加速"的离线时间储备(秒),超出的部分转成加速时间(需"时间存储") */
  boostReserve: number
}

/**贪心策略默认参数 */
export const GREEDY_DEFAULTS: GreedyOptions = {
  resetMult: 2,
  resetTime: 1800,
  infinityGain: 1,
  challengeTimeout: 600,
  challenges: true,
  //1e100是成就a28(Googol)的阈值,也是挑战页的解锁条件:先拿到挑战再解锁更高层级,否则会把势头擦掉
  unlockGate: 1e100,
  buyPerStep: 1,
  buyOrder: 'asc',
  knowledgeToTime: 0.1,
  boostReserve: 3600,
}

/**贪心策略的知识升级优先顺序:先提高知识收入,再买永久产出,最后QoL与时间类 */
const KNOWLEDGE_PRIORITY = [
  'command-checkin',
  'command-quiz',
  'quiz-accel',
  'quiz-difficulty',
  'boost-production',
  'knowledge-achievement',
  'bonus-achievement',
  'depth-points',
  'max-buy',
  'auto-batch',
  'auto-upgrade',
  'auto-global-config',
  'time-offline',
  'time-store',
  'time-boost',
  'time-pause',
  'time-tick',
  'time-overclock',
]

/**
 * 贪心策略:能买就买、够格就重置、挑战按顺序做
 * 不做任何"刻意操作"的成就(见测试与平衡.md的成就支线),得到的是自然推进的保守下界
 */
export function greedyPolicy(opts: GreedyOptions = GREEDY_DEFAULTS): BotPolicy {
  /**暂时放弃的挑战(超时未完成);解锁新层级后清空重试 */
  let giveUp = new Set<string>()
  let giveUpAtLayers = 0
  let challengeEnteredAt = new Decimal(0)
  let now = new Decimal(0)

  /**知识收入:签到与答题(都按现实时间,由假时钟推进);答题按"完美玩家"处理(直接给出正确答案) */
  function actKnowledgeIncome(): boolean {
    let acted = false
    if (hasKnowledge('command-checkin') && !checkedInToday() && doCheckin()) acted = true
    if (hasKnowledge('command-quiz') && quizAvailable()) {
      const q = getQuizQuestion()
      const answer =
        q.options != null && q.correctIndex != null ? q.correctIndex : (q.answer?.toString() ?? '')
      submitQuizAnswer(q, answer)
      acted = true
    }
    return acted
  }

  /**时间类动作:知识换离线时间、多余的离线时间存成加速时间、选一个"撑得住一分钟"的加速档位 */
  function actTime(): boolean {
    let acted = false
    if (opts.knowledgeToTime > 0 && hasKnowledge('time-offline') && player.knowledge.gt(0)) {
      if (buyOfflineTimePct(opts.knowledgeToTime).gt(0)) acted = true
    }
    if (hasKnowledge('time-store') && player.offlineTime.gt(opts.boostReserve)) {
      const extra = player.offlineTime.sub(opts.boostReserve)
      if (convertOfflineToWarp(extra).gt(0)) acted = true
    }
    //加速档位:只在能提高时设置;离线时间耗尽由applyTimeResources自动关闭(避免每步来回切)
    if (hasKnowledge('time-boost')) {
      const seconds = player.offlineTime.toNumber()
      const best = getBoostPresets()
        .filter((m) => m > 1 && (seconds >= 60 * (m - 1) || !isFinite(seconds)))
        .pop()
      if (best != undefined && best > player.boostSpeed.toNumber()) {
        player.boostSpeed = new Decimal(best)
        acted = true
      }
    }
    return acted
  }

  /**买知识升级:按优先级买第一个买得起的 */
  function actKnowledge(): boolean {
    for (const id of KNOWLEDGE_PRIORITY) {
      const def = getKnowledgeUpgrade(id)
      if (!def || !canBuyKnowledgeUpgrade(def)) continue
      if (knowledgeAmount(id).gte(def.maxAmount)) continue
      if (buyKnowledgeUpgrade(id, opts.buyPerStep).gt(0)) return true
    }
    return false
  }

  /**买无限升级:注册表顺序(同列有前置),买得起就买 */
  function actInfinityUpgrade(): boolean {
    for (const def of getInfinityUpgrades()) {
      if (!canBuyInfinityUpgrade(def.id)) continue
      buyInfinityUpgrade(def.id)
      return true
    }
    return false
  }

  /**挑战:优先把没做过的做完,其余反复刷第一个还能做的;超时就退出并暂时放弃 */
  function actChallenge(): boolean {
    const active = getAllChallenges().find((d) => isActive(d) && !isForcedActive(d))
    if (active) {
      if (challengeDone(active)) {
        exitChallenge(active)
        return true
      }
      if (now.sub(challengeEnteredAt).gte(opts.challengeTimeout)) {
        exitChallenge(active)
        giveUp.add(active.id)
        return true
      }
      return false
    }
    if (!opts.challenges) return false
    const candidates = getAllChallenges().filter((d) => isUnlocked(d) && !giveUp.has(d.id))
    const target = candidates.find((d) => completions(d).lt(1)) ?? candidates[0]
    if (!target) return false
    enterChallenge(target)
    challengeEnteredAt = now
    return true
  }

  /**解锁新层级:临时层满足解锁条件时把它重置出来(与手动点击临时层等价) */
  function actUnlockLayer(): boolean {
    //第一个层级(层级1)不设门槛:它是前期唯一的推进手段;解锁更高层级会擦掉已发展的层,故要等势头够大
    if (getOrderedLayers('asc').length > 1 && getPoints([0]).lt(opts.unlockGate)) return false
    const temp = findUnlockableTempLayer()
    if (!temp) return false
    const unlocked = doReset(temp)
    //与app/uiActions一致:解锁后把视角切到新层级
    if (unlocked) player.layerSubtab = unlocked
    return unlocked != undefined
  }

  /**重置:从最高层往下,够格就晋升;都不够格时看无限重置 */
  function actReset(): boolean {
    for (const e of getOrderedLayers('desc')) {
      if (isLayer0(e.pos)) continue
      if (!e.L.active || !canReset(e.pos)) continue
      const gain = resetGain(e.pos)
      //够本才重置:本次收益至少是"历史最佳收益"的resetMult倍(所以间隔会自然拉长,收益指数增长);
      //长时间没进展时放宽到"略优于历史最佳"。
      //用bestPoints而不是当前点数:买维度会把点数花到0,拿当前点数当基准会导致每步都"够本"→ 无限抖动
      const enough = gain.gte(e.L.bestPoints.mul(opts.resetMult))
      const stalled = e.L.resetTime.gte(opts.resetTime) && gain.gte(e.L.bestPoints)
      if (gain.gt(0) && (e.L.bestPoints.eq(0) || enough || stalled)) {
        doReset(e.pos)
        return true
      }
    }
    if (canInfinityReset() && infinityGain().gte(opts.infinityGain)) {
      doInfinityReset()
      return true
    }
    return false
  }

  /**购买:每层先买能买的升级,再按buyOrder买满各维度,最后买可购买 */
  function actBuy(): boolean {
    let acted = false
    for (const e of getOrderedLayers('desc')) {
      if (!e.L.active) continue
      const order = getLayerOrder(e.pos)
      for (const u of getUpgrades(order)) {
        if (!canBuyUpgrade(e.pos, u.id)) continue
        buyUpgrade(e.pos, u.id)
        acted = true
      }
      const n = e.L.dimensions.length
      for (let i = 0; i < n; i++) {
        const id = opts.buyOrder == 'asc' ? i : n - 1 - i
        if (buyDimensionMax(e.pos, id).gt(0)) acted = true
      }
      for (const b of getBuyables(order)) {
        if (!isBuyableUnlocked(e.pos, b.id)) continue
        if (buyBuyableMax(e.pos, b.id).gt(0)) acted = true
      }
    }
    return acted
  }

  return {
    name: 'greedy',
    setTime(t) {
      now = t
    },
    act() {
      //解锁了新层级说明变强了:放弃过的挑战重新试
      const layers = getOrderedLayers('asc').length
      if (layers > giveUpAtLayers) {
        giveUpAtLayers = layers
        giveUp = new Set()
      }
      let acted = false
      const actions = [
        actKnowledgeIncome,
        actTime,
        actKnowledge,
        actInfinityUpgrade,
        actChallenge,
        actUnlockLayer,
        actReset,
        actBuy,
      ]
      for (const f of actions) {
        if (f()) acted = true
      }
      return acted
    },
  }
}

/**一行指标快照(终局判定的取样对象,口径见测试与平衡.md) */
export interface SimRow {
  /**游戏时间(秒) */
  t: Decimal
  /**层级0点数 */
  points0: Decimal
  /**世界层级数 */
  layerCount: number
  /**最高层级名 */
  highest: string
  /**无限点数 */
  ip: Decimal
  /**无限重置次数 */
  infinityResets: Decimal
  /**已购无限升级数 */
  infinityUpgrades: number
  /**知识余额 */
  knowledge: Decimal
  /**知识升级总等级 */
  knowledgeLevels: Decimal
  /**挑战完成总次数 */
  challengeCompletions: Decimal
  /**已解锁普通成就数 */
  achievements: number
  /**层级结构丰富度:各层维度数+已购可购买种类+已购升级数之和 */
  structure: number
  /**该时刻的各层级状态(仅--verbose时收集;必须在取样当时抓,不能跑完再读) */
  layers?: string[]
}

/**取一次指标快照(时间用本次模拟的已过游戏时间,故载入旧存档也不会影响时间轴) */
export function snapshot(elapsed: Decimal, verbose: boolean = false): SimRow {
  const layers = getOrderedLayers('asc')
  let structure = 0
  for (const e of layers) {
    structure += e.L.dimensions.length + Object.keys(e.L.buyables).length + e.L.upgrades.length
  }
  let levels = new Decimal(0)
  for (const v of Object.values(player.knowledgeUpgrades)) levels = levels.add(v)
  //最高层取"最后一个真实层级":getHighestActiveLayer可能返回临时层(下一层的预览),不适合进指标表
  const highest = layers[layers.length - 1]
  return {
    t: elapsed,
    points0: getPoints([0]),
    layerCount: layers.length,
    highest: highest ? getLayerName(highest.pos) : '-',
    ip: player.infinityPoints,
    infinityResets: player.infinityResets,
    infinityUpgrades: player.infinityUpgrades.length,
    knowledge: player.knowledge,
    knowledgeLevels: levels,
    challengeCompletions: totalChallengeCompletions(),
    achievements: player.achievements.length,
    structure,
    layers: verbose ? layerLines() : undefined,
  }
}

/**
 * 各层级状态的多行文本(诊断用:看清机器人把资源花在哪一层、临时层何时可解锁)
 * 只在--verbose下打印,不进指标表
 */
export function layerLines(): string[] {
  const out: string[] = []
  for (const e of getOrderedLayers('asc')) {
    const dims = e.L.dimensions.map((d) => format(d[1])).join(',')
    out.push(
      `    层${e.key} 点数=${format(e.L.points)} 能量=${format(e.L.energy)}` +
        ` 重置次数=${formatWhole(e.L.resetCount)} 计时=${formatTime(e.L.resetTime)}` +
        ` 可重置=${canReset(e.pos)} 收益=${format(resetGain(e.pos))} 维度=[${dims}]`,
    )
  }
  for (const e of getOrderedTempLayers()) {
    out.push(`    临时层${e.key} 可解锁=${canReset(e.pos)} 收益=${format(resetGain(e.pos))}`)
  }
  return out
}

/**一次模拟的配置 */
export interface SimOptions {
  /**模拟的游戏时间上限(秒) */
  seconds: number
  /**基础步长(秒):有动作时用它 */
  dt: number
  /**无动作时的步长上限(秒);等于dt即固定步长 */
  maxDt: number
  /**每多少游戏秒取一次快照 */
  every: number
  /**机器人策略(缺省挂机) */
  policy?: BotPolicy
  /**是否无视真实存档、从空白档开始 */
  fresh?: boolean
  /**是否在每行指标快照后附上各层级状态(诊断用) */
  verbose?: boolean
  /**进度事件回调(解锁层级/无限重置/挑战完成) */
  onEvent?: (text: string) => void
}

/**模拟结果 */
export interface SimResult {
  rows: SimRow[]
  /**实际跑了多少步 */
  frames: number
  /**现实耗时(毫秒) */
  realMs: number
}

/**
 * 无头模拟:载入起点存档 → 循环"gameLoop + 机器人决策" → 定期取快照
 * 时间轴是"本次模拟已经过的游戏时间"(player.totalTime的增量,已被每秒速度放大),
 * 所以载入一个玩了13天的真实存档也能只跑"接下来的N分钟"
 */
export function runSim(opts: SimOptions): SimResult {
  //假时钟:签到/答题冷却/日志时间都按"现实时间"走,而模拟里现实时间就是本次跑过的秒数
  const advanceClock = installFakeClock()
  if (opts.fresh) {
    freshSave()
    console.log('  从空白档开始(fresh)')
  } else {
    loadRealSave()
  }
  const policy = opts.policy ?? nonePolicy()
  const maxDt = Math.max(opts.dt, opts.maxDt)
  const seconds = new Decimal(opts.seconds)
  const start = player.totalTime
  /**本次模拟已过的游戏时间 */
  const elapsed = () => player.totalTime.sub(start)
  const rows: SimRow[] = [snapshot(new Decimal(0), opts.verbose)]
  const startedMs = performance.now()
  let dt = opts.dt
  let frames = 0
  let nextRow = opts.every
  let layerCount = rows[0]!.layerCount
  let resets = player.infinityResets.toString()
  let prevCompletions = totalChallengeCompletions().toString()
  while (elapsed().lt(seconds)) {
    //与mainLoop一致:现实时间累加 → 加速/时间扭曲作用到dt上 → gameLoop(帧内再乘每秒速度)
    addValue('realTime', new Decimal(dt))
    const warped = applyTimeResources(new Decimal(dt))
    gameLoop(warped)
    advanceClock(dt)
    frames++
    policy.setTime?.(elapsed())
    const acted = policy.act()
    dt = acted ? opts.dt : Math.min(maxDt, dt * 2)
    //进度事件:层级/无限重置/挑战完成各报一行,便于看清"卡在哪一步"
    const t = elapsed().toFixed(1)
    const nowLayers = getOrderedLayers('asc').length
    if (nowLayers != layerCount) {
      layerCount = nowLayers
      const high = getHighestActiveLayer()
      opts.onEvent?.(`[层级] t=${t}s 层级数=${nowLayers} 最高层=${high ? getLayerName(high) : '-'}`)
    }
    const nowResets = player.infinityResets.toString()
    if (nowResets != resets) {
      resets = nowResets
      opts.onEvent?.(`[无限] t=${t}s 第${player.infinityResets}次 IP=${player.infinityPoints}`)
    }
    const nowCompletions = totalChallengeCompletions().toString()
    if (nowCompletions != prevCompletions) {
      prevCompletions = nowCompletions
      opts.onEvent?.(`[挑战] t=${t}s 总完成次数=${nowCompletions}`)
    }
    if (elapsed().gte(nextRow)) {
      nextRow += opts.every
      rows.push(snapshot(elapsed(), opts.verbose))
    }
  }
  rows.push(snapshot(elapsed(), opts.verbose))
  return { rows, frames, realMs: performance.now() - startedMs }
}
