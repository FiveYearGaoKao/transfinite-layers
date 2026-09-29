//成就注册表
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import {
  challengeCompletions,
  compareHeight,
  dimensionAmount,
  getEnergy,
  getLayer,
  getLayerHeight,
  getOrderedLayers,
  getPoints,
  hasAchievement,
  hasAnyUpgrade,
  isChallengeActive,
  registerNormalAchievement,
  normalChallengeCompletions,
} from '@/access'
import { buyableAmount } from '@/compute/buyables'
import { dimensionCost, dimensionMultiplier } from '@/compute/dimensions'
import {
  defineSlot,
  effectValueById,
  registerEffect,
  slotValue,
  type EffectDef,
  type RegisteredEffect,
} from '@/compute/effects'
import { addLog } from '@/data/log'
import { temp } from '@/data/temp'
import { NEWS_COUNT } from '@/app/news'
import type { LayerId } from '@/data/types'
import { compareLayer } from '@/tools/ordinal'
import { hasInfinityUpgrade } from '@/compute/infinity'
import { addKnowledge } from '@/compute/knowledge'
import { clearFrameCache } from '@/compute/frameCache'

/**成就"逆流而上"(a41)的衰减速度槽位(默认1;无限升级iu21降为1/60) */
const SLOT_A41_DECAY = defineSlot('a41:decay', () => new Decimal(1), 'global')

/**成就的公共字段 */
interface AchievementBase {
  id: string
  name: string
  description: string
  /**是否为隐藏成就(未解锁时名称/描述显示"???",奖励固定1知识) */
  secret?: boolean
  /**知识奖励 */
  reward: DecimalSource
  /**数值效果(声明式,解锁后全局生效) */
  effect?: EffectDef
  /**额外效果的文字说明(tooltip第二行) */
  effectText?: string
}

/**层级重置(晋升)瞬间的判定参数:必须在清空点数/能量之前求值(见logic/reset的doReset) */
export interface ResetEvent {
  layer: LayerId
  gain: Decimal
}
/**无限重置瞬间的判定参数(只统计真实重置,强制重置不触发) */
export interface InfinityResetEvent {
  gain: Decimal
}

/**
 * 成就定义:按"触发时机"分四类,`isCompleted` 的参数由触发时机决定
 * - 缺省/`'frame'`:每帧检查一次(条件在任何时刻读都成立)
 * - `'reset'`:层级重置瞬间检查,拿到当层与当次收益(如"1秒内重置""单次获得N点"这类瞬时条件)
 * - `'infinity'`:无限重置瞬间检查(在删层之前求值)
 * - `'manual'`:没有可判定的条件,只能由 `unlockAchievementById` 触发(须在别处显式调用)
 */
export type AchievementDef =
  | (AchievementBase & { trigger?: 'frame'; isCompleted(): boolean })
  | (AchievementBase & { trigger: 'reset'; isCompleted(ev: ResetEvent): boolean })
  | (AchievementBase & { trigger: 'infinity'; isCompleted(ev: InfinityResetEvent): boolean })
  | (AchievementBase & { trigger: 'manual' })

/**各触发时机对应的成就类型(分桶用:让桶里 isCompleted 的参数是确定的) */
type FrameAchievement = Extract<AchievementDef, { trigger?: 'frame' }>
type ResetAchievement = Extract<AchievementDef, { trigger: 'reset' }>
type InfinityAchievement = Extract<AchievementDef, { trigger: 'infinity' }>

/**
 * "获得至少1个层级N点数"类成就的重置触发判据
 * 层级引用一律用**绝对高度**(`getLayerHeight`,与"层级N"的命名口径一致),不用坐标
 * @param ev 重置事件
 * @param targetLayer 目标层级的绝对高度(如 `[2]` 表示层级2)
 * @returns 本次重置是否就是目标层的晋升,且确实给该层发了至少1点数
 * 注:收益已由 resetGain 向下取整,拿不到点数时 gain 为 0,故 `gte(1)` 就是"拿到了点数";
 *     判定发生在收益发放之前(logic/reset.ts),所以这里看的是 gain 而不是该层的当前点数
 */
function gotLayerPoints(ev: ResetEvent, targetLayer: DecimalSource[]): boolean {
  const height = getLayerHeight(ev.layer)
  return !!height && compareHeight(height, targetLayer) == 0 && ev.gain.gte(1)
}

