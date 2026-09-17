//挑战注册表
//挑战通过注册表(CHALLENGES)定义,进入/退出时强制重置目标层
//完成次数存入player.challenges,奖励效果按完成次数始终生效
//对层级的引用一律是"绝对高度引用"(见 docs/面向开发者/层级系统.md):
//解锁与目标层都按高度解析(精确匹配,否则上取整),因此不随窗口平移与删层而错位
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import type { Layer, LayerId } from '@/data/types'
import type { EffectDef, RegisteredEffect } from '@/compute/effects'
import { effectById, effectText, registerEffect, registerEffectDisabler } from '@/compute/effects'
import {
  challengeCompletions,
  getEnergy,
  getHighestActiveLayer,
  getLayer,
  getOrderedLayers,
  getPoints,
  isChallengeActive,
  prevLayer,
  resolveHeightRef,
} from '@/access'
import { maxSatisfying } from '@/tools/bisect'
import { getLayerOrder } from '@/tools/ordinal'
import { softCapValue } from '@/tools/softCap'
import { format } from '@/tools/format'
import { hasInfinityMilestone } from '@/compute/infinityMilestones'
import { doReset } from './reset'
import { addLog } from '@/data/log'

/**挑战的所属重置层，'normal'为常规层级，其余为元层id */
export type ChallengeLayer = 'normal' | string

/**挑战目标资源类型 */
export type ChallengeGoalType = 'points' | 'energy'

/**
 * 层级的高度引用:数字数组即"绝对高度的各级"(如[4]表示层级4,[10,15]表示层级10,15)
 * 前导零可省略,故[4]与[0,4]表示同一高度
 */
export type LayerHeightRef = number[]

/**挑战定义 */
export interface ChallengeDef {
  id: string
  name: string
  /**挑战期间的惩罚说明 */
  description: string
  /**所属重置层，决定在挑战页面的哪个子标签页显示 */
  layer: ChallengeLayer
  /**解锁所需达到的最小高度(存在高度≥它的层级即解锁,与坐标无关) */
  unlockLayer: LayerHeightRef
  /**目标层高度:进入/退出挑战时强制重置(解析为高度≥它的最低层级) */
  resetTarget: LayerHeightRef
  /**目标资源所在层高度(缺省为目标层的下层) */
  goalLayer?: LayerHeightRef
  /**目标资源类型 */
  goalType?: ChallengeGoalType
  /**
   * 完成目标:给定当前完成次数k(从0开始),返回所需目标资源量
   * 公式应单调递增且方便求逆(供批量完成机制使用)
   */
  goal(k: Decimal): Decimal
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

const challenges: ChallengeDef[] = []

/**注册一个挑战并自动注册其效果 */
export function registerChallenge(def: ChallengeDef) {
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

//------状态访问------
/**
 * 某挑战是否已解锁:存在高度≥unlockLayer的层级
 * 基于实际高度而非坐标,故base缩减后(自然数层级变少)仍按高度判定;
 * 该条件同时保证挑战的目标层一定能解析出来
 */
export function isUnlocked(def: ChallengeDef): boolean {
  return resolveHeightRef(def.unlockLayer) != undefined
}

/**某挑战是否正在激活 */
export function isActive(def: ChallengeDef): boolean {
  return isChallengeActive(def.id)
}

/**某挑战的完成次数 */
export function completions(def: ChallengeDef): Decimal {
  return challengeCompletions(def.id)
}

/**目标层坐标(高度精确匹配,否则上取整;高于所有层级时返回undefined) */
export function challengeResetTarget(def: ChallengeDef): LayerId | undefined {
  return resolveHeightRef(def.resetTarget)
}

/**目标资源所在层级坐标(缺省为目标层的下层) */
export function challengeGoalLayer(def: ChallengeDef): LayerId | undefined {
  if (def.goalLayer) return resolveHeightRef(def.goalLayer)
  const target = challengeResetTarget(def)
  return target ? prevLayer(target) : undefined
}

/**
 * 某挑战当前的目标资源量
 * 语义是"执行目标层重置所需的资源":0阶层级取其下层的点数(或能量);
 * ≥1阶层级取"其下低阶层级的数量"(该分支随高阶层级实装后再校准,见层级系统.md)
 */
export function challengeResource(def: ChallengeDef): Decimal {
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
      return e ? effectText(e, { pos: [0], id: 0 }) : ''
    })
    .filter(Boolean)
  return parts.join('、')
}

//------操作------
/**进入/退出挑战时强制重置目标层(无视升级u7/u8;无限里程碑im2解锁后不再强制清空下层升级);目标层已不存在时不做重置 */
function challengeReset(def: ChallengeDef) {
  const target = challengeResetTarget(def)
  if (!target) return
  doReset(target, true, !hasInfinityMilestone('im2'))
}

/**
 * 退出解锁条件不再满足、或目标层已失效的激活挑战(高阶重置删层后必须上锁)
 * 此时直接清除激活标记而不做重置,避免在缺失目标层时产生多余删层
 */
export function lockInvalidChallenges() {
  for (const def of getAllChallenges()) {
    if (!isActive(def)) continue
    if (isUnlocked(def) && challengeResetTarget(def)) continue
    player.activeChallenges = player.activeChallenges.filter((id) => id != def.id)
    addLog('info', `挑战上锁：${def.name}`)
  }
}

