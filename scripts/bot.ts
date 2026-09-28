//模拟玩家(机器人)与无头模拟引擎
//契约:机器人只调用"按钮背后那层"的logic函数(与UI同源,见app/uiActions),不用调试指令、不直接改player状态
//引擎复用app/core的gameLoop与applyTimeResources,保证帧内顺序与时间规则都和真实游玩一致
//自适应步长:有动作时用基础步长,无动作时逐级放大;假时钟让"现实时间"随模拟时间流逝(签到/答题冷却都按它走)
//策略与口径见 docs/面向开发者/测试与平衡.md
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import type { LayerId } from '@/data/types'
import { addValue } from '@/save/save'
import {
  dimensionAmount,
  getEnergy,
  getHighestActiveLayer,
  getLayer,
  getLayerName,
  getOrderedLayers,
  getOrderedTempLayers,
  getPoints,
  hasAchievement,
  normalChallengeCompletions,
} from '@/access'
import { format, formatTime, formatWhole } from '@/tools/format'
import { compareLayer, getLayerOrder, isLayer0 } from '@/tools/ordinal'
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
  getPsdSpeed,
  hasKnowledge,
  knowledgeAmount,
} from '@/compute/knowledge'
import {
  buyBuyable,
  buyBuyableMax,
  buyDimension,
  buyDimensionMax,
  buyUpgrade,
} from '@/logic/purchase'
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
  challengeGoal,
  challengeGoalLayer,
  challengeResetTarget,
  challengeResource,
  completions,
  enterChallenge,
  exitChallenge,
  getAllChallenges,
  isActive,
  isForcedActive,
  isInfinityChallenge,
  isUnlocked,
} from '@/logic/challenges'
import { applyTimeResources, gameLoop } from '@/app/core'
import { freshSave, loadRealSave } from './helpers'

/**机器人策略:每步调用一次act;返回true表示这一步做了动作(自适应步长据此保持小步长) */
export interface BotPolicy {
  name: string
  /**引擎每步更新当前游戏时间(秒),供策略里的超时判定使用 */
  setTime?(t: Decimal): void
  /**
   * 本步要求的基础步长(秒,现实时间;返回undefined表示用引擎缺省值)
   * 用于抓"1游戏秒内"这类窗口:窗口内必须把步长压到远小于1秒,否则永远抓不到
   */
  stepDt?(): number | undefined
  /**当前阶段名(仅用于指标表诊断) */
  phase?(): string
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
  /**
   * 层级重置:超过该秒数且收益至少抵得上历史最佳时也重置一次(防止"没进展也干等")
   * 缺省Infinity=从不按停滞放宽,只按resetMult判。实测这条放宽会严重拖慢推进:
   * 它的条件"收益≥历史最佳"在每次重置后都几乎立刻成立(历史最佳只是上一次的收益),
   * 于是退化成"一超过上次就重置",层0峰值被反复削平(1小时峰值 e55 → 去掉后 e66);
   * 真正的"卡死"交给终局判定的停滞检测(见测试与平衡.md §5.3),不在这里兜
   */
  resetTime: number
  /**无限重置:收益达到该IP值才重置 */
  infinityGain: number
  /**挑战最长尝试时间(游戏秒,硬上限) */
  challengeTimeout: number
  /**
   * 挑战内"停滞"判据:目标资源在这么多秒内没有涨到 1.5 倍就放弃
   * (固定时限常在"再攒一轮就完成"时退出:实测 c1 里层级1点数 30 分钟涨到 3e3,目标 1e5)
   */
  challengeStallTime: number
  /**挑战超时后多久可以再试(游戏秒);0=不再试。变强了才值得重试,故不是"一失败就永久放弃" */
  challengeRetry: number
  /**
   * 进挑战前要求"挑战外的目标资源峰值 ≥ 目标×该倍数":
   * 进/退挑战都会强制重置目标层(连带清空下层),没把握就进去只会白扔一轮
   */
  challengeReady: number
  /**
   * 进挑战前要求"目标层已经买出维度N"(0基编号,缺省2=维度3):
   * 挑战的强制重置**不动目标层自身**,目标层的维度链(维度3→2→1→能量)会留下来,
   * 靠它才把下层重新拉起来(人工经验:层级2攒约100点数买出维度3就能打 c1)
   */
  challengePrepareDim: number
  /**
   * 进普通挑战前还要求"目标资源层的能量 ≥ 该值"(缺省 1e16=a27 的门槛):
   * 人工经验:手打进 c1 时层级1能量已略高于 1e16,能量不够时进去只是白扔一轮
   */
  challengePrepareEnergy: number
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
  /**
   * 每次买几个:
   * one=每个维度/可购买只买1个;max=按预算买最大(游戏里"购买模式:买最大");
   * fill=先把每个维度都买出1个(维链必须先接上:维度2喂维度1、维度3喂维度2…),买齐后按buyOrder买最大。
   * 注意asc+max会把预算全砸在维度1上,新解锁的层级会永远买不出维度2/3
   */
  buyAmount: 'one' | 'max' | 'fill'
  /**每步最多用多少比例的知识换离线时间(需知识升级"时间感知";0=不换) */
  knowledgeToTime: number
  /**留给"加速"的离线时间储备(秒),超出的部分转成加速时间(需"时间存储") */
  boostReserve: number
}

