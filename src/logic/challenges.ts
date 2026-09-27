//挑战注册表
//挑战通过注册表(CHALLENGES)定义,进入/退出时强制重置目标层
//完成次数存入player.challenges,奖励效果按完成次数始终生效
//对层级的引用一律是"绝对高度引用"(见 docs/面向开发者/层级系统.md):
//解锁与目标层都按高度解析(精确匹配,否则上取整),因此不随窗口平移与删层而错位
//无限挑战(layer=='infinity')复用同一套注册表/完成次数表/激活列表/入口函数,差别只有三点:
//  解锁条件为无限升级iu15、进入/退出时强制无限重置(不获得资源)、目标资源恒为层级0点数
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import type { Layer, LayerId } from '@/data/types'
import { effectById, effectText, registerEffect, registerEffectDisabler } from '@/compute/effects'
import {
  applyTo,
  defineSlot,
  invertAt,
  type EffectDef,
  type RegisteredEffect,
} from '@/compute/effects'
import { expLinear, type Curve } from '@/compute/curves'
import {
  FORCED_ACTIVE,
  challengeCompletions,
  forcedActiveChallengeIds,
  getEnergy,
  getHighestActiveLayer,
  getLayer,
  getOrderedLayers,
  getPoints,
  highestActiveLayer,
  isChallengeActive,
  isChallengeEntered,
  prevLayer,
  resolveHeightRef,
} from '@/access'
import { maxSatisfying } from '@/tools/bisect'
import { getLayerOrder } from '@/tools/ordinal'
import { format } from '@/tools/format'
import { hasInfinityMilestone } from '@/compute/infinityMilestones'
import { hasInfinityUpgrade } from '@/compute/infinity'
import { clearFrameCache } from '@/compute/frameCache'
import { doReset } from './reset'
import { doInfinityReset } from './infinity'
import { addLog } from '@/data/log'

/**挑战的所属重置层，'normal'为常规层级，'infinity'为无限挑战 */
export type ChallengeLayer = 'normal' | 'infinity'

/**挑战目标资源类型 */
export type ChallengeGoalType = 'points' | 'energy'

//------挑战目标的软上限(注册为challengeGoalIndex上的cap效果)------
/**挑战目标软上限的基准阈值(完成次数指数超过它后目标开始超指数增长) */
const CHALLENGE_CAP_BASE = 9
/**挑战目标软上限的基准幂次 */
const CHALLENGE_CAP_POWER = 2
/**挑战目标软上限阈值槽位 */
const SLOT_CHALLENGE_CAP_BASE = defineSlot(
  'challengeCap:base',
  () => new Decimal(CHALLENGE_CAP_BASE),
  'global',
)
/**挑战目标软上限幂次槽位 */
const SLOT_CHALLENGE_CAP_POWER = defineSlot(
  'challengeCap:power',
  () => new Decimal(CHALLENGE_CAP_POWER),
  'global',
)

//所有挑战的目标指数都经过这里:软上限因此**不可能漏写**(公式只拿得到已过cap的指数)
registerEffect({
  id: 'challenge-goal-softcap',
  name: '挑战目标软上限',
  target: 'challengeGoalIndex',
  type: 'cap',
  threshold: SLOT_CHALLENGE_CAP_BASE,
  power: SLOT_CHALLENGE_CAP_POWER,
  height: 0,
})

/**完成次数→"已过软上限的目标指数":挑战目标公式的自变量就是这个值 */
export function challengeGoalIndex(k: Decimal): Decimal {
  return applyTo('challengeGoalIndex', k)
}

/**
 * 层级的高度引用:数字数组即"绝对高度的各级"(如[4]表示层级4,[10,15]表示层级10,15)
 * 前导零可省略,故[4]与[0,4]表示同一高度
 */
export type LayerHeightRef = number[]