const normalAchievements: AchievementDef[] = [
  {
    id: 'a11',
    name: '第一桶金',
    description: '购买层级0维度1',
    reward: 1,
    isCompleted: () => dimensionAmount([0], 0, 1).gte(1),
  },
  {
    id: 'a12',
    name: '梅开二度',
    description: '购买层级0维度2',
    reward: 1,
    isCompleted: () => dimensionAmount([0], 1, 1).gte(1),
  },
  {
    id: 'a13',
    name: '三生万物',
    description: '购买层级0维度3',
    reward: 2,
    isCompleted: () => dimensionAmount([0], 2, 1).gte(1),
  },
  {
    id: 'a14',
    name: '四维时空',
    description: '购买层级0维度4',
    reward: 2,
    isCompleted: () => dimensionAmount([0], 3, 1).gte(1),
  },
  {
    id: 'a15',
    name: '后面没了?',
    description: '购买4个层级0维度4',
    reward: 3,
    isCompleted: () => dimensionAmount([0], 3, 1).gte(4),
  },
  {
    id: 'a16',
    name: '转生!',
    description: '获得至少1个层级1点数',
    reward: 3,
    effectText: '解锁升级：额外加速器',
    trigger: 'reset',
    isCompleted: (ev) => gotLayerPoints(ev, [1]),
  },
  {
    id: 'a17',
    name: '充满力量',
    description: '获得至少100层级1能量',
    reward: 3,
    isCompleted: () => getEnergy([1]).gte(100),
  },
  {
    id: 'a18',
    name: '还是维度?',
    description: '购买层级1维度2',
    reward: 3,
    isCompleted: () => dimensionAmount([1], 1, 1).gte(1),
  },
  {
    id: 'a21',
    name: '解放双手',
    description: '解锁全部类型的自动化',
    reward: 3,
    isCompleted: () => hasAnyUpgrade(4) && hasAnyUpgrade(5) && hasAnyUpgrade(6),
  },
  {
    id: 'a22',
    name: '加速器满仓',
    description: '购买至少80个层级0加速器',
    reward: 3,
    effectText: '解锁可购买：加速器加成',
    isCompleted: () => buyableAmount([0], 11).gte(80),
  },
  {
    id: 'a23',
    name: '反客为主1',
    description: '在层级0中，使维度1的乘数<维度2的乘数<...<维度4的乘数',
    reward: 3,
    isCompleted: () =>
      [0, 1, 2].every((x) => dimensionMultiplier([0], x).lt(dimensionMultiplier([0], x + 1))),
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      static: true,
      value: (ctx) => new Decimal(ctx.id + 1),
      text: '维度乘数 x{value}',
    },
    effectText: '使每个维度获得等于其编号的乘数',
  },
  {
    id: 'a24',
    name: '速通高手',
    description: '在1秒内进行层级1的重置',
    reward: 4,
    effectText: '每层重置后保留1点数',
    trigger: 'reset',
    isCompleted: ({ layer }) =>
      compareLayer(layer, [1]) == 0 && (getLayer([0])?.resetTime.lt(1) ?? false),
  },
  {
    id: 'a25',
    name: '转生，再一次',
    description: '获得至少1个层级2点数',
    reward: 5,
    trigger: 'reset',
    isCompleted: (ev) => gotLayerPoints(ev, [2]),
  },
  {
    id: 'a26',
    name: '能量过载',
    description: '拥有至少1e16层级1能量',
    reward: 6,
    isCompleted: () => getEnergy([1]).gte(1e16),
  },
  {
    id: 'a27',
    name: '我需要能量吗',
    description: '在没有层级1能量时一次性获得100层级1点数',
    reward: 8,
    trigger: 'reset',
    isCompleted: ({ layer, gain }) =>
      compareLayer(layer, [1]) == 0 && getEnergy([1]).eq(0) && gain.gte(100),
    effect: {
      target: 'energy:base',
      type: 'add',
      static: true,
      value: () => new Decimal(0.01),
      text: '能量加成指数 +{value}',
    },
    effectText: '能量加成指数+0.01',
  },
  {
    id: 'a28',
    name: 'Googol',
    description: '拥有至少1e100层级0点数',
    reward: 10,
    isCompleted: () => getPoints([0]).gte(1e100),
    effectText: '解锁挑战',
  },
  {
    id: 'a31',
    name: '简单',
    description: '完成挑战1',
    reward: 5,
    isCompleted: () => challengeCompletions('c1').gte(1),
  },
  {
    id: 'a32',
    name: '一样简单',
    description: '完成挑战2',
    reward: 5,
    isCompleted: () => challengeCompletions('c2').gte(1),
  },
  {
    id: 'a33',
    name: '全速前进',
    description: '从层级0的加速器中获得至少x9.007e15的加成',
    reward: 15,
    isCompleted: () =>
      effectValueById('buyable-11', { pos: [0], id: 11 }).gte(Number.MAX_SAFE_INTEGER),
    effect: {
      target: 'b11:base',
      type: 'add',
      static: true,
      value: () => new Decimal(0.01),
      text: '加速器底数+{value}',
    },
    effectText: '加速器底数 +0.01',
  },
  {
    id: 'a34',
    name: '还有多少层?',
    description: '获得至少1个层级3点数',
    reward: 15,
    trigger: 'reset',
    isCompleted: (ev) => gotLayerPoints(ev, [3]),
  },
  {
    id: 'a35',
    name: '我需要重置吗',
    description: '第1次层级1重置获得10000点数',
    reward: 15,
    trigger: 'reset',
    isCompleted: ({ layer, gain }) =>
      compareLayer(layer, [1]) == 0 && (getLayer([1])?.resetCount.eq(0) ?? false) && gain.gte(1e4),
  },
  {
    id: 'a36',
    name: '并非软重置',
    description: '购买"软重置"升级',
    reward: 20,
    isCompleted: () => hasAnyUpgrade(9),
  },
  {
    id: 'a37',
    name: '挑战者',
    description: '完成普通挑战的总次数不少于10',
    reward: 20,
    isCompleted: () => normalChallengeCompletions().gte(10),
  },
  {
    id: 'a38',
    name: '半步无限',
    description: '拥有至少1.34e154(2^512)层级0点数',
    reward: 25,
    isCompleted: () => getPoints([0]).gte(new Decimal(2).pow(512)),
  },
  {
    id: 'a41',
    name: '逆流而上',
    description: '在挑战3中获得至少e^99(9.89e42)层级1能量',
    reward: 30,
    isCompleted: () => isChallengeActive('c3') && getEnergy([1]).gte(Math.exp(99)),
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      //衰减速度经a41:decay槽位修饰(默认1,无限升级iu21将其降为0.1使衰减慢10倍)
      value: (ctx) => {
        const decay = slotValue(SLOT_A41_DECAY, ctx)
        return new Decimal(10).root(
          new Decimal(getLayer(ctx.pos)?.resetTime || 0).mul(decay).add(1),
        )
      },
      text: '维度乘数 x{value}',
    },
    effectText: '所有维度产量x10，随重置时间迅速衰减',
  },
  {
    id: 'a42',
    name: '加倍器棋盘',
    description: '购买至少64个层级0加倍器',
    reward: 32,
    isCompleted: () => buyableAmount([0], 12).gte(64),
    effect: {
      target: 'b12:base',
      type: 'add',
      static: true,
      value: () => new Decimal(0.2),
      text: '维度乘数 x{value}',
    },
    effectText: '加倍器底数+0.2',
  },
  {
    id: 'a43',
    name: '古戈尔能量',
    description: '拥有至少1e100层级1能量',
    reward: 35,
    isCompleted: () => getEnergy([1]).gte(1e100),
  },
  {
    id: 'a44',
    name: '永无止境',
    description: '获得至少1个层级4点数',
    reward: 44,
    trigger: 'reset',
    isCompleted: (ev) => gotLayerPoints(ev, [4]),
  },
  {
    id: 'a45',
    name: '维度1之力',
    description: '在层级0中，不购买维度2或更高的维度达到1e50点数',
    reward: 35,
    isCompleted: () => {
      const L = getLayer([0])
      if (!L) return false
      if (L.points.lt(1e50)) return false
      for (let i = 1; i < L.dimensions.length; i++) {
        if (dimensionAmount([0], i).gt(0)) return false
      }
      return true
    },
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      static: true,
      value: (ctx) => new Decimal(ctx.id == 0 ? 5 : 1),
      text: '维度乘数 x{value}',
    },
    effectText: '维度1乘数 x5',
  },
  {
    id: 'a46',
    name: '失败者',
    description: '在挑战4中购买不该买的东西导致挑战失败',
    reward: 1,
    isCompleted: () => {
      if (!isChallengeActive('c4')) return false
      const L = getLayer([0])
      if (!L) return false
      //简单判定:层级0当前点数买不起任何维度,且所有维度数量=0
      for (let i = 0; i < L.dimensions.length; i++) {
        if (dimensionAmount([0], i).gt(0)) return false
        if (L.points.gte(dimensionCost([0], i))) return false
      }
      return true
    },
  },
  {
    id: 'a47',
    name: '它有用吗?',
    description: '购买层级1的加速器加成',
    reward: 40,
    isCompleted: () => buyableAmount([1], 13).gte(1),
    effect: {
      target: 'b11:amount',
      type: 'add',
      static: true,
      value: (ctx) => new Decimal(5).mul(buyableAmount(ctx.pos, 13)),
      text: '免费加速器数量+{value}',
    },
    effectText: '每个加速器加成提供5个免费的加速器',
  },
  {
    id: 'a48',
    name: '无限!',
    description: '拥有至少1.79e308层级0点数',
    reward: 99,
    isCompleted: () => getPoints([0]).gte(Number.MAX_VALUE),
  },
  {
    id: 'a51',
    name: '新的开始',
    description: '进行一次无限重置',
    reward: 10,
    isCompleted: () => player.infinityResets.gte(1),
    effectText: '解锁更多知识升级',
  },
  {
    id: 'a52',
    name: '∞是横着的8',
    description: '拥有恰好8无限点数',
    reward: 48,
    isCompleted: () => player.infinityPoints.eq(8),
  },
  {
    id: 'a53',
    name: '更多能量',
    description: '使层级1提供的能量加成指数>=0.33',
    reward: 50,
    isCompleted: () => slotValue('energy:base').gte(0.33),
  },
  {
    id: 'a54',
    name: '双倍无限',
    description: '拥有至少3.23e616层级0点数',
    reward: 60,
    isCompleted: () => getPoints([0]).gte('3.23e616'),
  },
  {
    id: 'a55',
    name: '挑战掌控者',
    description: '完成挑战1至挑战5各至少1次',
    reward: 64,
    isCompleted: () => ['c1', 'c2', 'c3', 'c4', 'c5'].every((x) => challengeCompletions(x).gte(1)),
  },
  {
    id: 'a56',
    name: '这很快',
    description: '在1分钟内无限重置',
    reward: 60,
    isCompleted: () => player.infinityBestResetTime.lte(60),
    effect: {
      target: 'infinityGain',
      type: 'mul',
      value: () => new Decimal(1.6).sub(player.infinityBestResetTime.clamp(0, 60).mul(0.01)),
      text: '无限点数 x{value}',
    },
    effectText: '根据无限重置最短时间加成无限点数获取',
  },
  {
    id: 'a57',
    name: '另一种维度?',
    description: '购买无限升级"无限维度"',
    reward: 77,
    isCompleted: () => hasInfinityUpgrade('iu33'),
  },
  {
    id: 'a58',
    name: '循环之中',
    description: '无限重置至少10次',
    reward: 80,
    isCompleted: () => player.infinityResets.gte(10),
  },
  {
    id: 'a61',
    name: '新的挑战',
    description: '完成无限挑战1',
    reward: 60,
    isCompleted: () => challengeCompletions('ic1').gte(1),
  },
  {
    id: 'a62',
    name: '这不容易',
    description: '完成无限挑战2',
    reward: 70,
    isCompleted: () => challengeCompletions('ic2').gte(1),
  },
  {
    id: 'a63',
    name: '可以挂机了?',
    description: '进行100次无限重置',
    reward: 80,
    isCompleted: () => player.infinityResets.gte(100),
  },
  {
    id: 'a64',
    name: '我需要层级吗',
    description: '不解锁其它层级进行无限重置',
    reward: 90,
    trigger: 'infinity',
    //无限重置删除除层级0外的0阶层级,故"只解锁过层级0"等价于此时层级表里只有层级0(判定在删层之前)
    isCompleted: () => getOrderedLayers('asc').length == 1,
    effect: {
      type: 'add',
      target: 'depthPoints:base',
      value: () => new Decimal(1),
    },
    effectText: '知识升级"深度加成"的底数+1',
  },
  {
    id: 'a65',
    name: '转瞬即逝',
    description: '在1毫秒内进行无限重置',
    reward: 100,
    isCompleted: () => player.infinityBestResetTime.lte(0.001),
  },
  {
    id: 'a66',
    name: '更上一层',
    description: '获得至少1个层级6点数',
    reward: 66,
    trigger: 'reset',
    isCompleted: (ev) => gotLayerPoints(ev, [6]),
  },
  {
    id: 'a67',
    name: '百炼成钢',
    description: '完成普通挑战的总次数不少于100',
    reward: 100,
    isCompleted: () => normalChallengeCompletions().gte(100),
  },
  {
    id: 'a68',
    name: '完美升级',
    description: '买完前4列无限升级',
    reward: 100,
    isCompleted: () => {
      for (let row = 1; row <= 5; row++) {
        for (let col = 1; col <= 4; col++) {
          if (!hasInfinityUpgrade(`iu${row}${col}`)) return false
        }
      }
      return true
    },
  },
  {
    id: 'a71',
    name: '22222',
    description: '拥有2.22e2222层级0点数',
    reward: 222,
    isCompleted: () => getPoints([0]).gte('2.22e2222'),
    effect: {
      target: 'infinityGain',
      type: 'mul',
      value: () => new Decimal(2.222),
      text: '无限点数 x{value}',
    },
    effectText: '无限点数获取 x2.222',
  },
  {
    id: 'a72',
    name: '第五...启动!',
    description: '购买层级0维度5',
    reward: 125,
    isCompleted: () => dimensionAmount([0], 4, 1).gte(1),
  },
  {
    id: 'a73',
    name: '维度之主',
    description: '进行4次元维度提升',
    reward: 128,
    isCompleted: () => player.metaDimensionBoosts.gte(4),
  },
  {
    id: 'a74',
    name: '无尽轮回',
    description: '进行1000次无限重置',
    reward: 100,
    isCompleted: () => player.infinityResets.gte(1000),
  },
  {
    id: 'a75',
    name: '无用的挑战',
    description: '在无限挑战5中完成普通挑战5至少5次',
    reward: 125,
    isCompleted: () => isChallengeActive('ic5') && challengeCompletions('c5').gte(5),
  },
  {
    id: 'a76',
    name: '纯粹的数值',
    description: '完成无限挑战4',
    reward: 150,
    isCompleted: () => challengeCompletions('ic4').gte(1),
  },
  {
    id: 'a77',
    name: '一步之遥',
    description: '获得至少1个层级9点数',
    reward: 144,
    trigger: 'reset',
    isCompleted: (ev) => gotLayerPoints(ev, [9]),
  },
  {
    id: 'a78',
    name: '十全十美',
    description: '解锁层级10...吗?',
    reward: 200,
    trigger: 'reset',
    isCompleted: (ev) => gotLayerPoints(ev, [10]),
  },
]

