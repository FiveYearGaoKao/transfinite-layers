//无限元重置层的计算(只读)
//无限点数(IP)获取公式、无限升级定义与购买判定、数值效果经加成管道注册
//无限升级为5x5表格,id格式'iu'+行+列(如'iu11');第一行无限制,其余要求同列上一行已购买
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import { getPoints, getUnlockedNormalAchievementCount } from '@/access'
import { INFINITY_UNLOCK_POINTS } from '@/data/constants'
import { format } from '@/tools/format'
import {
  calculate,
  effectText,
  registerEffect,
  type EffectDef,
  type RegisteredEffect,
} from './effects'

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

/**所有已定义的无限升级(未写出的升级暂无定义,UI显示占位格) */
export const INFINITY_UPGRADES: InfinityUpgradeDef[] = [
  {
    id: 'iu11',
    name: '无限力量',
    description: '根据无限重置次数提升所有维度乘数',
    cost: 1,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      value: () => player.infinityResets.add(1),
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
      value: () => 1,
      text: '点数作用指数 +{value}',
    },
  },
  {
    id: 'iu13',
    name: '能量涌动',
    description: '每购买1个无限升级,能量指数+0.005',
    cost: 3,
    effect: {
      target: 'energy:base',
      type: 'add',
      value: () => new Decimal(0.005).mul(infinityUpgradeCount()),
      text: '能量指数 +{value}',
    },
  },
  {
    id: 'iu14',
    name: '自动化永存',
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
    description: '成就"逆流而上"的效果衰减速度慢10倍',
    cost: 5,
    effect: {
      target: 'a41:decay',
      type: 'custom',
      value: () => 0.1,
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
      value: () => 0,
    },
    //离散型效果(基础价格受序数进制影响,不恒为100),统一显示"已解锁/未解锁"
    effectText() {
      return hasInfinityUpgrade('iu22') ? '已解锁' : '未解锁'
    },
  },
  {
    id: 'iu23',
    name: '加倍器强化',
    description: '每购买1个无限升级,加倍器底数+0.08',
    cost: 40,
    effect: {
      target: 'b12:base',
      type: 'add',
      value: () => new Decimal(0.08).mul(infinityUpgradeCount()),
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
    cost: 1e4,
  },
  {
    id: 'iu31',
    name: '成就点数',
    description: '普通层级重置之后保留(当前解锁普通成就总量)的点数',
    cost: 80,
    effectText() {
      return `保留 ${getUnlockedNormalAchievementCount()} 点数`
    },
  },
  {
    id: 'iu32',
    name: '挑战能量',
    description: '能量指数+0.05,仅在挑战中生效',
    cost: 100,
    effect: {
      target: 'energy:base',
      type: 'add',
      value: () => 0.05,
      isActive: () => player.activeChallenges.length > 0,
      text: '能量指数 +{value}',
    },
  },
  {
    id: 'iu33',
    name: '无限维度',
    description: '根据当前无限点数提供维度4乘数,在1e300无限点数时达到上限',
    cost: 200,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      value: () =>
        Decimal.min(player.infinityPoints, new Decimal(1e300))
          .add(1)
          .pow(1 / 3),
      isActive: (ctx) => ctx.id == 3,
      text: '维度4乘数 x{value}',
    },
    //效果文本须按维度4(id==3)的生效条件计算,否则会显示中性值x1
    effectText() {
      const v = Decimal.min(player.infinityPoints, new Decimal(1e300))
        .add(1)
        .pow(1 / 3)
      return `维度4乘数 x${format(v)}`
    },
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
    cost: 1e6,
  },
  {
    id: 'iu41',
    name: '加速器降价',
    description: '加速器加成的价格指数4→3',
    cost: 1000,
    effect: {
      target: 'b13:costMult',
      type: 'custom',
      value: () => 3,
    },
    //离散型效果,数值本身无玩家可读意义,统一显示"已解锁/未解锁"
    effectText() {
      return hasInfinityUpgrade('iu41') ? '已解锁' : '未解锁'
    },
  },
  {
    id: 'iu44',
    name: '自动化永存IV',
    description: '升级u7(能量保留)不会被普通层级重置',
    cost: 625,
  },
  {
    id: 'iu54',
    name: '自动化永存V',
    description: '升级u8(升级保留)不会被普通层级重置',
    cost: 3125,
    //TODO: 备选方案"解锁自动无限重置"留待后续,解锁途径(无限升级/成就/知识升级/挑战)未定
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
/**无限点数获取的基础公式:max(√(log₂(x+1))−31, 0),x为层级0点数
 * 1.79e308 时 log₂≈1024、√≈32,恰好获得约1无限点 */
export function infinityGainBase(): Decimal {
  const v = getPoints([0]).add(1).log2().sqrt().sub(31)
  return Decimal.max(v, 0)
}

/**无限点数获取量:基础公式经infinityGain加成管道后向下取整(与普通层级重置收益一致) */
export function infinityGain(): Decimal {
  return calculate('infinityGain', { pos: [0], id: 0 }, infinityGainBase()).floor()
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
    name: u.name,
    //购买是必要条件,自定义生效条件(如iu32仅在挑战中、iu33仅维度4)叠加其上
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
  if (e) return effectText(e, { pos: [0], id: 0 })
  return hasInfinityUpgrade(def.id) ? '已解锁' : '未解锁'
}