/**挑战定义(注册用:目标只需声明形状或公式,goal由registerChallenge生成) */
export interface ChallengeInput {
  id: string
  name: string
  /**挑战期间的惩罚说明 */
  description: string
  /**所属重置层，决定在挑战页面的哪个子标签页显示 */
  layer: ChallengeLayer
  /**解锁所需达到的最小高度(存在高度≥它的层级即解锁,与坐标无关);无限挑战不填(改由iu15解锁) */
  unlockLayer?: LayerHeightRef
  /**目标层高度:进入/退出挑战时强制重置(解析为高度≥它的最低层级);无限挑战不填(整局无限重置) */
  resetTarget?: LayerHeightRef
  /**目标资源所在层高度(缺省为目标层的下层;无限挑战恒为层级0) */
  goalLayer?: LayerHeightRef
  /**目标资源类型 */
  goalType?: ChallengeGoalType
  /**
   * 目标形状(指数型,底数=序数进制):目标 = base^(a + b·i),i为完成次数经challengeGoalIndex管道(含软上限)后的指数
   * 软上限由框架统一施加,公式只拿得到已过cap的指数,因此不会漏写
   */
  goalShape?: { a: DecimalSource; b: DecimalSource }
  /**非指数型目标的逃生口:入参i已经是过完challengeGoalIndex管道的指数 */
  goalFormula?(i: Decimal): Decimal
  /**挑战期间禁用的既有效果id(如加速器/加倍器) */
  disableEffects?: string[]
  /**挑战期间生效的惩罚效果(所有层级生效) */
  effects?: EffectDef[]
  /**按完成次数始终生效的奖励效果 */
  rewardEffects?: EffectDef[]
  /**奖励文字说明 */
  rewardText?: string
  /**当前奖励数值的文字(第二行;缺省从rewardEffects自动渲染,C5等动态奖励用公式覆盖) */
  rewardValueText?: () => string
}

/**注册后的挑战:goal已由目标形状/公式生成 */
export type ChallengeDef = Omit<ChallengeInput, 'goalShape' | 'goalFormula'> & {
  /**下一次完成所需的目标资源量(k为当前完成次数) */
  goal(k: Decimal): Decimal
  /**目标曲线(指数型目标才有;供批量完成做闭式估算) */
  goalCurve?: Curve
}

const challenges: ChallengeDef[] = []

/**
 * 注册一个挑战并自动注册其效果
 * 目标统一经challengeGoalIndex管道:先算"已过软上限的指数"i,再交给形状/公式
 */
export function registerChallenge(input: ChallengeInput) {
  const { goalShape, goalFormula, ...rest } = input
  if (!goalShape && !goalFormula) {
    throw new Error(`挑战${input.id}缺少goalShape或goalFormula`)
  }
  const goalCurve = goalShape
    ? expLinear({ label: `挑战目标(${input.id})`, a: goalShape.a, b: goalShape.b })
    : undefined
  const goal = (k: Decimal): Decimal => {
    const i = challengeGoalIndex(k)
    return goalCurve ? goalCurve.at(i) : goalFormula!(i)
  }
  const def: ChallengeDef = { ...rest, goal, goalCurve }
  challenges.push(def)
  registerChallengeEffects(def)
}

/**获取某重置层的所有挑战 */
export function getChallenges(layer: ChallengeLayer): ChallengeDef[] {
  return challenges.filter((c) => c.layer == layer)
}

/**获取所有挑战 */
export function getAllChallenges(): ChallengeDef[] {
  return challenges.slice()
}

/**获取一个挑战定义 */
export function getChallenge(id: string): ChallengeDef | undefined {
  return challenges.find((c) => c.id == id)
}

/**某挑战是否属于无限挑战 */
export function isInfinityChallenge(def: ChallengeDef): boolean {
  return def.layer == 'infinity'
}

/**无限挑战是否已解锁(购买无限升级iu15;无限升级不会被无限重置清除,故解锁后一直有效) */
export function isInfinityChallengeUnlocked(): boolean {
  return hasInfinityUpgrade('iu15')
}

//------状态访问------
/**
 * 某挑战是否已解锁:存在高度≥unlockLayer的层级
 * 基于实际高度而非坐标,故base缩减后(自然数层级变少)仍按高度判定;
 * 该条件同时保证挑战的目标层一定能解析出来
 * 无限挑战改由购买无限升级iu15解锁
 */
export function isUnlocked(def: ChallengeDef): boolean {
  if (isInfinityChallenge(def)) return isInfinityChallengeUnlocked()
  return def.unlockLayer ? resolveHeightRef(def.unlockLayer) != undefined : false
}

