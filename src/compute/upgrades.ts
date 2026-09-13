//升级的定义与计算
//升级是一次性的，每个升级有三种状态:无法购买、可以购买、已购买
//通用升级默认在层级1及以上出现，层级0只出现u2、u3，u9需层级2及以上解锁
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import {
  dimensionAmount,
  dimensionTotalBought,
  getBase,
  getLayer,
  getPoints,
  hasAchievement,
  levelGap,
  prevLayer,
} from '@/access'
import { compareLayer, isLayer0, nextLayer } from '@/tools/ordinal'
import { format } from '@/tools/format'
import {
  effectText,
  registerEffect,
  slotValue,
  type EffectDef,
  type RegisteredEffect,
} from './effects'
import { crossLayerExponentBonus } from './crossLayer'
import { DIMENSION_COUNT, U1_POINTS_EXPONENT } from '@/data/constants'

/**u3额外加速器:本层已购维度总等级×0.2 + 已购升级数量 */
const FREE_LEVEL_FACTOR = 0.2

/**点数作用的加成公式:ln(点数+1)+1 再取exponent次方 */
function u1Formula(points: Decimal, exponent: Decimal): Decimal {
  return points.add(1).ln().add(1).pow(exponent)
}

/**点数作用的当前指数(u1:base槽位的组合值) */
function u1Exponent(): Decimal {
  return slotValue({ target: 'u1:base', init: () => U1_POINTS_EXPONENT }, { pos: [0], id: 0 })
}

/**升级的配置 */
export interface UpgradeDef {
  id: number
  name: string
  description: string
  /**该升级适用的层级阶数 */
  order: number
  cost(layer: LayerId): Decimal
  /**数值效果(声明式,可省略) */
  effect?: EffectDef
  /**购买效果的文字说明(缺省从effect自动生成) */
  effectText?(layer: LayerId): string
  /**是否解锁该升级，默认一直解锁 */
  isUnlocked?(layer: LayerId): boolean
  /**前置升级，需先在本层购买 */
  requires?: number[]
}

/**所有已定义的升级 */
export const UPGRADES: UpgradeDef[] = [
  {
    id: 1,
    name: '点数作用',
    description: '根据本层点数，加成{prevLayer}点数获取',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase())
    },
    effect: {
      target: 'pointsGain',
      type: 'mul',
      base: { target: 'u1:base', init: () => U1_POINTS_EXPONENT },
      value(ctx, base) {
        //0阶内容的加成来源:nextLayer(pos,0)(同窗口的下一槽位),来源不存在则不生效
        //跨层时该来源的加成被强化为 value^reward^(gap-1),即指数×reward^(gap-1)
        const source = nextLayer(ctx.pos, 0)
        const S = getLayer(source)
        if (!S || !hasUpgrade(source, 1)) return 1
        const exponent = crossLayerExponentBonus(base ?? new Decimal(1), levelGap(source))
        return u1Formula(S.points, exponent)
      },
      isActive: (ctx) => {
        const source = nextLayer(ctx.pos, 0)
        return !!getLayer(source) && hasUpgrade(source, 1)
      },
    },
    effectText(layer: LayerId): string {
      //本层(已购u1)对下层的加成数值,含跨层强化
      const exponent = crossLayerExponentBonus(u1Exponent(), levelGap(layer))
      return `x${format(u1Formula(getPoints(layer), exponent))}`
    },
    isUnlocked: (layer: LayerId) => !isLayer0(layer),
  },
  {
    id: 2,
    name: '自协同',
    description: '本层每个维度的产量 x(该维度已购+1)',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).div(2).floor().pow(2)
    },
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      value: (ctx) => dimensionAmount(ctx.pos, ctx.id, 1).add(1),
    },
    //自协同对不同维度的加成数值不同,效果行显示当前数值范围(最小值~最大值)而非单一值
    effectText(layer: LayerId): string {
      let lo = new Decimal(Infinity)
      let hi = new Decimal(0)
      for (let i = 0; i < DIMENSION_COUNT; i++) {
        const v = dimensionAmount(layer, i, 1).add(1)
        lo = Decimal.min(lo, v)
        hi = Decimal.max(hi, v)
      }
      return `x${format(lo)}~x${format(hi)}`
    },
    isUnlocked: (_layer: LayerId) => true,
  },
  {
    id: 3,
    name: '额外加速器',
    description: '根据本层已购买的维度与升级总数提供额外加速器等级',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).pow(getBase() * 2)
    },
    effect: {
      target: 'b11:amount',
      type: 'add',
      value: (ctx) => {
        const L = getLayer(ctx.pos)
        if (!L) return 0
        return dimensionTotalBought(ctx.pos).mul(FREE_LEVEL_FACTOR).add(L.upgrades.length).floor()
      },
      text: '+{value}',
    },
    isUnlocked: (_layer: LayerId) => hasAchievement('a16'),
  },
  {
    id: 4,
    name: '自动化1',
    description: '解锁{prevLayer}维度自动购买',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).pow(2)
    },
    isUnlocked: (layer: LayerId) => !isLayer0(layer),
  },
  {
    id: 5,
    name: '自动化2',
    description: '解锁{prevLayer}加速器和加倍器自动购买',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).pow(2).mul(3)
    },
    isUnlocked: (layer: LayerId) => !isLayer0(layer),
    requires: [4],
  },
  {
    id: 6,
    name: '自动重置',
    description: '解锁{currentLayer}自动重置',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).pow(3)
    },
    isUnlocked: (layer: LayerId) => !isLayer0(layer),
    requires: [5],
  },
  {
    id: 7,
    name: '能量保留',
    description: '本层重置时不重置本层能量和维度数量',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).pow(2).mul(5)
    },
    isUnlocked: (layer: LayerId) => !isLayer0(layer),
  },
  {
    id: 8,
    name: '升级保留',
    description: '本层重置时保留下层升级',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).pow(3).mul(5)
    },
    isUnlocked: (layer: LayerId) => !isLayer0(layer),
    requires: [7],
  },
  {
    id: 9,
    name: '软重置',
    description: '下层每秒获得100%重置获得过的最高点数',
    order: 0,
    cost(): Decimal {
      return new Decimal(getBase()).pow(5)
    },
    isUnlocked: (layer: LayerId) => compareLayer(layer, [2]) >= 0,
    requires: [8],
    effectText(layer) {
      return `+${format(getLayer(prevLayer(layer))?.bestPoints ?? new Decimal(0))}/s`
    },
  },
]