//------隐藏成就:较难获取,未解锁时名称作为提示,描述显示"???";奖励固定1知识------//
//s11/s14/s15/s16/s17/s18/s21/s22没有可判定的条件,只能由触发那一处的代码调用unlockAchievementById
const secretAchievements: AchievementDef[] = [
  {
    id: 's11',
    name: '自愿被骗',
    description: '点击滚动新闻中的rickroll超链接',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's12',
    name: '新闻收藏家',
    description: '看过所有的滚动新闻',
    secret: true,
    reward: 1,
    isCompleted: () => player.seenNews.length >= NEWS_COUNT,
  },
  {
    id: 's13',
    name: '运气不错',
    description: '连续3天签到的随机奖励大于90',
    secret: true,
    reward: 1,
    isCompleted: () => player.checkin.highStreak >= 3,
  },
  {
    id: 's14',
    name: '你是认真的?',
    description: '随机到问题"1 + 1"并回答错误',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's15',
    name: '作弊者',
    description: '尝试导入修改过的存档',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's16',
    name: '闪瞎狗眼',
    description: '连续切换主题100次,相邻两次间隔不超过1秒',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's17',
    name: '这里不是MC',
    description: '在指令框里输入Minecraft的指令',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's18',
    name: 'six-seven',
    description: '把自动化的所有配置项都设为67',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's21',
    name: '千年之后',
    description: '把时间调到1000年之后',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's22',
    name: '字面意思',
    description: '在存档框里输入"存档"或"save"后点击导入',
    secret: true,
    reward: 1,
    trigger: 'manual',
  },
  {
    id: 's23',
    name: '运气非常好',
    description: '在带随机数的新闻里得到一个大于9990的数',
    secret: true,
    reward: 1,
    //阈值取自新闻文案(>9900"运气很好"、>9990"运气非常好"):随机数由app/news写进temp,成就侧不反向引用app层
    isCompleted: () => temp.lastNewsRoll > 9990,
  },
]