/**某挑战是否正在激活(含被无限挑战强制视为进入) */
export function isActive(def: ChallengeDef): boolean {
  return isChallengeActive(def.id)
}

/**
 * 某挑战是否被无限挑战强制视为进入(如IC1期间C1/C2)
 * 强制生效期间该挑战不可进入/退出/完成(完成次数不增加),卡片只显示"强制生效中"
 */
export function isForcedActive(def: ChallengeDef): boolean {
  return forcedActiveChallengeIds().includes(def.id)
}

/**某挑战的完成次数 */
export function completions(def: ChallengeDef): Decimal {
  return challengeCompletions(def.id)
}

/**
 * 某挑战是否允许批量完成(退出时一次结算尽可能多的完成次数)
 * 普通挑战由无限里程碑im3解锁;无限挑战暂不支持批量
 */
export function allowBatch(def: ChallengeDef): boolean {
  //TODO: 无限挑战批量完成的解锁途径未定(无限升级/成就/里程碑/知识升级)
  if (isInfinityChallenge(def)) return false
  return hasInfinityMilestone('im3')
}

/**目标层坐标(高度精确匹配,否则上取整;高于所有层级时返回undefined;无限挑战无目标层) */
export function challengeResetTarget(def: ChallengeDef): LayerId | undefined {
  return def.resetTarget ? resolveHeightRef(def.resetTarget) : undefined
}

/**目标资源所在层级坐标(缺省为目标层的下层;无限挑战恒为层级0) */
export function challengeGoalLayer(def: ChallengeDef): LayerId | undefined {
  if (def.goalLayer) return resolveHeightRef(def.goalLayer)
  if (isInfinityChallenge(def)) return [0]
  const target = challengeResetTarget(def)
  return target ? prevLayer(target) : undefined
}

/**
 * 某挑战当前的目标资源量
 * 语义是"执行目标层重置所需的资源":0阶层级取其下层的点数(或能量);
 * ≥1阶层级取"其下低阶层级的数量"(该分支随高阶层级实装后再校准,见层级系统.md)
 * 无限挑战恒为层级0点数
 */
export function challengeResource(def: ChallengeDef): Decimal {
  //无限挑战:目标资源即层级0点数
  if (isInfinityChallenge(def)) {
    const goal = challengeGoalLayer(def)
    return goal ? getPoints(goal) : new Decimal(0)
  }
  const target = challengeResetTarget(def)
  if (!target) return new Decimal(0)
  const order = getLayerOrder(target)
  if (order > 0) {
    return new Decimal(getOrderedLayers('asc').filter((e) => e.order < order).length)
  }
  const goal = challengeGoalLayer(def)
  if (!goal) return new Decimal(0)
  return def.goalType == 'energy' ? getEnergy(goal) : getPoints(goal)
}

/**某挑战下一次完成所需的目标值 */
export function challengeGoal(def: ChallengeDef): Decimal {
  return def.goal(completions(def))
}

/**某挑战是否已完成目标 */
export function challengeDone(def: ChallengeDef): boolean {
  return challengeResource(def).gte(challengeGoal(def))
}

/**当前奖励的数值文字(卡片第二行):自定义公式优先,否则渲染各奖励效果在当前完成次数下的数值 */
export function challengeRewardValue(def: ChallengeDef): string {
  if (def.rewardValueText) return def.rewardValueText()
  const parts = (def.rewardEffects ?? [])
    .map((_, i) => {
      const e = effectById(`challenge-${def.id}-reward-${i}`)
      return e ? effectText(e) : ''
    })
    .filter(Boolean)
  return parts.join('、')
}

//------操作------
/**
 * 进入/退出挑战时的强制重置
 * 普通挑战重置目标层(无视升级u7/u8;无限里程碑im2解锁后不再强制清空下层升级);目标层已不存在时不做重置
 * 无限挑战执行强制无限重置(不获得无限点数)
 */
function challengeReset(def: ChallengeDef) {
  if (isInfinityChallenge(def)) {
    doInfinityReset(true)
    return
  }
  const target = challengeResetTarget(def)
  if (!target) return
  doReset(target, true, !hasInfinityMilestone('im2'))
}

