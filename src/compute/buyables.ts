//可购买的定义与计算
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { c4BoughtOffset, getLayer, hasAchievement } from '@/access'
import { hasInfinityUpgrade } from './infinity'
import { initializeDimensions } from '@/data/types'
import { SOFT_CAP_HEIGHT, SLOT_PRICE_CAP_BASE, SLOT_PRICE_CAP_POWER } from './softCap'
import { expLinear, floored, powerDoubleExp, powerQuadratic, type Curve } from './curves'
import { estimateCount } from './estimate'
import {
  applyTo,
  asSlot,
  defineSlot,
  effectText,
  registerEffect,
  renderText,
  slotValue,
  type EffectDef,
  type RegisteredEffect,
} from './effects'

//------槽位(具名注册,全局唯一;缓存按id命中,禁止在调用点临时构造)------
/**加速器底数(1.1;被b13按层加成,故缓存键必须带层级) */
const SLOT_B11_BASE = defineSlot('b11:base', () => new Decimal(1.1))
/**加速器等级(含u3/成就提供的免费等级) */
const SLOT_B11_AMOUNT = defineSlot('b11:amount', (ctx) => buyableAmount(ctx.pos, 11))
/**加倍器底数(2) */
const SLOT_B12_BASE = defineSlot('b12:base', () => new Decimal(2), 'global')
/**加倍器等级 */
const SLOT_B12_AMOUNT = defineSlot('b12:amount', (ctx) => buyableAmount(ctx.pos, 12))
/**加倍器价格公式的二次项系数(0.1) */
const SLOT_B12_QUAD = defineSlot('b12:quad', () => new Decimal(0.1), 'global')
/**加倍器价格公式的常数项(2) */
const SLOT_B12_COST_BASE = defineSlot('b12:costBase', () => new Decimal(2), 'global')
/**加速器加成的基础值(0.02) */
const SLOT_B13_BASE = defineSlot('b13:base', () => new Decimal(0.02), 'global')
/**加速器加成等级 */
const SLOT_B13_AMOUNT = defineSlot('b13:amount', (ctx) => buyableAmount(ctx.pos, 13))
/**加速器加成的价格指数(4) */
const SLOT_B13_COST_MULT = defineSlot('b13:costMult', () => new Decimal(4), 'global')