/**获取某升级的定义 */
export function getUpgrade(id: number): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id == id)
}
/**获取某阶层级可显示的所有升级 */
export function getUpgrades(order: number): UpgradeDef[] {
  return UPGRADES.filter((u) => u.order == order)
}
/**判断某升级是否已购买 */
export function hasUpgrade(layer: LayerId, id: number): boolean {
  return getLayer(layer)?.upgrades.includes(id) || false
}
/**获取某升级的成本 */
export function upgradeCost(layer: LayerId, id: number): Decimal {
  const def = getUpgrade(id)
  if (!def) return Decimal.dInf
  return def.cost(layer)
}
/**判断某升级是否已解锁 */
export function isUnlocked(layer: LayerId, id: number): boolean {
  const def = getUpgrade(id)
  if (!def) return true
  return def.isUnlocked?.(layer) ?? true
}
/**判断某升级能否购买(未购买、已解锁、前置已购买、点数足够) */
export function canBuyUpgrade(layer: LayerId, id: number): boolean {
  const def = getUpgrade(id)
  if (!def) return false
  const L = getLayer(layer)
  if (!L) return false
  if (hasUpgrade(layer, id)) return false
  if (!isUnlocked(layer, id)) return false
  if (def.requires?.some((r) => !hasUpgrade(layer, r))) return false
  return L.points.gte(upgradeCost(layer, id))
}

//------效果注册------
/**把升级定义转换为注册效果(购买后生效) */
function upgradeEffect(u: UpgradeDef): RegisteredEffect | undefined {
  if (!u.effect) return undefined
  return {
    ...u.effect,
    id: `upgrade-${u.id}`,
    name: u.name,
    //未购买时不生效;效果可自定义生效条件(如u1作用于上层)
    isActive: (ctx) => u.effect!.isActive?.(ctx) ?? hasUpgrade(ctx.pos, u.id),
  }
}

//自动注册各升级的数值效果
for (const u of UPGRADES) {
  const e = upgradeEffect(u)
  if (e) registerEffect(e)
}

/**某升级的效果文字(裸值,不含"当前:"前缀;前缀由升级按钮组件统一添加) */
export function upgradeEffectValue(def: UpgradeDef, layer: LayerId): string {
  if (def.effectText) return def.effectText(layer)
  const e = upgradeEffect(def)
  if (e) return effectText(e, { pos: layer, id: 0 })
  return hasUpgrade(layer, def.id) ? '已解锁' : '未解锁'
}