/**
 * 退出解锁条件不再满足、或目标层已失效的挑战(高阶重置删层后必须上锁)
 * 此时直接清除激活标记而不做重置,避免在缺失目标层时产生多余删层
 * 只处理"玩家真正进入过"的挑战(isChallengeEntered):被无限挑战强制视为进入的普通挑战
 * 从未进入激活列表,若按 isActive 判定会被反复当作失效挑战上锁并每帧刷日志
 * 无限挑战无目标层,不参与锁定
 */
export function lockInvalidChallenges() {
  for (const def of getAllChallenges()) {
    if (def.layer != 'normal') continue
    if (!isChallengeEntered(def.id) || !isActive(def)) continue
    if (isUnlocked(def) && challengeResetTarget(def)) continue
    player.activeChallenges = player.activeChallenges.filter((id) => id != def.id)
    addLog('info', `挑战上锁：${def.name}`)
  }
  //激活挑战影响软上限阈值/幂次等帧内缓存值:统一失效
  clearFrameCache()
}

/**
 * 进入一个挑战:同层挑战互斥(先退出其它已激活的同层挑战),再加入激活列表并强制重置
 * 无限挑战之间互斥,但与普通挑战并存(各自独立)
 * 注:被无限挑战强制视为进入的挑战(isActive为真)会被此处拦下,无法再进入
 */
export function enterChallenge(def: ChallengeDef) {
  if (!isUnlocked(def) || isActive(def)) return
  for (const other of getAllChallenges()) {
    if (other.id != def.id && other.layer == def.layer && isActive(other)) {
      exitChallenge(other)
    }
  }
  player.activeChallenges.push(def.id)
  challengeReset(def)
  addLog('info', `进入挑战：${def.name}`)
  //激活挑战影响软上限阈值/幂次等帧内缓存值
  clearFrameCache()
}

/**
 * 退出挑战(完成或放弃):先结算完成次数,再移除激活标记并强制重置
 * 结算规则:未达到目标则不增加次数;达到目标时一次结算 maxBatchCompletions 次
 * (允许批量的挑战尽量多结算,否则只+1;两种情况都由 maxBatchCompletions 给出)
 * 强制生效中(如IC1中的C1/C2)的挑战既不能退出也不能结算,直接忽略
 * @param def 要退出的挑战
 */
export function exitChallenge(def: ChallengeDef) {
  if (!isActive(def)) return
  if (isForcedActive(def)) return
  //先移除激活标记:无限挑战退出后立即解除对普通挑战的强制激活,
  //避免后续结算/重置时把"已经退出的挑战"仍算作生效
  player.activeChallenges = player.activeChallenges.filter((id) => id != def.id)
  const done = challengeDone(def)
  if (done) {
    //结算量只由 maxBatchCompletions 决定,与"完成"按钮上显示的数字同源
    const gained = maxBatchCompletions(def)
    if (gained.gt(0)) player.challenges[def.id] = completions(def).add(gained)
  }
  challengeReset(def)
  addLog('info', done ? `完成挑战：${def.name}` : `退出挑战：${def.name}`)
  //退出挑战会改变完成次数与激活列表,两者都影响软上限阈值/幂次的帧内缓存值
  clearFrameCache()
}

/**
 * 批量完成辅助:给定目标资源量,求"还能额外完成几次"
 * maxSatisfying 以当前完成次数为原点、返回相对增量(见tools/bisect的origin说明);
 * 需要"完成后总共是第几次"时用 `completions(def).add(maxCompletions(...))`
 * 由于goal(k)表示第k+1次完成需要的目标量，因此最后要+1
 * @param resource 目标资源量(通常传入 challengeResource(def))
 */
export function maxCompletions(def: ChallengeDef, resource: Decimal): Decimal {
  return maxSatisfying(def.goal, resource, completions(def), goalCountEstimate(def, resource)).add(
    1,
  )
}

/**
 * 批量完成的闭式估算(供maxSatisfying收敛)
 * 步骤:目标值 →(目标曲线求逆)已过软上限的指数 →(challengeGoalIndex求逆)完成次数
 * 契约:估算只当搜索锚点(见tools/bisect),偏差只影响迭代次数,不影响正确性
 */
