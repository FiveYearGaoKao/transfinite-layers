//知识升级的定义与计算
//知识升级可多次购买(有数量上限),分为QoL/加成等类别,价格与显示均由声明驱动
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import {
  getLayer,
  getUnlockedNormalAchievementCount,
  getWindowTopLayer,
  hasAchievement,
} from '@/access'
import { temp } from '@/data/temp'
import { OFFLINE_LIMIT_BASE, OFFLINE_LIMIT_PER_LEVEL } from '@/data/constants'
import { format, formatWhole } from '@/tools/format'
import { constantCurve, floored, geometric, linear, type Curve } from './curves'
import type { BuyableItem } from './buying'
import {
  applyTo,
  defineSlot,
  effectText,
  registerEffect,
  type EffectDef,
  type RegisteredEffect,
} from './effects'

/**知识升级的配置 */
export interface KnowledgeUpgradeDef {
  /**唯一id */
  id: string
  name: string
  /**类别(如'qol'/'bonus'),知识页按类别分页 */
  category: string
  description: string
  /**最大购买数 */
  maxAmount: Decimal
  /**
   * 价格曲线:第n个的价格(已购n个时下一个的价格)
   * 常量直接写constantCurve(c);知识价格**不取序数进制**,故与player.base无关
   */
  cost: Curve
  /**前置升级,每一项为[升级id, 至少需要的数量] */
  require: [string, Decimal][]
  /**除前置升级外还需满足的额外条件(如点数需求),不满足时升级隐藏 */
  canBuy(): boolean
  /**数值效果(声明式,可省略) */
  effect?: EffectDef
  /**购买效果的文字说明(缺省从effect自动生成) */
  effectText?(): string
}

const SOLT_DEPTH_POINTS_BASE = defineSlot('depthPoints:base', () => new Decimal(2), 'global')

