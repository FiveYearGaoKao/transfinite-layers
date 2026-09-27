//无限元重置层的计算(只读)
//无限点数(IP)获取公式、无限升级定义与购买判定、数值效果经加成管道注册
//无限升级为5x5表格,id格式'iu'+行+列(如'iu11');第一行无限制,其余要求同列上一行已购买
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import {
  dimensionAmount,
  getBase,
  getPoints,
  getUnlockedNormalAchievementCount,
  totalChallengeCompletions,
} from '@/access'
import { INFINITY_UNLOCK_POINTS } from '@/data/constants'
import { isLayer0 } from '@/tools/ordinal'
import {
  applyTo,
  defineSlot,
  effectText,
  registerEffect,
  slotValue,
  type EffectDef,
  type RegisteredEffect,
} from './effects'

/**无限维度(iu33)的效果指数槽位(默认0.5;被iu43/ic5奖励提升) */
defineSlot('iu33:base', () => new Decimal(0.5), 'global')
const SLOT_IU33_SPEED = defineSlot('iu33:speed', () => new Decimal(1), 'global')

/**无限升级的配置 */
export interface InfinityUpgradeDef {
  /**id,格式'iu'+行+列(如'iu11'),行列为1~5 */
  id: string
  /**显示名称(占位,待策划) */
  name: string
  /**效果描述 */
  description: string
  /**价格(无限点数) */
  cost: DecimalSource
  /**数值效果(声明式,可省略;纯逻辑/解锁型升级不填) */
  effect?: EffectDef
  /**购买效果的文字说明(缺省从effect自动生成) */
  effectText?(): string
}

/**已购买的无限升级数量 */
export function infinityUpgradeCount(): Decimal {
  return new Decimal(player.infinityUpgrades.length)
}

