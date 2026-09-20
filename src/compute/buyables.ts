//可购买的定义与计算
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { c4BoughtOffset, getBase, getLayer, hasAchievement } from '@/access'
import { hasInfinityUpgrade } from './infinity'
import { initializeDimensions } from '@/data/types'
import { softCap, softCapInverse, SOFT_CAP_HEIGHT } from './softCap'
import { lastTermBudget } from '@/tools/geometricSum'
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
    description: '使加速器的效果+{base}，效果叠加',
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
      base: { target: 'b13:base', init: () => 0.02 },
      amount: { target: 'b13:amount', init: (ctx) => buyableAmount(ctx.pos, 13) },
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
/**已购n个时某可购买的价格 */
export function buyableCostAt(layer: LayerId, id: number, n: Decimal): Decimal {
  const def = getBuyable(id)
  if (!def) return Decimal.dInf
  //挑战C4:除加速器加成(b13)外,偏移量含同批已买次数,见c4BoughtOffset(非C4时n原样)
  let n2 = n
  if (id != 13) n2 = c4BoughtOffset(layer, buyableAmount(layer, id), n)
  const price = def.cost(layer, n2)
  //声明了softCap的可购买在获取价格时统一套对数软上限(见compute/softCap)
  if (def.softCap) return softCap(price, def.softCap.power)
  return price
}
/**获取某可购买的成本 */
export function buyableCost(layer: LayerId, id: number): Decimal {
  return buyableCostAt(layer, id, buyableAmount(layer, id))
}

/**估算时给"总成本→末项"的折算留的余量(>1):宁可略大,偏大只多迭代几次 */
const ESTIMATE_SAFETY = new Decimal(1.1)

/**
 * 可购买"在预算内最多能再买多少个"的闭式估算(供maxBuyable做搜索锚点)
 * 依据(各可购买的价格公式见上方BUYABLES定义,变更公式时必须同步检查本函数):
 *   b11: base^(n/2+1)         → 公比 base^(1/2),对数对n线性
 *   b12: 10^(n(1+q·n)+c)      → log10(价格)是n的二次式,用求根公式反解(取正根)
 *   b13: base^(2^n·K),K=costMult·base → 双重指数,末项主导,由末项预算直接取对数
 * 之后再套软上限的逆(compute/softCap的softCapInverse,对任意p>0成立)
 * 返回值与sumCost的第2参数同口径(即"还能再买几个"),可直接作为maxSatisfying的锚点
 * 注:估算偏差不会算错,只会让maxSatisfying多迭代几次
 * @param budget 总预算
 * @returns 可购买数量的估算;买不起/公式不适用时返回undefined(退回通用搜索)
 */
export function buyableSumEstimate(
  layer: LayerId,
  id: number,
  budget: Decimal,
): Decimal | undefined {
  if (!budget.gt(0)) return new Decimal(0)
  const base = new Decimal(getBase())
  if (!base.gt(1)) return undefined
  const def = getBuyable(id)
  if (!def) return undefined
  const target = lastTermBudget(budget, base, ESTIMATE_SAFETY)
  if (!target.gt(0)) return undefined
  let nk: Decimal
  if (id == 11) {
    //base^(n/2+1) <= target → n <= 2·(log_base(target) - 1)
    nk = target.log(base).sub(1).mul(2)
  } else if (id == 12) {
    //10^(n(1+q·n)+c) <= target → q·n² + n + (c - log10(target)) <= 0,取正根
    const quad = slotValue({ target: 'b12:quad', init: () => 0.1 }, { pos: layer, id: 0 })
    const costBase = slotValue({ target: 'b12:costBase', init: () => 2 }, { pos: layer, id: 0 })
    if (!quad.gt(0)) return undefined
    const disc = new Decimal(1).add(quad.mul(4).mul(costBase.sub(target.log10())))
    if (!disc.gte(0)) return new Decimal(0)
    nk = disc.sqrt().sub(1).div(quad.mul(2))
  } else if (id == 13) {
    //base^(2^n·K) <= target → 2^n <= log_base(target)/K → n <= log2(...)
    const costMult = slotValue({ target: 'b13:costMult', init: () => 4 }, { pos: layer, id: 0 })
    const K = costMult.mul(base)
    if (!K.gt(0)) return undefined
    const exp = target.log(base).div(K)
    if (!exp.gt(1)) return new Decimal(0)
    nk = exp.log(2)
  } else {
    return undefined
  }
  //套软上限的逆(见compute/softCap的softCapInverse);未声明softCap的可购买不处理
  if (def.softCap) {
    const uncapped = softCapInverse(nk, def.softCap.power, SOFT_CAP_HEIGHT)
    //幂次非正时不可逆:不估算,退回通用搜索
    if (!uncapped) return undefined
    nk = uncapped
  }
  if (!nk.isFinite() || nk.isNan() || !nk.gt(0)) return new Decimal(0)
  const owned = buyableAmount(layer, id)
  const canBuy = nk.floor().sub(owned).add(1)
  //估算落在已购数之下时返回0(合法估算):不可返回负数,否则整条锚定路径会被判为非法而退化
  return canBuy.gt(0) ? canBuy : new Decimal(0)
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
