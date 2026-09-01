//可购买的定义与计算
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { c4BoughtOffset, getBase, getLayer, hasAchievement } from '@/access'
import { hasInfinityUpgrade } from './infinity'
import { initializeDimensions } from '@/data/types'
import { format } from '@/tools/format'
import { softCap } from './softCap'
import {
  effectText,
  registerEffect,
  renderText,
  slotValue,
  type EffectDef,
  type RegisteredEffect,
} from './effects'

/**可购买的配置 */
export interface BuyableDef {
  id: number
  name: string
  description: string
  /**显示该可购买的层级阶数 */
  order: number
  /**已购n个时下一个的价格 */
  cost(layer: LayerId, n: Decimal): Decimal
  /**是否对该可购买的价格应用软上限(可选power覆盖默认) */
  softCap?: { power?: number }
  /**数值效果(声明式,可省略) */
  effect?: EffectDef
  /**购买效果的文字说明(缺省从effect自动生成) */
  effectText?(layer: LayerId, n: Decimal): string
  /**是否解锁该可购买，默认一直解锁 */
  isUnlocked?(layer: LayerId): boolean
  /**购买时的额外效果 */
  onBuy?(layer: LayerId): void
}

/**所有已定义的可购买 */
export const BUYABLES: BuyableDef[] = [
  {
    id: 11,
    name: '加速器',
    description: '所有维度生产+{basePercent}%，效果叠乘',
    order: 0,
    cost(_layer: LayerId, n: Decimal): Decimal {
      return new Decimal(getBase()).pow(n.div(2).add(1)).floor()
    },
    softCap: {},
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      base: { target: 'b11:base', init: () => 1.1 },
      amount: { target: 'b11:amount', init: (ctx) => buyableAmount(ctx.pos, 11) },
      text: '维度生产 x{value}',
    },
  },
  {
    id: 12,
    name: '加倍器',
    description: '点数获取x{base}，效果叠乘',
    order: 0,
    cost(_layer: LayerId, n: Decimal): Decimal {
      //10^[n*(1+q*n)+costBase],q为b12:quad槽位(可被挑战C2奖励降低),costBase为b12:costBase槽位(可被无限升级iu22降为0)
      const quad = slotValue({ target: 'b12:quad', init: () => 0.1 }, { pos: _layer, id: 0 })
      const costBase = slotValue({ target: 'b12:costBase', init: () => 2 }, { pos: _layer, id: 0 })
      return new Decimal(getBase()).pow(n.mul(n.mul(quad).add(1)).add(costBase)).floor()
    },
    effect: {
      target: 'pointsGain',
      type: 'mul',
      base: { target: 'b12:base', init: () => 2 },
      amount: { target: 'b12:amount', init: (ctx) => buyableAmount(ctx.pos, 12) },
      text: '点数获取 x{value}',
    },
  },
  {
    id: 13,
    name: '加速器加成',
    description: '使加速器的效果+2%，效果叠加',
    order: 0,
    isUnlocked: (_layer: LayerId) => hasAchievement('a22'),
    cost(_layer: LayerId, n: Decimal): Decimal {
      //base^(2^n * costMult * base),costMult为b13:costMult槽位(可被无限升级iu41由4降为3)
      const costMult = slotValue({ target: 'b13:costMult', init: () => 4 }, { pos: _layer, id: 0 })
      return new Decimal(getBase()).pow(new Decimal(2).pow(n).mul(costMult).mul(getBase()))
    },
    effect: {
      target: 'b11:base',
      type: 'add',
      value: (ctx) => buyableAmount(ctx.pos, 13).mul(0.02),
    },
    effectText(layer: LayerId, n: Decimal): string {
      return `加速器效果 +${format(new Decimal(2).mul(n))}%`
    },
    onBuy(layer: LayerId) {
      //无限升级iu41:购买加速器加成不重置任何东西
      if (hasInfinityUpgrade('iu41')) return
      const L = getLayer(layer)
      if (!L) return
      L.points = new Decimal(1)
      initializeDimensions(L)
      L.buyables[11] = new Decimal(0)
      L.buyables[12] = new Decimal(0)
    },
  },
]