/**进入一个挑战:普通挑战互斥(先退出其它已激活的普通挑战),再加入激活列表并强制重置目标层 */
export function enterChallenge(def: ChallengeDef) {
  if (!isUnlocked(def) || isActive(def)) return
  //普通挑战互斥:进入前退出其它已激活的普通挑战(重置目标层、弹日志、移除激活标记)
  for (const other of getAllChallenges()) {
    if (other.id != def.id && other.layer == 'normal' && isActive(other)) {
      exitChallenge(other, false)
    }
  }
  player.activeChallenges.push(def.id)
  challengeReset(def)
  addLog('info', `进入挑战：${def.name}`)
}

/**退出挑战(完成或放弃):强制重置目标层并移除激活 */
export function exitChallenge(def: ChallengeDef, completed: boolean = false) {
  if (!isActive(def)) return
  player.activeChallenges = player.activeChallenges.filter((id) => id != def.id)
  challengeReset(def)
  addLog('info', completed ? `完成挑战：${def.name}` : `退出挑战：${def.name}`)
}

/**完成挑战:目标达成时点击,+1完成次数并退出 */
export function completeChallenge(def: ChallengeDef) {
  if (!isActive(def) || !challengeDone(def)) return
  player.challenges[def.id] = completions(def).add(1)
  exitChallenge(def, true)
}

/**
 * 批量完成辅助:给定目标资源量,求最大的 j 使 goal(j) <= resource
 * 注意:goal(j)是"第j+1次完成"所需的资源量,故可完成到 j+1 次(见 maxBatchCompletions)
 * 目标公式 goal(k) 单调递增,由 maxSatisfying 在高度域二分求解(至多约129次目标求值)
 */
export function maxCompletions(def: ChallengeDef, resource: Decimal): Decimal {
  return maxSatisfying((k) => def.goal(k), resource, completions(def))
}

/**当前资源下最多能完成到的完成次数(含本次;未达成当前目标时等于当前次数) */
export function maxBatchCompletions(def: ChallengeDef): Decimal {
  const now = completions(def)
  if (!challengeDone(def)) return now
  //goal(j) <= resource 说明"第j+1次"也已完成,故可完成到 j+1 次
  return maxCompletions(def, challengeResource(def)).add(1)
}

/**
 * 完成挑战(挑战卡完成按钮的统一入口)
 * 未解锁无限里程碑im3时退化为逐次完成(+1);解锁后一次结算到当前资源允许的最大完成次数,再退出挑战
 */
export function batchCompleteChallenge(def: ChallengeDef) {
  if (!hasInfinityMilestone('im3')) {
    completeChallenge(def)
    return
  }
  if (!isActive(def) || !challengeDone(def)) return
  const now = completions(def)
  const target = maxBatchCompletions(def)
  if (target.lte(now)) return
  player.challenges[def.id] = target
  exitChallenge(def, true)
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

//------挑战定义------

const CHALLENGES: ChallengeDef[] = [
  {
    id: 'c1',
    name: '无加速器',
    description: '挑战期间，加速器的效果无效',
    layer: 'normal',
    unlockLayer: [2],
    resetTarget: [2],
    goal(k: Decimal): Decimal {
      //完成约9次后目标开始超指数增长(软上限),阻止无限刷挑战
      return softCapValue(new Decimal(1e5).mul(new Decimal(100).pow(k)), new Decimal(1e24), 2, 1)
    },
    disableEffects: ['buyable-11'],
    rewardEffects: [
      {
        target: 'b11:amount',
        type: 'add',
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
    goal(k: Decimal): Decimal {
      //完成约9次后目标开始超指数增长(软上限)
      return softCapValue(new Decimal(1e5).mul(new Decimal(1000).pow(k)), new Decimal(1e32), 2, 1)
    },
    disableEffects: ['buyable-12'],
    effects: [
      {
        target: 'pointsGain',
        type: 'mul',
        value: (ctx) => new Decimal(0.5).pow(getLayer(ctx.pos)?.resetCount ?? new Decimal(0)),
        text: '点数获取 x{value}',
      },
    ],
    rewardEffects: [
      {
        target: 'b12:quad',
        type: 'mul',
        value: () => new Decimal(0.9).pow(challengeCompletions('c2')),
        text: '加倍器价格增速降低 x{value}',
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
    goal(k: Decimal): Decimal {
      return new Decimal(1e6).mul(new Decimal(10000).pow(k))
    },
    rewardEffects: [
      {
        target: 'energy:base',
        type: 'add',
        //能量指数是后期数值爆炸主因,奖励改为对数递减:0.03*log2(k+1),首次+0.03
        value: () => new Decimal(0.03).mul(challengeCompletions('c3').add(1).log(2)),
        text: '能量加成指数 +{value}',
      },
    ],
    rewardText: '增加能量加成指数',
  },
  {
    id: 'c4',
    name: '立即折算',
    description: '挑战期间，购买本层维度或可购买会使除加速器加成外的维度/可购买价格视为多购买1次',
    layer: 'normal',
    unlockLayer: [3],
    resetTarget: [3],
    goal(k: Decimal): Decimal {
      return new Decimal(1000).mul(new Decimal(1e4).pow(k))
    },
    rewardEffects: [
      {
        target: 'softCap:base',
        type: 'exp',
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
    goal(k: Decimal): Decimal {
      return new Decimal(1e8).mul(new Decimal(1e6).pow(k))
    },
    rewardEffects: [
      {
        target: 'dimensionMult',
        type: 'mul',
        value: (ctx) => {
          const L = getLayer(ctx.pos)
          return L ? L.resetTime.add(1).pow(challengeCompletions('c5').sqrt().div(2)) : 1
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
]

for (const c of CHALLENGES) registerChallenge(c)