/**注册一个普通成就 */
export function registerAchievement(def: AchievementDef) {
  normalAchievements.push(def)
  const e = achievementEffect(def)
  if (e) registerEffect(e)
  registerNormalAchievement(def.id)
  addToBucket(def)
}

/**获取所有成就(普通+隐藏) */
export function getAchievements(): AchievementDef[] {
  return [...normalAchievements, ...secretAchievements]
}

/**获取所有普通成就 */
export function getNormalAchievements(): AchievementDef[] {
  return normalAchievements
}

/**获取所有隐藏成就 */
export function getSecretAchievements(): AchievementDef[] {
  return secretAchievements
}

/**普通成就的数量(隐藏成就不计入) */
export function getAchievementCount(): number {
  return normalAchievements.length
}

/**解锁一个成就并发放知识奖励 */
function unlockAchievement(def: AchievementDef) {
  player.achievements.push(def.id)
  addKnowledge(new Decimal(def.reward))
  addLog('progress', `已解锁成就：${def.name}`)
  //成就可能带来数值效果(见下方achievementEffect):帧内缓存失效
  clearFrameCache()
}

/**按id直接解锁一个成就(触发型隐藏成就用;发放知识奖励并写日志) */
export function unlockAchievementById(id: string) {
  if (player.achievements.includes(id)) return
  const def = getAchievements().find((a) => a.id == id)
  if (def) unlockAchievement(def)
}