function goalCountEstimate(def: ChallengeDef, resource: Decimal): Decimal | undefined {
  const index = def.goalCurve?.inverse?.(resource)
  if (index == undefined) return undefined
  return invertAt('challengeGoalIndex', index)
}

/**
 * 本次完成能增加的完成次数
 * - 未达到当前目标:0(不能完成)
 * - 允许批量的挑战:尽量多结算(受 im3 解锁影响,见 allowBatch)
 * - 否则:1(逐次完成)
 * 这是"结算"与"UI显示"的唯一来源(见 exitChallenge 与 challengeCard.vue)
 */
export function maxBatchCompletions(def: ChallengeDef): Decimal {
  if (!challengeDone(def)) return new Decimal(0)
  if (!allowBatch(def)) return new Decimal(1)
  return maxCompletions(def, challengeResource(def))
}

//------效果注册------
/**把某挑战的惩罚效果转换为注册效果(挑战期间对所有层生效) */
function challengePenaltyEffect(def: ChallengeDef, e: EffectDef, i: number): RegisteredEffect {
  return {
    ...e,
    id: `challenge-${def.id}-penalty-${i}`,
    name: `挑战惩罚-${def.name}`,
    isActive: () => isActive(def),
  }
}

/**把某挑战的奖励效果转换为注册效果(有完成次数后始终生效) */
function challengeRewardEffect(def: ChallengeDef, e: EffectDef, i: number): RegisteredEffect {
  return {
    ...e,
    id: `challenge-${def.id}-reward-${i}`,
    name: `挑战奖励-${def.name}`,
    isActive: () => completions(def).gt(0),
  }
}

/**注册一个挑战的惩罚/奖励效果与效果禁用器 */
function registerChallengeEffects(def: ChallengeDef) {
  for (const id of def.disableEffects ?? []) {
    registerEffectDisabler(id, () => isActive(def))
  }
  def.effects?.forEach((e, i) => registerEffect(challengePenaltyEffect(def, e, i)))
  def.rewardEffects?.forEach((e, i) => registerEffect(challengeRewardEffect(def, e, i)))
}

/**应用当前激活挑战的动态效果(如每帧损失) */
export function applyChallengeEffects(layer: Layer, pos: LayerId, dt: Decimal): void {
  //挑战C5:除最高已解锁层级外,所有0阶层级每秒损失90%的维度、点数和能量
  if (isChallengeActive('c5') && !isHighestLayer(pos)) {
    const factor = new Decimal(0.1).pow(dt)
    layer.points = layer.points.mul(factor)
    layer.energy = layer.energy.mul(factor)
    for (const dim of layer.dimensions) dim[0] = dim[0].mul(factor)
  }
}

/**某层是否为当前最高已解锁层级(挑战C5豁免) */
function isHighestLayer(pos: LayerId): boolean {
  return pos.toString() == getHighestActiveLayer()?.toString()
}

//------无限挑战的全局速度惩罚(IC5)------
/**
 * IC5的速度惩罚指数:2^k
 * k为"最大的自然数层级"的高度,即 highestActiveLayer([0]) 对应层级的level(小于[1,0]的0阶层级中高度最大的那个)
 * 只有层级0时k=0,故最差情况恒为x0.001;每多1个高度就平方
 */
function ic5SpeedExponent(): Decimal {
  const L = getLayer(highestActiveLayer([0]))
  return new Decimal(2).pow(L ? L.level : new Decimal(0))
}

//无限挑战的效果在注册表之后统一注册(与挑战定义分开,便于阅读)
registerEffect({
  id: 'challenge-ic5-speed',
  name: '挑战惩罚-时间囚笼',
  target: 'psdSpeed',
  type: 'mul',
  value: () => new Decimal(0.001).pow(ic5SpeedExponent()),
  isActive: () => isChallengeActive('ic5'),
  text: '全局速度 x{value}',
})

//------挑战定义------

