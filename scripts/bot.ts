//模拟玩家(机器人)与无头模拟引擎
//契约:机器人只调用"按钮背后那层"的logic函数(与UI同源,见app/uiActions),不用调试指令、不直接改player状态
//引擎复用app/core的gameLoop,保证帧内顺序与真实游玩完全一致;自适应步长:有动作时用基础步长,无动作时逐级放大
//策略与口径见 docs/面向开发者/测试与平衡.md;sim.ts与endgame.ts都只是CLI外壳
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import {
  getHighestActiveLayer,
  getLayerName,
  getOrderedLayers,
  getPoints,
  totalChallengeCompletions,
} from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { canBuyUpgrade, getUpgrades } from '@/compute/upgrades'
import { canReset, resetGain } from '@/compute/prestige'
import {
  canBuyInfinityUpgrade,
  canInfinityReset,
  getInfinityUpgrades,
  infinityGain,
} from '@/compute/infinity'
import { canBuyKnowledgeUpgrade, getKnowledgeUpgrade, knowledgeAmount } from '@/compute/knowledge'
import { buyUpgrade, maxBuyAll } from '@/logic/purchase'
import { doReset, findUnlockableTempLayer } from '@/logic/reset'
import { buyInfinityUpgrade, doInfinityReset } from '@/logic/infinity'
import { buyKnowledgeUpgrade } from '@/logic/knowledge'
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
import { gameLoop } from '@/app/core'
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
  /**每步购买知识升级的级数(1更接近真人:攒够了才买一级) */
  buyPerStep: number
}

/**贪心策略默认参数 */
export const GREEDY_DEFAULTS: GreedyOptions = {
  resetMult: 2,
  resetTime: 1800,
  infinityGain: 1,
  challengeTimeout: 600,
  challenges: true,
  buyPerStep: 1,
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
      //够本才重置:收益至少是当前点数的resetMult倍;长时间没进展时放宽到"收益≥当前点数"。
      //绝不在收益更小时重置:那只会把下层进度与本层能量反复清零,峰值永远不涨(抖动)
      const enough = gain.gte(e.L.points.mul(opts.resetMult))
      const stalled = e.L.resetTime.gte(opts.resetTime) && gain.gte(e.L.points)
      if ((gain.gt(0) && (e.L.points.eq(0) || enough)) || stalled) {
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

  /**购买:每层先买能买的升级(买最大会把点数花光,故升级优先),再一键买满维度与可购买 */
  function actBuy(): boolean {
    let acted = false
    for (const e of getOrderedLayers('desc')) {
      if (!e.L.active) continue
      for (const u of getUpgrades(getLayerOrder(e.pos))) {
        if (!canBuyUpgrade(e.pos, u.id)) continue
        buyUpgrade(e.pos, u.id)
        acted = true
      }
      const before = e.L.points
      maxBuyAll(e.pos)
      if (!e.L.points.eq(before)) acted = true
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
}

/**取一次指标快照(时间用本次模拟的已过游戏时间,故载入旧存档也不会影响时间轴) */
export function snapshot(elapsed: Decimal): SimRow {
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
  }
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
  const rows: SimRow[] = [snapshot(new Decimal(0))]
  const started = Date.now()
  let dt = opts.dt
  let frames = 0
  let nextRow = opts.every
  let layerCount = rows[0]!.layerCount
  let resets = player.infinityResets.toString()
  let prevCompletions = totalChallengeCompletions().toString()
  while (elapsed().lt(seconds)) {
    gameLoop(new Decimal(dt))
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
      rows.push(snapshot(elapsed()))
    }
  }
  rows.push(snapshot(elapsed()))
  return { rows, frames, realMs: Date.now() - started }
}