/**把成就定义转换为注册效果(解锁后全局生效) */
function achievementEffect(def: AchievementDef): RegisteredEffect | undefined {
  if (!def.effect) return undefined
  return {
    ...def.effect,
    id: `achievement-${def.id}`,
    name: `成就奖励-${def.name}`,
    isActive: () => hasAchievement(def.id),
  }
}

/**按触发时机分桶:帧循环只遍历frame那批,重置/无限重置各只遍历自己那批 */
const frameAchievements: FrameAchievement[] = []
const resetAchievements: ResetAchievement[] = []
const infinityAchievements: InfinityAchievement[] = []

/**把成就登记到它声明的触发时机对应的桶里(manual不参与任何自动检查,只能由unlockAchievementById触发) */
function addToBucket(def: AchievementDef) {
  if (def.trigger == 'reset') resetAchievements.push(def)
  else if (def.trigger == 'infinity') infinityAchievements.push(def)
  else if (def.trigger != 'manual') frameAchievements.push(def)
}

//自动注册各成就的数值效果,并登记普通成就id与触发时机分桶
for (const a of normalAchievements) {
  const e = achievementEffect(a)
  if (e) registerEffect(e)
  registerNormalAchievement(a.id)
  addToBucket(a)
}
for (const a of secretAchievements) {
  const e = achievementEffect(a)
  if (e) registerEffect(e)
  addToBucket(a)
}

/**检查所有"每帧"成就,达成则解锁并获得知识奖励 */
export function updateAchievements() {
  for (const def of frameAchievements) {
    if (!player.achievements.includes(def.id) && def.isCompleted()) unlockAchievement(def)
  }
}

/**检查所有"层级重置瞬间"成就(在doReset中调用,此时尚未清空能量/重置时间) */
export function checkResetAchievements(ev: ResetEvent) {
  for (const def of resetAchievements) {
    if (!player.achievements.includes(def.id) && def.isCompleted(ev)) unlockAchievement(def)
  }
}

/**检查所有"无限重置瞬间"成就(在doInfinityReset中调用,此时尚未删层) */
export function checkInfinityResetAchievements(ev: InfinityResetEvent) {
  for (const def of infinityAchievements) {
    if (!player.achievements.includes(def.id) && def.isCompleted(ev)) unlockAchievement(def)
  }
}