/**所有已定义的无限升级(5x5共25格) */
export const INFINITY_UPGRADES: InfinityUpgradeDef[] = [
  {
    id: 'iu11',
    name: '总量加成',
    description: '根据累计获得的无限点数提升所有维度乘数',
    cost: 1,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      value: () => player.totalInfinityPoints.add(1).ln().add(1).pow(2),
      text: '所有维度乘数 x{value}',
    },
  },
  {
    id: 'iu12',
    name: '点数作用强化',
    description: '点数作用(升级u1)的效果指数+1',
    cost: 2,
    effect: {
      target: 'u1:base',
      type: 'add',
      //只随已购无限升级数变化,可进帧内计划
      static: true,
      value: () => new Decimal(1),
      text: '点数作用指数 +{value}',
    },
  },
  {
    id: 'iu13',
    name: '能量涌动',
    description: '每购买1个无限升级,能量指数+0.006',
    cost: 3,
    effect: {
      target: 'energy:base',
      type: 'add',
      static: true,
      value: () => new Decimal(0.006).mul(infinityUpgradeCount()),
      text: '能量指数 +{value}',
    },
  },
  {
    id: 'iu14',
    name: '自动化永存I',
    description: '升级u4(自动化1)不会被普通层级重置',
    cost: 5,
  },
  {
    id: 'iu15',
    name: '无限挑战',
    description: '解锁无限挑战',
    cost: 100,
  },
  {
    id: 'iu21',
    name: '逆流永驻',
    description: '成就"逆流而上"的效果衰减速度慢60倍',
    cost: 5,
    effect: {
      target: 'a41:decay',
      type: 'custom',
      static: true,
      value: () => new Decimal(1).div(60),
    },
    //离散型效果,数值本身无玩家可读意义,统一显示"已解锁/未解锁"
    effectText() {
      return hasInfinityUpgrade('iu21') ? '已解锁' : '未解锁'
    },
  },
  {
    id: 'iu22',
    name: '加倍器降价',
    //基础价格为base^2(进制为10时是100),不恒为100;购买后价格指数2→0,基础价格恒降为1
    description: '加倍器基础价格降至1',
    cost: 10,
    effect: {
      target: 'b12:costBase',
      type: 'custom',
      static: true,
      value: () => new Decimal(0),
    },
    //离散型效果(基础价格受序数进制影响,不恒为100),统一显示"已解锁/未解锁"
    effectText() {
      return hasInfinityUpgrade('iu22') ? '已解锁' : '未解锁'
    },
  },
  {
    id: 'iu23',
    name: '加倍器强化',
    description: '每购买1个无限升级,加倍器底数+0.04',
    cost: 32,
    effect: {
      target: 'b12:base',
      type: 'add',
      static: true,
      value: () => new Decimal(0.04).mul(infinityUpgradeCount()),
      text: '加倍器底数 +{value}',
    },
  },
  {
    id: 'iu24',
    name: '自动化永存II',
    description: '升级u5(自动化2)不会被普通层级重置',
    cost: 25,
  },
  {
    id: 'iu25',
    name: '元维度提升',
    description: '解锁元维度提升',
    cost: 1e10,
  },
  {
    id: 'iu31',
    name: '成就点数',
    description: '普通层级重置之后保留至多(当前解锁普通成就总量)的点数',
    cost: 50,
    effectText() {
      return `保留 ${getUnlockedNormalAchievementCount()} 点数`
    },
  },
  {
    id: 'iu32',
    name: '挑战能量',
    description: '能量指数+0.05,仅在挑战中生效',
    cost: 80,
    effect: {
      target: 'energy:base',
      type: 'add',
      static: true,
      value: () => new Decimal(0.05),
      isActive: () => player.activeChallenges.length > 0,
      text: '能量指数 +{value}',
    },
  },
  {
    id: 'iu33',
    name: '无限维度',
    description: '根据本次无限经过的秒数提升所有维度乘数',
    cost: 100,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      base: 'iu33:base',
      value: (_ctx, base) =>
        player.infinityRunTime
          .mul(slotValue(SLOT_IU33_SPEED))
          .add(1)
          .pow(base ?? new Decimal(0.5)),
      text: '所有维度乘数 x{value}',
    },
    //效果文本用槽位组合值计算(iu43会提升指数),直接读取实时值
  },
  {
    id: 'iu34',
    name: '自动化永存III',
    description: '升级u6(自动重置)不会被普通层级重置',
    cost: 125,
  },
  {
    id: 'iu35',
    name: '元星系',
    description: '解锁元星系',
    cost: 1e308,
  },
  {
    id: 'iu41',
    name: '加速器豁免',
    description: '购买加速器加成不重置任何东西',
    cost: 500,
    effectText() {
      return hasInfinityUpgrade('iu41') ? '已解锁' : '未解锁'
    },
  },
  {
    id: 'iu42',
    name: '加速器降价',
    description: '加速器加成的价格指数/2',
    cost: 1000,
    effect: {
      target: 'b13:costMult',
      type: 'mul',
      static: true,
      value: () => new Decimal(0.5),
    },
    //离散型效果,数值本身无玩家可读意义,统一显示"已解锁/未解锁"
    effectText() {
      return hasInfinityUpgrade('iu42') ? '已解锁' : '未解锁'
    },
  },
  {
    id: 'iu43',
    name: '无限维度强化',
    description: '根据无限点数提升"无限维度"的效果指数',
    cost: 2500,
    effect: {
      target: 'iu33:base',
      type: 'add',
      value: () => player.infinityPoints.add(1).log(getBase()).sqrt().mul(0.2),
      text: '无限维度效果指数 +{value}',
    },
  },
  {
    id: 'iu44',
    name: '自动化永存IV',
    description: '升级u7(能量保留)不会被普通层级重置',
    cost: 625,
  },
  {
    id: 'iu45',
    name: '元声望升级',
    description: '解锁元声望升级',
    cost: 1e308,
    //TODO: 元声望升级机制待实现
  },
  {
    id: 'iu51',
    name: '零层指数',
    description: '层级0的维度指数+0.1',
    cost: 1e4,
    effect: {
      target: 'dimensionExponent',
      type: 'add',
      static: true,
      value: () => new Decimal(0.1),
      isActive: (ctx) => isLayer0(ctx.pos),
      text: '层级0维度指数 +{value}',
    },
  },
  {
    id: 'iu52',
    name: '软上限削弱',
    description: '根据完成普通挑战的总数削弱价格软上限的强度',
    cost: 1e5,
    effect: {
      target: 'priceCap:power',
      type: 'exp',
      static: true,
      value: () => new Decimal(0.999).pow(totalChallengeCompletions().min(1000)),
      text: '软上限强度 ^{value}',
    },
  },
  {
    id: 'iu53',
    name: '自协同EX',
    description: '所有维度产量x1.1^(该维度已购)',
    cost: 1e8,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      //只读"已购维度数量"(type=1),可进帧内计划
      static: true,
      value: (ctx) => new Decimal(1.1).pow(dimensionAmount(ctx.pos, ctx.id, 1)),
      text: '维度产量 x{value}',
    },
  },
  {
    id: 'iu54',
    name: '自动化永存V',
    description: '升级u8(升级保留)不会被普通层级重置',
    cost: 3125,
  },
  {
    id: 'iu55',
    name: '锻造',
    description: '解锁锻造',
    cost: 1e308,
    //TODO: 锻造机制待实现
  },
]