const CHALLENGES: ChallengeInput[] = [
  {
    id: 'c1',
    name: '无加速器',
    description: '挑战期间，加速器的效果无效',
    layer: 'normal',
    unlockLayer: [2],
    resetTarget: [2],
    goalShape: { a: 5, b: 2 },
    disableEffects: ['buyable-11'],
    rewardEffects: [
      {
        target: 'b11:amount',
        type: 'add',
        static: true,
        value: () => challengeCompletions('c1').mul(5),
        text: '免费加速器等级 +{value}',
      },
    ],
    rewardText: '每次完成获得5个免费加速器',
  },
  {
    id: 'c2',
    name: '无加倍器',
    description: '挑战期间，加倍器的效果无效，且每次重置后本层点数获取减半',
    layer: 'normal',
    unlockLayer: [2],
    resetTarget: [2],
    goalShape: { a: 5, b: 3 },
    disableEffects: ['buyable-12'],
    effects: [
      {
        target: 'pointsGain',
        type: 'mul',
        static: true,
        value: (ctx) => new Decimal(0.5).pow(getLayer(ctx.pos)?.resetCount ?? new Decimal(0)),
        text: '点数获取 x{value}',
      },
    ],
    rewardEffects: [
      {
        target: 'b12:quad',
        type: 'mul',
        static: true,
        value: () => new Decimal(0.9).pow(challengeCompletions('c2')),
        text: '加倍器价格指数二次项 x{value}',
      },
    ],
    rewardText: '降低加倍器的价格增长速度',
  },
  {
    id: 'c3',
    name: '能量衰弱',
    description: '挑战期间，能量效果被严重削弱：ln(能量+1)',
    layer: 'normal',
    unlockLayer: [3],
    resetTarget: [3],
    goalShape: { a: 6, b: 4 },
    rewardEffects: [
      {
        target: 'energy:base',
        type: 'add',
        //能量指数是后期数值爆炸主因,奖励改为对数递减:0.03*log2(k+1),首次+0.03
        static: true,
        value: () => new Decimal(0.03).mul(challengeCompletions('c3').add(1).log(2)),
        text: '能量加成指数 +{value}',
      },
    ],
    rewardText: '增加能量加成指数',
  },
  {
    id: 'c4',
    name: '花费暴增',
    description:
      '挑战期间，购买维度/可购买会使同一层层除加速器加成外的所有维度/可购买价格视为多购买1次',
    layer: 'normal',
    unlockLayer: [3],
    resetTarget: [3],
    goalShape: { a: 3, b: 4 },
    rewardEffects: [
      {
        target: 'priceCap:base',
        type: 'exp',
        static: true,
        value: () => new Decimal(0.15).mul(challengeCompletions('c4')).add(1),
        text: '价格软上限阈值 ^{value}',
      },
    ],
    rewardText: '延迟维度和加速器价格的软上限',
  },
  {
    id: 'c5',
    name: '维度蒸发',
    description: '挑战期间，除最高层级外，所有0阶层级每秒损失90%的维度、点数和能量',
    layer: 'normal',
    unlockLayer: [4],
    resetTarget: [4],
    goalShape: { a: 8, b: 8 },
    rewardEffects: [
      {
        target: 'dimensionMult',
        type: 'mul',
        value: (ctx) => {
          const L = getLayer(ctx.pos)
          return L
            ? L.resetTime.add(1).pow(challengeCompletions('c5').sqrt().div(2))
            : new Decimal(1)
        },
        text: '维度产量 x{value}',
      },
    ],
    rewardText: '维度随当前层级的重置时间变得更强',
    //C5的数值随每层resetTime动态变化,故用公式展示,指数计算为sqrt(完成次数)/2
    rewardValueText: () => {
      const exp = challengeCompletions('c5').sqrt().div(2)
      return `维度产量 x(1+t)^${format(exp)}`
    },
  },
  //------无限挑战(iu15解锁;进/出均强制无限重置,目标资源恒为层级0点数)------
  {
    //IC1:强制视为进入C1和C2(见access/challengeState的FORCED_ACTIVE),
    //加速器/加倍器失效与"重置后点数获取减半"由此自动生效,故本挑战不注册任何惩罚效果
    id: 'ic1',
    name: '挑战组合A',
    description: '挑战期间，C1和C2的惩罚始终生效（加速器与加倍器失效、重置后点数获取减半）',
    layer: 'infinity',
    goalShape: { a: 100, b: 50 },
    rewardEffects: [
      {
        target: 'infinityGain',
        type: 'mul',
        //数值待测试
        static: true,
        value: () => challengeCompletions('ic1').add(1),
        text: '无限点数获取 x{value}',
      },
    ],
    rewardText: '提升无限点数获取',
  },
  {
    //IC2:强制视为进入C3和C4(能量衰弱与价格偏移自动生效)
    id: 'ic2',
    name: '挑战组合B',
    description: '挑战期间，C3和C4的惩罚始终生效（能量效果变为对数、购买使价格视为多买1次）',
    layer: 'infinity',
    goalShape: { a: 80, b: 160 },
    rewardEffects: [
      {
        target: 'b13:amount',
        type: 'add',
        //每次完成获得1个免费的加速器加成(b13的效果为每个+2%)
        static: true,
        value: () => challengeCompletions('ic2'),
        text: '免费加速器加成 +{value}',
      },
    ],
    rewardText: '每次完成获得1个免费的加速器加成',
  },
  {
    id: 'ic3',
    name: '维度折叠',
    description: '挑战期间，每个层级只有维度1和维度2能生产资源',
    layer: 'infinity',
    goalShape: { a: 200, b: 200 },
    rewardEffects: [
      {
        target: 'dimensionExponent',
        type: 'add',
        //数值待测试
        static: true,
        value: () => new Decimal(0.05).mul(challengeCompletions('ic3').sqrt()),
        text: '维度指数 +{value}',
      },
    ],
    rewardText: '提升维度指数',
  },
  {
    id: 'ic4',
    name: '强软上限',
    description: '挑战期间，价格软上限和维度生产软上限的阈值固定为1，且强度为原来的1.5次方',
    layer: 'infinity',
    goalShape: { a: 150, b: 75 },
    effects: [
      {
        //价格软上限阈值固定为1
        target: 'priceCap:base',
        type: 'custom',
        static: true,
        value: () => new Decimal(1),
        text: '价格软上限阈值固定为{value}',
      },
      {
        //维度生产软上限阈值固定为1(与价格软上限是**各自独立**的参数点,只是都被本挑战固定为1)
        target: 'dimCap:base',
        type: 'custom',
        static: true,
        value: () => new Decimal(1),
        text: '维度生产软上限阈值固定为{value}',
      },
      {
        //强度为原来的平方:价格软上限^2→^2.828、维度生产软上限^0.8→^(0.8^1.5)
        //两者参数独立,故各注册一条(数值相同的两条效果,统计页会分别显示)
        target: 'priceCap:power',
        type: 'exp',
        static: true,
        value: () => new Decimal(1.5),
        text: '软上限强度 ^{value}',
      },
      {
        target: 'dimCap:power',
        type: 'exp',
        static: true,
        value: () => new Decimal(1.5),
        text: '软上限强度 ^{value}',
      },
    ],
    rewardEffects: [
      {
        target: 'energy:base',
        type: 'add',
        //数值待测试
        static: true,
        value: () => new Decimal(0.05).mul(challengeCompletions('ic4').add(1).ln()),
        text: '能量指数 +{value}',
      },
    ],
    rewardText: '进一步提升能量指数',
  },
  {
    id: 'ic5',
    name: '时间囚笼',
    description: '挑战期间，全局速度x0.001，每达到1个新层级（高度），该效果将平方',
    layer: 'infinity',
    goalShape: { a: 1000, b: 250 },
    rewardEffects: [
      {
        target: 'iu33:base',
        type: 'add',
        //数值待测试
        static: true,
        value: () => new Decimal(0.2).mul(challengeCompletions('ic5').sqrt()),
        text: '无限维度效果指数 +{value}',
      },
    ],
    rewardText: '提升"无限维度"(iu33)的效果指数',
  },
]

for (const c of CHALLENGES) registerChallenge(c)

//------注册表一致性校验(仅开发构建,防止FORCED_ACTIVE与挑战注册表失配)------
if (!import.meta.env.PROD) {
  for (const [icId, forcedIds] of Object.entries(FORCED_ACTIVE)) {
    if (!getChallenge(icId)) console.error(`[挑战]FORCED_ACTIVE的键${icId}不是已注册的挑战`)
    for (const id of forcedIds) {
      if (!getChallenge(id)) console.error(`[挑战]FORCED_ACTIVE的${icId}引用了未注册的挑战${id}`)
    }
  }
}