/**贪心策略默认参数 */
export const GREEDY_DEFAULTS: GreedyOptions = {
  resetMult: 2,
  resetTime: Infinity,
  infinityGain: 1,
  challengeTimeout: 7200,
  challengeStallTime: 900,
  challengeRetry: 1800,
  challengeReady: 10,
  challengePrepareDim: 2,
  challengePrepareEnergy: 1e16,
  challenges: true,
  //1e100是成就a28(Googol)的阈值,也是挑战页的解锁条件:先拿到挑战再解锁更高层级,否则会把势头擦掉
  unlockGate: 1e100,
  buyPerStep: 1,
  buyOrder: 'asc',
  buyAmount: 'max',
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

/**机器人动作的钩子:阶段式策略用它们在"何时解锁/何时重置/买哪些维度"上覆盖贪心规则 */
interface ActionHooks {
  /**当前游戏时间(秒);阶段式策略自己维护时间轴,故由它注入 */
  now?(): Decimal
  /**解锁新层级所需的层级0点数门槛(覆盖GreedyOptions.unlockGate) */
  unlockGate?(): number
  /**解锁新层级前的额外收益要求(≤1=不额外要求);只对开局的第一次解锁有意义 */
  unlockGain?(): number
  /**层级1重置必须达到的最低收益(0=按普通重置规则);spamLayer1为真时忽略 */
  layer1Gain?(): number
  /**层级1本阶段允许购买的维度数(只允许买id<该值);缺省不限 */
  layer1BuyLimit?(): number
  /**紧急重置层级1:只看canReset、不看收益(抓a24的"1游戏秒内再重置一次"窗口) */
  spamLayer1?(): boolean
  /**本步每次买几个(覆盖GreedyOptions.buyAmount) */
  buyAmount?(): 'one' | 'max' | 'fill'
  /**发生了一次真实层级重置 */
  onReset?(layer: LayerId, gain: Decimal): void
  /**解锁了一个新层级 */
  onUnlock?(pos: LayerId, gain: Decimal): void
}

/**
 * 构造一套贪心动作(全部只调用"按钮背后那层"的logic函数,不用调试指令、不直接改player状态)
 * 贪婪策略与阶段式策略共用同一套动作,区别只在ActionHooks给出的"何时解锁/何时重置"
 */
function makeActions(opts: GreedyOptions, hooks: ActionHooks = {}) {
  /**超时的挑战→可以再试的时间(到点后重新尝试:变强了才值得重试,不是一失败就永久放弃) */
  const giveUp = new Map<string, Decimal>()
  /**各挑战"挑战外"的目标资源峰值(判断这次进去有没有把握) */
  const goalPeak = new Map<string, Decimal>()
  let giveUpAtLayers = 0
  let challengeEnteredAt = new Decimal(0)
  /**本次挑战里目标资源的最好值与其时间(推进式超时用) */
  let challengeBest: Decimal | undefined
  let challengeBestAt = new Decimal(0)
  let now = new Decimal(0)
  /**当前时间:阶段式策略注入自己的时间轴,贪心策略用setTime喂进来的时间 */
  const time = () => hooks.now?.() ?? now

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

  /**
   * 挑战:只挑"以前轻松达到过目标"的挑战(进出挑战都会把目标层连带下层全部清空),
   * 进去后达到目标就退出结算(允许批量时一次结算多次);超时就退出,冷却一段时间再试
   */
  function actChallenge(): boolean {
    const active = getAllChallenges().find((d) => isActive(d) && !isForcedActive(d))
    if (active) {
      if (challengeDone(active)) {
        exitChallenge(active)
        return true
      }
      //推进式超时:目标资源还在涨就别退出;只有"停滞"或超过硬上限才放弃
      const cur = challengeResource(active)
      if (challengeBest == undefined || cur.gte(challengeBest.mul(1.5))) {
        challengeBest = cur
        challengeBestAt = time()
      }
      const stalled = time().sub(challengeBestAt).gte(opts.challengeStallTime)
      const overCap = time().sub(challengeEnteredAt).gte(opts.challengeTimeout)
      if (stalled || overCap) {
        exitChallenge(active)
        giveUp.set(active.id, time().add(opts.challengeRetry))
        return true
      }
      return false
    }
    if (!opts.challenges) return false
    //无限挑战(需iu15)整局无限重置,没有"目标层"可准备,只按目标资源峰值判;普通挑战要先备好目标层的维度3
    const unlocked = getAllChallenges().filter((d) => isUnlocked(d))
    //在挑战外取样各挑战的目标资源峰值:只有"以前轻松达到过目标"才值得进去
    for (const d of unlocked) {
      const peak = goalPeak.get(d.id)
      const cur = challengeResource(d)
      if (peak == undefined || cur.gt(peak)) goalPeak.set(d.id, cur)
    }
    const candidates = unlocked.filter((d) => {
      if (giveUp.get(d.id)?.gt(time()) ?? false) return false
      if (!isInfinityChallenge(d)) {
        //进挑战会把目标层以下的升级全部清掉,但**不动目标层自身**:目标层的维度链会留下来,
        //所以要先把目标层的维度3(约100点数)买出来,靠它的能量链把下层重新拉起来
        const target = challengeResetTarget(d)
        if (target == undefined || dimensionAmount(target, opts.challengePrepareDim).lte(0))
          return false
        //能量门槛:人工手打进 c1 时层级1能量已略高于 a27 的 1e16(能量不够进去只是白扔一轮)
        const goalLayer = challengeGoalLayer(d)
        if (
          opts.challengePrepareEnergy > 0 &&
          goalLayer != undefined &&
          getEnergy(goalLayer).lt(opts.challengePrepareEnergy)
        )
          return false
      }
      const peak = goalPeak.get(d.id)
      return peak != undefined && peak.gte(challengeGoal(d).mul(opts.challengeReady))
    })
    const target = candidates.find((d) => completions(d).lt(1)) ?? candidates[0]
    if (!target) return false
    enterChallenge(target)
    challengeEnteredAt = time()
    challengeBest = undefined
    return true
  }

  /**解锁新层级:临时层满足解锁条件时把它重置出来(与手动点击临时层等价) */
  function actUnlockLayer(): boolean {
    //层级0点数门槛:第一个层级(层级1)不设门槛(它是前期唯一的推进手段),更高层级缺省要等unlockGate
    const layerCount = getOrderedLayers('asc').length
    const gate = hooks.unlockGate?.() ?? (layerCount > 1 ? opts.unlockGate : 0)
    if (getPoints([0]).lt(gate)) return false
    const temp = findUnlockableTempLayer()
    if (!temp) return false
    const gain = resetGain(temp)
    //收益门槛(开局:层级1的解锁本身就是第一次重置;阶段式:层级2+要求a24与nextLayerGain)
    const need = hooks.unlockGain?.() ?? 0
    if (need > 0 && gain.lt(need)) return false
    const unlocked = doReset(temp)
    //与app/uiActions一致:解锁后把视角切到新层级
    if (unlocked) {
      player.layerSubtab = unlocked
      hooks.onUnlock?.(unlocked, gain)
    }
    return unlocked != undefined
  }

  /**执行一次层级重置(并把"重置了哪层、拿了多少收益"报给钩子) */
  function resetLayer(layer: LayerId, gain: Decimal): void {
    doReset(layer)
    hooks.onReset?.(layer, gain)
  }

  /**重置:从最高层往下,够格就晋升;都不够格时看无限重置 */
  function actReset(): boolean {
    const spam = hooks.spamLayer1?.() ?? false
    const openGain = hooks.layer1Gain?.() ?? 0
    for (const e of getOrderedLayers('desc')) {
      if (isLayer0(e.pos)) continue
      if (!e.L.active || !canReset(e.pos)) continue
      const gain = resetGain(e.pos)
      //开局:层级1的重置要攒到要求的收益;spam(抓a24窗口)只要求canReset
      if (compareLayer(e.pos, [1]) == 0 && (spam || openGain > 0)) {
        if (spam || gain.gte(openGain)) {
          resetLayer(e.pos, gain)
          return true
        }
        continue
      }
      //够本才重置:本次收益至少是"历史最佳收益"的resetMult倍(所以间隔会自然拉长,收益指数增长);
      //长时间没进展时放宽到"略优于历史最佳"。
      //用bestPoints而不是当前点数:买维度会把点数花到0,拿当前点数当基准会导致每步都"够本"→ 无限抖动
      const enough = gain.gte(e.L.bestPoints.mul(opts.resetMult))
      const stalled = e.L.resetTime.gte(opts.resetTime) && gain.gte(e.L.bestPoints)
      if (gain.gt(0) && (e.L.bestPoints.eq(0) || enough || stalled)) {
        resetLayer(e.pos, gain)
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
    const layer1Limit = hooks.layer1BuyLimit?.() ?? Infinity
    const amount = hooks.buyAmount?.() ?? opts.buyAmount
    for (const e of getOrderedLayers('desc')) {
      if (!e.L.active) continue
      const order = getLayerOrder(e.pos)
      for (const u of getUpgrades(order)) {
        if (!canBuyUpgrade(e.pos, u.id)) continue
        buyUpgrade(e.pos, u.id)
        acted = true
      }
      //开局只允许买"计划里那一个"维度(先维度1、第一次重置后再买维度2),其余留给正常推进阶段
      const limit = compareLayer(e.pos, [1]) == 0 ? layer1Limit : Infinity
      const n = e.L.dimensions.length
      //fill:本层还有维度没买出来时只每个买1个(把维链接上),买齐后才按buyOrder买最大
      const fill =
        amount == 'fill' &&
        e.L.dimensions.some((_d, i) => i < limit && dimensionAmount(e.pos, i, 1).lte(0))
      for (let i = 0; i < n; i++) {
        const id = opts.buyOrder == 'asc' ? i : n - 1 - i
        if (id >= limit) continue
        const one = amount == 'one' || fill
        const spent = one ? buyDimension(e.pos, id, 1) : buyDimensionMax(e.pos, id)
        if (spent.gt(0)) acted = true
      }
      for (const b of getBuyables(order)) {
        if (!isBuyableUnlocked(e.pos, b.id)) continue
        const spent = amount == 'one' ? buyBuyable(e.pos, b.id, 1) : buyBuyableMax(e.pos, b.id)
        if (spent.gt(0)) acted = true
      }
    }
    return acted
  }

  /**按固定顺序跑一轮动作(解锁了新层级说明变强了:超时过的挑战立刻重新试) */
  function run(): boolean {
    const layers = getOrderedLayers('asc').length
    if (layers > giveUpAtLayers) {
      giveUpAtLayers = layers
      giveUp.clear()
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
  }

  return {
    run,
    setTime(t: Decimal) {
      now = t
    },
  }
}

/**
 * 贪心策略:能买就买、够格就重置、挑战按顺序做
 * 不做任何"刻意操作"的成就(见测试与平衡.md的成就支线),得到的是自然推进的保守下界
 */
export function greedyPolicy(opts: GreedyOptions = GREEDY_DEFAULTS): BotPolicy {
  const bot = makeActions(opts)
  return {
    name: 'greedy',
    setTime: (t) => bot.setTime(t),
    act: () => bot.run(),
  }
}

/**阶段式策略参数(在贪心参数之上加"开局打法"与a24支线) */
export interface PhasedOptions extends GreedyOptions {
  /**
   * 开局打法(只影响层级1的前两次重置):
   * invest=人工打法:层级1一够条件就解锁(人工约 2 分钟),之后的**前两次层级1重置**攒到openGain才做,
   *        且第1次重置后只买维度1、第2次重置后才买维度2
   * fast=解锁后一够条件(收益≥1)就重置层级1(多次快速重置)
   */
  opening: 'invest' | 'fast'
  /**invest打法下前两次层级1重置要求的最低收益(点数);11=维度1(1点)+维度2(10点)的总价 */
  openGain: number
  /**
   * 解锁层级2及以上要求的临时层收益(点数):临时层收益=(下层点数/1e4)^0.25,
   * 故1点=下层1e4点数(作者路线:"有a24+1e4层级1点数就可以重置了"),可以等更大的收益再重置
   */
  nextLayerGain: number
  /**是否做a24支线(层级1重置后开1秒窗口,用小步长抓"1游戏秒内再重置一次") */
  huntA24: boolean
  /**
   * 是否做a27支线("我需要能量吗":层级1能量为0时一次重置拿到≥100点)
   * 做法:在a27到手前完全不买层级1的维度(层级1能量只由维度1产出,不买就恒为0),
   * 代价是拿不到层级1的能量加成,推进明显变慢;属于刻意操作,默认关闭
   */
  deliberateA27: boolean
  /**
   * 是否做a35支线("我需要重置吗":第1次层级1重置拿到≥1e4点)
   * 做法:层级2解锁后,层级1的resetCount被层级2的重置清零,此时把层级1的重置门槛抬到1e4,
   * 保证"层级1的下一次重置"就满足条件;默认关闭(会推迟重置节奏)
   */
  deliberateA35: boolean
  /**a24窗口长度(游戏秒):成就要求层级0的resetTime<1秒,故窗口就是1秒 */
  a24Window: number
  /**a24窗口内使用的基础步长(游戏秒;必须远小于1,否则永远抓不到窗口) */
  huntDt: number
  /**诊断输出:每次层级1解锁/重置各报一行收益与节奏,便于对齐人工打法 */
  onNote?: (text: string) => void
}

/**阶段式策略默认参数 */
export const PHASED_DEFAULTS: PhasedOptions = {
  ...GREEDY_DEFAULTS,
  opening: 'invest',
  openGain: 11,
  buyAmount: 'fill',
  challengePrepareDim: 2,
  nextLayerGain: 1,
  huntA24: true,
  deliberateA27: false,
  deliberateA35: false,
  a24Window: 1,
  huntDt: 1 / 60,
}

/**
 * 阶段式策略:把人工开局写成状态机,在贪心动作之上加阶段性门槛与成就支线
 * 阶段:layer0(层级1之前) → layer1Open(前两次层级1重置) → progress(正常推进)
 * - 开局按opening选择"人工打法"或"多次快速重置",两者可直接对比(见测试与平衡.md)
 * - a24(速通高手)必做:没有它,层级2重置会把层级1点数清零,层级2能量就永远给不上加成。
 *   它的条件是"层级1重置时层级0的resetTime<1秒",即层级1重置后层级0能在1游戏秒内重建到1e16,
 *   故每次层级1重置后开一个1秒的小步长窗口,窗口内只看canReset就重置,把这个窗口抓成成就
 */
export function phasedPolicy(opts: PhasedOptions = PHASED_DEFAULTS): BotPolicy {
  const invest = opts.opening == 'invest'
  const openGain = invest ? Math.max(1, opts.openGain) : 1
  let phase: 'layer0' | 'layer1Open' | 'progress' = 'layer0'
  /**层级1已经历的重置次数(解锁层级1算第一次) */
  let layer1Resets = 0
  /**上一次层级1重置的时间:相邻两次的间隔就是"层级0重建到可重置"的耗时(a24要求<1秒) */
  let lastResetAt: Decimal | undefined
  /**a24小步长窗口的结束时间 */
  let huntUntil = new Decimal(-1)
  let a24Done = false
  let now = new Decimal(0)
  /**是否正在抓a24的1秒窗口 */
  const hunting = () => opts.huntA24 && !a24Done && now.lt(huntUntil)

  /**报一行层级1的重置节奏(收益/间隔/能量一起给,便于和人工开局对照) */
  function noteLayer1(tag: string, gain: Decimal): void {
    const gap = lastResetAt ? now.sub(lastResetAt) : undefined
    opts.onNote?.(
      `${phase == 'layer1Open' ? '[开局]' : '[层级1]'} t=${formatTime(now)} ${tag} 收益=${format(gain)}` +
        (gap ? ` 距上次=${formatTime(gap)}` : '') +
        ` 层级1点数=${format(getPoints([1]))} 能量=${format(getEnergy([1]))}`,
    )
    lastResetAt = now
  }

  const bot = makeActions(opts, {
    now: () => now,
    //解锁层级2及以上不看层级0点数,只看"a24到手 + 临时层收益够"(见unlockGain)
    unlockGate: () => 0,
    //层级1一够条件就解锁(人工约2分钟);层级2及以上:a24必做,再要求临时层收益≥nextLayerGain
    unlockGain: () => {
      if (phase == 'layer0') return 1
      return hasAchievement('a24') ? opts.nextLayerGain : Infinity
    },
    //开局:第二次层级1重置同样攒到要求的收益
    layer1Gain: () => {
      if (phase == 'layer1Open') return openGain
      //a35支线:层级2重置会把层级1的resetCount清零,故"层级1的第1次重置≥1e4点"要等层级2之后再抓
      const L1 = getLayer([1])
      const afterLayer2 = getOrderedLayers('asc').length > 2
      if (opts.deliberateA35 && !hasAchievement('a35') && afterLayer2 && L1?.resetCount.eq(0))
        return 1e4
      return 0
    },
    //开局:先买维度1(1点)、第一次重置后再买维度2(10点),其余维度留到正常推进阶段
    //a27支线:到手前完全不买层级1的维度(层级1能量恒为0)
    layer1BuyLimit: () => {
      if (opts.deliberateA27 && !hasAchievement('a27')) return 0
      return phase == 'layer1Open' ? layer1Resets + 1 : Infinity
    },
    //开局按"买1个"来(等于人工点击:先维度1、再维度2);之后缺省用fill(先把每个维度买出1个再接买最大)
    buyAmount: () => (phase == 'layer1Open' ? 'one' : opts.buyAmount),
    spamLayer1: () => hunting(),
    onUnlock(pos, gain) {
      if (compareLayer(pos, [1]) != 0) return
      //解锁层级1本身不计入"前两次重置"(人工是先花2分钟解锁,再攒11点做前两次重置)
      layer1Resets = 0
      phase = 'layer1Open'
      noteLayer1('解锁层级1', gain)
      huntUntil = now.add(opts.a24Window)
    },
    onReset(layer, gain) {
      if (compareLayer(layer, [1]) != 0) return
      layer1Resets++
      noteLayer1(`第${layer1Resets}次层级1重置`, gain)
      if (layer1Resets >= 2) phase = 'progress'
      huntUntil = now.add(opts.a24Window)
    },
  })

  return {
    name: `phased/${opts.opening}`,
    phase: () => phase,
    setTime(t) {
      now = t
      bot.setTime(t)
    },
    /**
     * 抓a24窗口时把步长压到huntDt(游戏秒):psdSpeed已含加速倍率,故换算成现实步长
     * 注:时间扭曲(每帧加1%加速时间)不在此换算内,扭曲激活时窗口会被冲掉——与真实游玩一致
     */
    stepDt() {
      if (!hunting()) return undefined
      const speed = getPsdSpeed().toNumber()
      return opts.huntDt / Math.max(1, isFinite(speed) ? speed : 1)
    },
    act() {
      const acted = bot.run()
      if (!a24Done && hasAchievement('a24')) {
        a24Done = true
        opts.onNote?.(`[支线] t=${formatTime(now)} 拿到a24(速通高手):层级0的resetTime<1秒`)
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
  /**
   * 本取样区间内的层级0点数峰值(终局口径:点数会被重置反复削平,只看瞬时值会低估进度)
   * 取样区间为"上一行到这一行之间",故表里每一行都是该行的区间峰值
   */
  points0Peak: Decimal
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
  /**当前阶段名(仅阶段式策略有;用于看清"卡在哪个阶段") */
  phase?: string
  /**该时刻的各层级状态(仅--verbose时收集;必须在取样当时抓,不能跑完再读) */
  layers?: string[]
}

/**
 * 取一次指标快照(时间用本次模拟的已过游戏时间,故载入旧存档也不会影响时间轴)
 * @param peak0 本取样区间的层级0点数峰值(终局口径取区间峰值,见测试与平衡.md)
 */
export function snapshot(
  elapsed: Decimal,
  verbose: boolean = false,
  phase?: string,
  peak0?: Decimal,
): SimRow {
  const layers = getOrderedLayers('asc')
  let structure = 0
  for (const e of layers) {
    structure += e.L.dimensions.length + Object.keys(e.L.buyables).length + e.L.upgrades.length
  }
  let levels = new Decimal(0)
  for (const v of Object.values(player.knowledgeUpgrades)) levels = levels.add(v)
  //最高层取"最后一个真实层级":getHighestActiveLayer可能返回临时层(下一层的预览),不适合进指标表
  const highest = layers[layers.length - 1]
  const points0 = getPoints([0])
  return {
    t: elapsed,
    points0,
    points0Peak: peak0 ? Decimal.max(peak0, points0) : points0,
    layerCount: layers.length,
    highest: highest ? getLayerName(highest.pos) : '-',
    ip: player.infinityPoints,
    infinityResets: player.infinityResets,
    infinityUpgrades: player.infinityUpgrades.length,
    knowledge: player.knowledge,
    knowledgeLevels: levels,
    challengeCompletions: normalChallengeCompletions(),
    achievements: player.achievements.length,
    structure,
    phase,
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
  const phase = () => policy.phase?.()
  /**本取样区间的层级0点数峰值(点数会被重置削平,故终局口径取区间峰值) */
  let peak0 = getPoints([0])
  const rows: SimRow[] = [snapshot(new Decimal(0), opts.verbose, phase(), peak0)]
  const startedMs = performance.now()
  let dt = opts.dt
  let frames = 0
  let nextRow = opts.every
  let layerCount = rows[0]!.layerCount
  let resets = player.infinityResets.toString()
  let prevCompletions = normalChallengeCompletions().toString()
  let activeChallenges = player.activeChallenges.join(',')
  let achievements = new Set(player.achievements)
  while (elapsed().lt(seconds)) {
    //与mainLoop一致:现实时间累加 → 加速/时间扭曲作用到dt上 → gameLoop(帧内再乘每秒速度)
    addValue('realTime', new Decimal(dt))
    const warped = applyTimeResources(new Decimal(dt))
    gameLoop(warped)
    advanceClock(dt)
    frames++
    policy.setTime?.(elapsed())
    const acted = policy.act()
    //策略要求小步长(如抓"1游戏秒内"的成就窗口)时一直用它,否则按"有动作=基础步长,没动作=逐步放大"
    const requested = policy.stepDt?.()
    dt = requested != undefined ? requested : acted ? opts.dt : Math.min(maxDt, dt * 2)
    //进度事件:层级/无限重置/挑战完成/成就各报一行,便于看清"卡在哪一步"
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
    const nowCompletions = normalChallengeCompletions().toString()
    if (nowCompletions != prevCompletions) {
      prevCompletions = nowCompletions
      opts.onEvent?.(`[挑战] t=${t}s 总完成次数=${nowCompletions}`)
    }
    const nowActive = player.activeChallenges.join(',')
    if (nowActive != activeChallenges) {
      activeChallenges = nowActive
      opts.onEvent?.(`[挑战] t=${t}s ${nowActive ? `进入/进行中=${nowActive}` : '退出挑战'}`)
    }
    if (player.achievements.length != achievements.size) {
      const fresh = [...player.achievements].filter((id) => !achievements.has(id))
      achievements = new Set(player.achievements)
      opts.onEvent?.(`[成就] t=${t}s 共${achievements.size}个 新解锁=${fresh.join(',')}`)
    }
    if (elapsed().gte(nextRow)) {
      nextRow += opts.every
      rows.push(snapshot(elapsed(), opts.verbose, phase(), peak0))
      peak0 = getPoints([0])
    } else {
      peak0 = Decimal.max(peak0, getPoints([0]))
    }
  }
  rows.push(snapshot(elapsed(), opts.verbose, phase(), peak0))
  return { rows, frames, realMs: performance.now() - startedMs }
}