/**获取某可购买的购买次数 */
export function buyableAmount(layer: LayerId, id: number): Decimal {
  return getLayer(layer)?.buyables[id] || new Decimal(0)
}
/**获取某可购买的定义 */
export function getBuyable(id: number): BuyableDef | undefined {
  return BUYABLES.find((b) => b.id == id)
}
/**获取某阶层级可显示的所有可购买 */
export function getBuyables(order: number): BuyableDef[] {
  return BUYABLES.filter((b) => b.order == order)
}
/**判断某可购买是否解锁 */
export function isUnlocked(layer: LayerId, id: number): boolean {
  const def = getBuyable(id)
  if (!def) return true
  return def.isUnlocked?.(layer) ?? true
}
/**已购n个时某可购买的价格 */
export function buyableCostAt(layer: LayerId, id: number, n: Decimal): Decimal {
  const def = getBuyable(id)
  if (!def) return Decimal.dInf
  //挑战C4:除加速器加成(b13)外,购买任何东西都使价格视为多购买1次(偏移量=本层购买总数)
  const n2 = id != 13 ? c4BoughtOffset(layer, n) : n
  const price = def.cost(layer, n2)
  //声明了softCap的可购买在获取价格时统一套对数软上限(见compute/softCap)
  if (def.softCap) return softCap(price, def.softCap.power)
  return price
}
/**获取某可购买的成本 */
export function buyableCost(layer: LayerId, id: number): Decimal {
  return buyableCostAt(layer, id, buyableAmount(layer, id))
}
/**判断是否能购买某可购买 */
export function canBuyBuyable(layer: LayerId, id: number): boolean {
  const L = getLayer(layer)
  if (!L) return false
  if (!isUnlocked(layer, id)) return false
  return L.points.gte(buyableCost(layer, id))
}

//------效果注册------
/**把可购买定义转换为注册效果 */
function buyableEffect(b: BuyableDef): RegisteredEffect | undefined {
  if (!b.effect) return undefined
  return { ...b.effect, id: `buyable-${b.id}`, name: b.name }
}

//自动注册各可购买的数值效果
for (const b of BUYABLES) {
  const e = buyableEffect(b)
  if (e) registerEffect(e)
}

/**某可购买的效果文字(自定义优先,否则从效果自动生成) */
export function buyableEffectText(def: BuyableDef, layer: LayerId): string {
  if (def.effectText) return def.effectText(layer, buyableAmount(layer, def.id))
  const e = buyableEffect(def)
  return e ? effectText(e, { pos: layer, id: 0 }) : ''
}

/**某可购买的描述(支持{value}{base}{basePercent}{amount}模板) */
export function buyableDescription(def: BuyableDef, layer: LayerId): string {
  if (def.description.indexOf('{') < 0) return def.description
  const e = buyableEffect(def)
  return e ? renderText(def.description, e, { pos: layer, id: 0 }) : def.description
}

/**某可购买的生效等级(等级槽位的组合值,含免费等级) */
export function buyableLevel(layer: LayerId, id: number): Decimal {
  const def = getBuyable(id)
  const slot = def?.effect?.amount
  if (!slot) return buyableAmount(layer, id)
  return slotValue(slot, { pos: layer, id: 0 })
}

/**某可购买的免费等级(等级槽位被修饰的部分) */
export function buyableFreeLevels(layer: LayerId, id: number): Decimal {
  const def = getBuyable(id)
  const slot = def?.effect?.amount
  if (!slot) return new Decimal(0)
  const ctx = { pos: layer, id: 0 }
  return slotValue(slot, ctx).sub(new Decimal(slot.init(ctx)))
}