/**所有已定义的知识升级 */
export const KNOWLEDGE_UPGRADES: KnowledgeUpgradeDef[] = [
  {
    id: 'time-offline',
    name: '时间感知',
    category: 'time',
    description: '解锁离线时间和时间扭曲',
    maxAmount: new Decimal(1),
    cost: constantCurve(5),
    require: [],
    canBuy: () => true,
  },
  {
    id: 'time-store',
    name: '时间存储',
    category: 'time',
    description: '允许储存离线时间',
    maxAmount: new Decimal(1),
    cost: constantCurve(10),
    require: [['time-offline', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'time-boost',
    name: '离线加速',
    category: 'time',
    description: '离线时间可用于加速(稳定提升全局速度)',
    maxAmount: new Decimal(1),
    cost: constantCurve(10),
    require: [['time-store', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'time-pause',
    name: '时间暂停',
    category: 'time',
    description: '允许主动暂停游戏,暂停期间时间储存为离线时间',
    maxAmount: new Decimal(1),
    cost: constantCurve(5),
    require: [['time-store', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'time-tick',
    name: 'TAS',
    category: 'time',
    description: '解锁工具栏的时间流逝1帧按钮',
    maxAmount: new Decimal(1),
    cost: constantCurve(20),
    require: [['time-pause', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'time-overclock',
    name: '超频',
    category: 'time',
    description: '加速倍率升级,每级开放更高倍率(x5/x15/x60)',
    maxAmount: new Decimal(3),
    //10^(n+1):显式常量底数,不随序数进制变化
    cost: geometric({ c: 10, r: 10, label: '超频价格' }),
    require: [['time-boost', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'time-offline-limit',
    name: '离线延长',
    category: 'time',
    description: '提高离线时间上限(每级+1小时)',
    maxAmount: new Decimal(18),
    //20+20n
    cost: linear({ a: 20, b: 20, label: '离线延长价格' }),
    require: [['time-store', new Decimal(1)]],
    canBuy: () => true,
    effectText(): string {
      return `离线时间上限 ${formatWhole(offlineTimeLimit().div(3600))}小时`
    },
  },
  {
    id: 'bonus-achievement',
    name: '成就之力',
    category: 'bonus',
    description: '每个已解锁的普通(非隐藏)成就使所有维度倍率x1.05,效果叠乘',
    maxAmount: new Decimal(1),
    cost: constantCurve(10),
    require: [],
    canBuy: () => getUnlockedNormalAchievementCount() >= 10,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      //只读已解锁成就数,可进帧内计划
      static: true,
      value: () => new Decimal(1.05).pow(getUnlockedNormalAchievementCount()),
      text: '所有维度倍率 x{value}',
    },
  },
  {
    id: 'boost-production',
    name: '生产增效',
    category: 'bonus',
    description: '所有维度生产+10%每级,效果叠乘',
    maxAmount: new Decimal(100),
    //5+5n(线性增长:只有线性/几何族的解析和才能把"买最大"算准)
    cost: linear({ a: 5, b: 5, label: '生产增效价格' }),
    require: [],
    canBuy: () => true,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      static: true,
      value: () => new Decimal(1.1).pow(knowledgeAmount('boost-production')),
      text: '所有维度生产 x{value}',
    },
  },
  {
    id: 'depth-points',
    name: '深度加成',
    category: 'bonus',
    description: '同一窗口内最高层级与本层的高度差为d时,本层点数获取x2^d',
    maxAmount: new Decimal(1),
    cost: constantCurve(100),
    require: [],
    canBuy: () => hasAchievement('a34'),
    effect: {
      target: 'pointsGain',
      type: 'mul',
      base: SOLT_DEPTH_POINTS_BASE,
      //只读层级高度(解锁新层级会清缓存),可进帧内计划
      static: true,
      value: (ctx, base) => {
        const top = getLayer(getWindowTopLayer(ctx.pos))
        const L = getLayer(ctx.pos)
        if (!top || !L) return new Decimal(1)
        return Decimal.pow(base || 2, Decimal.max(0, top.level.sub(L.level)))
      },
      text: '点数获取 x{value}',
    },
  },
  {
    id: 'command-checkin',
    name: '指令系统',
    category: 'command',
    description: '解锁指令系统和签到指令/checkin',
    maxAmount: new Decimal(1),
    cost: constantCurve(20),
    require: [['time-offline', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'command-quiz',
    name: '答题',
    category: 'command',
    description: '解锁答题指令/quiz',
    maxAmount: new Decimal(1),
    cost: constantCurve(20),
    require: [['command-checkin', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'quiz-accel',
    name: '答题加速',
    category: 'command',
    description: '答题冷却时间x0.9每级,效果叠乘',
    maxAmount: new Decimal(20),
    //20+10n
    cost: linear({ a: 20, b: 10, label: '答题加速价格' }),
    require: [['command-quiz', new Decimal(1)]],
    canBuy: () => true,
    effect: {
      target: 'quizCooldown',
      type: 'mul',
      static: true,
      value: () => new Decimal(0.9).pow(knowledgeAmount('quiz-accel')),
      text: '答题冷却 x{value}',
    },
  },
  {
    id: 'quiz-store',
    name: '答题储存',
    category: 'command',
    description: '冷却结束时将储存答题次数,每级使储存上限+1',
    maxAmount: new Decimal(10),
    //100+20n
    cost: linear({ a: 100, b: 20, label: '答题储存价格' }),
    require: [['quiz-accel', new Decimal(5)]],
    canBuy: () => true,
    effectText(): string {
      return `储存上限 ${formatWhole(quizStoreLimit())}(当前储存 ${player.quizStored})`
    },
  },
  {
    id: 'quiz-difficulty',
    name: '博学',
    category: 'command',
    description: '答题奖励知识x1.5每级,效果叠乘,并提高题目难度',
    maxAmount: new Decimal(15),
    //50·2^n:显式常量底数(用base=2、a=log2(50)的指数式会因浮点误差在取整后变成49)
    cost: floored(geometric({ c: 50, r: 2, label: '博学价格' })),
    require: [['quiz-accel', new Decimal(5)]],
    canBuy: () => true,
    effectText(): string {
      return `答题奖励 x${format(new Decimal(1.5).pow(knowledgeAmount('quiz-difficulty')))}`
    },
  },
  {
    id: 'auto-batch',
    name: '自动批量',
    category: 'auto',
    description: '解锁自动化的"买最大"模式,每级使批量购买数量翻倍',
    maxAmount: new Decimal(10),
    //10+10n
    cost: linear({ a: 10, b: 10, label: '自动批量价格' }),
    require: [],
    canBuy: () => hasAchievement('a21'),
    effectText() {
      return `每次购买 ${formatWhole(new Decimal(2).pow(knowledgeAmount('auto-batch')))} 个`
    },
  },
  {
    id: 'max-buy',
    name: '最大购买',
    category: 'auto',
    description: '解锁层级页"购买模式"开关(买1个/买最大)和"全部最大"按钮(快捷键M)',
    maxAmount: new Decimal(1),
    cost: constantCurve(25),
    require: [['auto-batch', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'auto-upgrade',
    name: '升级自动化',
    category: 'auto',
    description: '解锁自动购买升级机制',
    maxAmount: new Decimal(1),
    cost: constantCurve(50),
    require: [['auto-batch', new Decimal(1)]],
    canBuy: () => true,
  },
  {
    id: 'knowledge-achievement',
    name: '成就知识',
    category: 'knowledge',
    description: '每个已解锁的普通成就使知识获取+1%，效果叠加',
    maxAmount: new Decimal(1),
    cost: constantCurve(64),
    require: [['bonus-achievement', new Decimal(1)]],
    canBuy: () => true,
    effect: {
      target: 'knowledgeGain',
      type: 'mul',
      static: true,
      value: () => new Decimal(0.01).mul(getUnlockedNormalAchievementCount()).add(1),
      text: '知识获取 x{value}',
    },
  },
  {
    id: 'auto-global-config',
    name: '全局配置',
    category: 'auto',
    description: '解锁自动化全局配置',
    maxAmount: new Decimal(1),
    cost: constantCurve(100),
    require: [['auto-upgrade', new Decimal(1)]],
    canBuy: () => hasAchievement('a51'),
  },
  {
    id: 'boost-infinity',
    name: '无限点数加成',
    category: 'bonus',
    description: '无限点数获取+20%每级,效果叠加',
    maxAmount: new Decimal(5),
    //5+5n(线性增长:只有线性/几何族的解析和才能把"买最大"算准)
    cost: linear({ a: 50, b: 50, label: '无限点数加成价格' }),
    require: [],
    canBuy: () => hasAchievement('a51'),
    effect: {
      target: 'infinityGain',
      type: 'mul',
      static: true,
      value: () => new Decimal(0.2).mul(knowledgeAmount('boost-infinity')).add(1),
      text: '无限点数获取 x{value}',
    },
  },
]

/**增加知识(经过加成管道后)
 * @returns 实际增加的知识
 */
export function addKnowledge(value: Decimal): Decimal {
  value = applyTo('knowledgeGain', value)
  player.knowledge = player.knowledge.add(value)
  return value
}

/**获取某知识升级的定义 */
export function getKnowledgeUpgrade(id: string): KnowledgeUpgradeDef | undefined {
  return KNOWLEDGE_UPGRADES.find((k) => k.id == id)
}
/**某知识升级的已购数量 */
export function knowledgeAmount(id: string): Decimal {
  return player.knowledgeUpgrades[id] || new Decimal(0)
}
/**某知识升级是否已购买至少1次 */
export function hasKnowledge(id: string): boolean {
  return knowledgeAmount(id).gte(1)
}
/**答题储存上限(知识升级"答题储存"的等级;0表示冷却结束后不储存答题次数) */
export function quizStoreLimit(): number {
  return knowledgeAmount('quiz-store').toNumber()
}
/**离线时间上限(秒)=基准6小时+已购"离线延长"等级×1小时 */
export function offlineTimeLimit(): Decimal {
  return new Decimal(OFFLINE_LIMIT_BASE).add(
    new Decimal(OFFLINE_LIMIT_PER_LEVEL).mul(knowledgeAmount('time-offline-limit')),
  )
}
/**离线时间的剩余空间(不超过上限;暂停/离线入账与知识兑换共用) */
export function offlineTimeRoom(): Decimal {
  return Decimal.max(0, offlineTimeLimit().sub(player.offlineTime))
}
/**某知识升级已购n个时下一个的价格 */
export function knowledgeCost(id: string): Decimal {
  const def = getKnowledgeUpgrade(id)
  if (!def) return Decimal.dInf
  return def.cost.at(knowledgeAmount(id))
}

/**
 * 知识升级作为可购买项(供maxBuyable/sumCost使用)
 * 知识价格不经加成管道,故曲线的求和/和逆可直接使用;买最大由此变成精确解
 */
export function knowledgeItem(id: string): BuyableItem {
  const def = getKnowledgeUpgrade(id)
  const owned = () => knowledgeAmount(id)
  const item: BuyableItem = {
    amount: owned,
    cost: (n) => (def ? def.cost.at(n) : Decimal.dInf),
  }
  const curve = def?.cost
  if (curve?.sum) item.sum = (k) => curve.sum!(owned(), k)
  if (curve?.sumInverse) item.sumInverse = (budget) => curve.sumInverse!(owned(), budget)
  return item
}
/**某知识升级是否已满级 */
export function isMaxed(def: KnowledgeUpgradeDef): boolean {
  return knowledgeAmount(def.id).gte(def.maxAmount)
}
/**某知识升级的前置是否满足 */
export function meetsRequire(def: KnowledgeUpgradeDef): boolean {
  return def.require.every(([id, n]) => knowledgeAmount(id).gte(n))
}
/**某知识升级当前是否可购买(前置/条件/满级/知识足够) */
export function canBuyKnowledgeUpgrade(def: KnowledgeUpgradeDef): boolean {
  if (!meetsRequire(def)) return false
  if (!def.canBuy()) return false
  if (isMaxed(def)) return false
  return player.knowledge.gte(knowledgeCost(def.id))
}
/**某知识升级当前是否显示(满级且隐藏时不显示,前置/条件不满足时不显示) */
export function canShow(def: KnowledgeUpgradeDef, hideMaxed: boolean): boolean {
  if (isMaxed(def) && hideMaxed) return false
  if (!meetsRequire(def)) return false
  if (!def.canBuy()) return false
  return true
}
/**所有已使用的升级类别(去重,保持定义顺序) */
export function getKnowledgeCategories(): string[] {
  const cats: string[] = []
  for (const k of KNOWLEDGE_UPGRADES) {
    if (!cats.includes(k.category)) cats.push(k.category)
  }
  return cats
}
/**获取某类别的所有知识升级 */
export function getUpgradesByCategory(cat: string): KnowledgeUpgradeDef[] {
  return KNOWLEDGE_UPGRADES.filter((k) => k.category == cat)
}

//------效果注册------
/**把知识升级定义转换为注册效果(购买后生效,数量可参与公式) */
function knowledgeEffect(def: KnowledgeUpgradeDef): RegisteredEffect | undefined {
  if (!def.effect) return undefined
  return {
    ...def.effect,
    id: `knowledge-${def.id}`,
    name: `知识升级-${def.name}`,
    isActive: (ctx) => def.effect!.isActive?.(ctx) ?? hasKnowledge(def.id),
  }
}

//自动注册各知识升级的数值效果
for (const def of KNOWLEDGE_UPGRADES) {
  const e = knowledgeEffect(def)
  if (e) registerEffect(e)
}

/**某知识升级的效果文字(自定义优先,否则从效果自动生成) */
export function knowledgeEffectText(def: KnowledgeUpgradeDef): string {
  if (def.effectText) return def.effectText()
  const e = knowledgeEffect(def)
  return e ? effectText(e) : ''
}

//------全局速度------
//加速的效果经加成管道注册,可在统计页查看明细

registerEffect({
  id: 'debug',
  name: '调试',
  target: 'psdSpeed',
  type: 'mul',
  value: () => temp.debugSpeed,
  isActive: () => temp.debugSpeed.gt(1),
  text: '全局速度 x{value}',
})

registerEffect({
  id: 'speed-boost',
  name: '加速',
  target: 'psdSpeed',
  type: 'mul',
  value: () => player.boostSpeed,
  isActive: () => player.boostSpeed.gt(1),
  text: '全局速度 x{value}',
})

/**当前全局速度(调试初始值经加成管道后的结果) */
export function getPsdSpeed(): Decimal {
  return applyTo('psdSpeed', new Decimal(1))
}

/**加速倍率档位(按time-overclock已购数解锁,始终包含1x与2x) */
export function getBoostPresets(): number[] {
  const tier = knowledgeAmount('time-overclock').toNumber()
  return [
    { mult: 1, unlocked: true },
    { mult: 2, unlocked: true },
    { mult: 5, unlocked: tier >= 1 },
    { mult: 15, unlocked: tier >= 2 },
    { mult: 60, unlocked: tier >= 3 },
  ]
    .filter((p) => p.unlocked)
    .map((p) => p.mult)
}