/**可购买的配置 */
export interface BuyableDef {
  id: number
  name: string
  description: string
  /**显示该可购买的层级阶数 */
  order: number
  /**价格曲线(正向/逆向同源;底数=序数进制,见compute/curves) */
  curve: Curve
  /**是否对该可购买的价格应用软上限(可选) */
  softCap?: boolean
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
    curve: floored(
      expLinear({ label: '加速器价格', a: () => new Decimal(1), b: () => new Decimal(0.5) }),
    ),
    softCap: true,
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      base: SLOT_B11_BASE,
      amount: SLOT_B11_AMOUNT,
      static: true,
      text: '维度生产 x{value}',
    },
  },
  {
    id: 12,
    name: '加倍器',
    description: '点数获取x{base}，效果叠乘',
    order: 0,
    curve: floored(
      powerQuadratic({
        label: '加倍器价格',
        //10^[n*(1+q*n)+costBase]:q为b12:quad槽位(可被挑战C2奖励降低),c为b12:costBase槽位(可被iu22降为0)
        q: () => slotValue(SLOT_B12_QUAD),
        c: () => slotValue(SLOT_B12_COST_BASE),
      }),
    ),
    effect: {
      target: 'pointsGain',
      type: 'mul',
      base: SLOT_B12_BASE,
      amount: SLOT_B12_AMOUNT,
      static: true,
      text: '点数获取 x{value}',
    },
  },
  {
    id: 13,
    name: '加速器加成',
    description: '使加速器的效果+{base}，效果叠加',
    order: 0,
    isUnlocked: (_layer: LayerId) => hasAchievement('a22'),
    curve: powerDoubleExp({
      label: '加速器加成价格',
      //base^(2^n·costMult·base):costMult为b13:costMult槽位(可被无限升级iu42由4降为3)
      m: () => slotValue(SLOT_B13_COST_MULT),
    }),
    effect: {
      target: 'b11:base',
      type: 'add',
      base: SLOT_B13_BASE,
      amount: SLOT_B13_AMOUNT,
      static: true,
      text: '加速器效果 +{value}',
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
/**已购n个时某可购买的原始价格(未经buyableCost管道) */
function rawBuyableCost(layer: LayerId, id: number, n: Decimal): Decimal {
  const def = getBuyable(id)
  if (!def) return Decimal.dInf
  //挑战C4:除加速器加成(b13)外,偏移量含同批已买次数,见c4BoughtOffset(非C4时n原样)
  let n2 = n
  if (id != 13) n2 = c4BoughtOffset(layer, buyableAmount(layer, id), n)
  return def.curve.at(n2)
}

/**已购n个时某可购买的价格(经buyableCost数值点管道:软上限等加成都在那里注册) */
export function buyableCostAt(layer: LayerId, id: number, n: Decimal): Decimal {
  return applyTo('buyableCost', rawBuyableCost(layer, id, n), { pos: layer, id })
}

/**某可购买"下一项"的原始价格(统计页展示"初始值"用) */
export function buyableCostBase(layer: LayerId, id: number): Decimal {
  return rawBuyableCost(layer, id, buyableAmount(layer, id))
}
/**获取某可购买的成本 */
export function buyableCost(layer: LayerId, id: number): Decimal {
  return buyableCostAt(layer, id, buyableAmount(layer, id))
}

/**
 * 可购买"在预算内最多能再买多少个"的闭式估算(供maxBuyable做搜索锚点)
 * 骨架见compute/estimate:公比折算 → 价格域求逆(软上限) → 曲线求逆;各物品的价格曲线见上方BUYABLES定义
 * 契约:估算只当搜索锚点(见tools/bisect),偏差只影响迭代次数,不影响正确性
 * @param budget 总预算
 * @returns 可购买数量的估算;买不起/不可估算时返回undefined(退回通用搜索)
 */
export function buyableSumEstimate(
  layer: LayerId,
  id: number,
  budget: Decimal,
): Decimal | undefined {
  const def = getBuyable(id)
  if (!def) return undefined
  return estimateCount(
    def.curve,
    'buyableCost',
    { pos: layer, id },
    budget,
    buyableAmount(layer, id),
  )
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

//价格软上限:注册在buyableCost数值点上,只对声明了softCap的可购买生效
//(与dimensionCost的cap共用同一组参数槽位,故两处参数不会漂移)
const SOFT_CAPPED_BUYABLES = new Set(BUYABLES.filter((b) => b.softCap).map((b) => b.id))
registerEffect({
  id: 'buyable-price-softcap',
  name: '价格软上限',
  target: 'buyableCost',
  type: 'cap',
  threshold: SLOT_PRICE_CAP_BASE,
  power: SLOT_PRICE_CAP_POWER,
  height: SOFT_CAP_HEIGHT,
  //价格求值是热路径,故用Set判定而不是每次find物品定义
  isActive: (ctx) => SOFT_CAPPED_BUYABLES.has(ctx.id),
})

/**某可购买的效果文字(自定义优先,否则从效果自动生成) */
export function buyableEffectText(def: BuyableDef, layer: LayerId): string {
  if (def.effectText) return def.effectText(layer, buyableAmount(layer, def.id))
  const e = buyableEffect(def)
  return e ? effectText(e, { pos: layer }) : ''
}

/**某可购买的描述(支持{value}{base}{basePercent}{amount}模板) */
export function buyableDescription(def: BuyableDef, layer: LayerId): string {
  if (def.description.indexOf('{') < 0) return def.description
  const e = buyableEffect(def)
  return e ? renderText(def.description, e, { pos: layer }) : def.description
}

/**某可购买的生效等级(等级槽位的组合值,含免费等级) */
export function buyableLevel(layer: LayerId, id: number): Decimal {
  const def = getBuyable(id)
  const slot = def?.effect?.amount
  if (slot == undefined) return buyableAmount(layer, id)
  return slotValue(slot, { pos: layer })
}

/**某可购买的免费等级(等级槽位被修饰的部分) */
export function buyableFreeLevels(layer: LayerId, id: number): Decimal {
  const def = getBuyable(id)
  const slot = def?.effect?.amount
  if (slot == undefined) return new Decimal(0)
  const ctx = { pos: layer, id: 0 }
  return slotValue(slot, ctx).sub(asSlot(slot).init(ctx))
}