/**获取某无限升级的定义 */
export function getInfinityUpgrade(id: string): InfinityUpgradeDef | undefined {
  return INFINITY_UPGRADES.find((u) => u.id == id)
}

/**获取所有已定义的无限升级 */
export function getInfinityUpgrades(): InfinityUpgradeDef[] {
  return INFINITY_UPGRADES.slice()
}

/**某无限升级是否已购买 */
export function hasInfinityUpgrade(id: string): boolean {
  return player.infinityUpgrades.includes(id)
}

/**某列已购买的无限升级数量(列从1开始,如iu12的"本列"为第2列) */
export function infinityUpgradeCountInColumn(col: number): Decimal {
  return new Decimal(player.infinityUpgrades.filter((x) => Number(x[3]) == col).length)
}

/**获取某无限升级的价格 */
export function infinityUpgradeCost(id: string): Decimal {
  const def = getInfinityUpgrade(id)
  return def ? new Decimal(def.cost) : Decimal.dInf
}

/**判断某无限升级能否购买(未购买、同列上一行已购买、无限点数足够) */
export function canBuyInfinityUpgrade(id: string): boolean {
  const def = getInfinityUpgrade(id)
  if (!def) return false
  if (hasInfinityUpgrade(id)) return false
  //第一行无限制,其余行要求同列上一行已购买
  const row = Number(id[2])
  const col = Number(id[3])
  if (row > 1 && !hasInfinityUpgrade(`iu${row - 1}${col}`)) return false
  return player.infinityPoints.gte(infinityUpgradeCost(id))
}

//------无限点数获取------
/**无限点数获取的基础公式:max(log₂(x+1)/64−15, 0),x为层级0点数
 * 1.79e308 时 log₂≈1024、/64≈15,恰好获得约1无限点 */
export function infinityGainBase(): Decimal {
  return getPoints([0]).add(1).log2().div(64).sub(15).max(0)
}

/**无限点数获取量:基础公式经infinityGain加成管道后向下取整(与普通层级重置收益一致) */
export function infinityGain(): Decimal {
  return applyTo('infinityGain', infinityGainBase()).floor()
}

/**能否进行无限重置(层级0点数达到1.79e308) */
export function canInfinityReset(): boolean {
  return getPoints([0]).gte(INFINITY_UNLOCK_POINTS)
}

//------效果注册------
/**把无限升级定义转换为注册效果(购买后生效,可叠加自定义生效条件) */
function infinityUpgradeEffect(u: InfinityUpgradeDef): RegisteredEffect | undefined {
  if (!u.effect) return undefined
  return {
    ...u.effect,
    id: `iu-${u.id}`,
    name: `无限升级-${u.name}`,
    //购买是必要条件,自定义生效条件(如iu32仅在挑战中、iu51仅层级0)叠加其上
    isActive: (ctx) => hasInfinityUpgrade(u.id) && (u.effect!.isActive?.(ctx) ?? true),
  }
}

//自动注册各无限升级的数值效果
for (const u of INFINITY_UPGRADES) {
  const e = infinityUpgradeEffect(u)
  if (e) registerEffect(e)
}

/**某无限升级的效果文字(裸值,不含"当前:"前缀;前缀由升级格组件统一添加) */
export function infinityUpgradeEffectValue(def: InfinityUpgradeDef): string {
  if (def.effectText) return def.effectText()
  const e = infinityUpgradeEffect(def)
  if (e) return effectText(e)
  return hasInfinityUpgrade(def.id) ? '已解锁' : '未解锁'
}
