//维度的计算(只读)
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { c4BoughtOffset, dimensionAmount } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import { applyTo, registerEffect } from './effects'
import { expLinear, floored, type Curve } from './curves'
import { priceCountAnchor, type BuyableItem } from './buying'
import {
  SLOT_DIM_CAP_BASE,
  SLOT_DIM_CAP_POWER,
  SLOT_PRICE_CAP_BASE,
  SLOT_PRICE_CAP_POWER,
  SOFT_CAP_HEIGHT,
} from './softCap'
import './energy'

//维度价格软上限:注册在dimensionCost上的cap效果(参数槽位与维度生产软上限完全独立)
registerEffect({
  id: 'dimension-price-softcap',
  name: '价格软上限',
  target: 'dimensionCost',
  type: 'cap',
  threshold: SLOT_PRICE_CAP_BASE,
  power: SLOT_PRICE_CAP_POWER,
  height: SOFT_CAP_HEIGHT,
})

//维度生产软上限:注册在production上的cap效果
//cap优先级最高,天然在其它产量加成之后生效;阈值与幂次都经槽位(帧内缓存)
//高度1=对产量的对数做幂次压缩(与价格软上限同形,但阈值/幂次槽位完全独立)
registerEffect({
  id: 'dimension-softcap',
  name: '维度生产软上限',
  target: 'production',
  type: 'cap',
  threshold: SLOT_DIM_CAP_BASE,
  power: SLOT_DIM_CAP_POWER,
  height: 1,
})

interface dimensionInfo {
  /** 价格曲线:base^(id + (id+1)·n),正向取整;底数=序数进制(见compute/curves) */
  curve: Curve
}

/**不同层级维度的价格公式(按阶取行;阶未定义即不可购买) */
export const DIMENSIONS: (dimensionInfo | undefined)[] = [
  {
    curve: floored(
      expLinear({
        label: '维度价格',
        a: (ctx) => new Decimal(ctx.id),
        b: (ctx) => new Decimal(ctx.id + 1),
      }),
    ),
  },
]

/**已购n个时某维度的原始价格(未经dimensionCost管道:未套软上限/未加成) */
function rawDimensionCost(layer: LayerId, id: number, n: Decimal): Decimal {
  //按阶精确取公式行:阶未定义时价格为无穷(不可购买),不静默兜底到低阶公式
  const info = DIMENSIONS[getLayerOrder(layer)]
  if (!info) return Decimal.dInf
  //挑战C4的偏移量含同批已买次数,见c4BoughtOffset(非C4时n原样)
  const owned = dimensionAmount(layer, id, 1)
  const n2 = c4BoughtOffset(layer, owned, n)
  return info.curve.at(n2, { pos: layer, id })
}

/**已购n个时某维度的价格 */
export function dimensionCostAt(layer: LayerId, id: number, n: Decimal): Decimal {
  return applyTo('dimensionCost', rawDimensionCost(layer, id, n), { pos: layer, id })
}

/**某维度"下一项"的原始价格(统计页展示"初始值"用) */
export function dimensionCostBase(layer: LayerId, id: number): Decimal {
  return rawDimensionCost(layer, id, dimensionAmount(layer, id, 1))
}

/**
 * 维度作为可购买项(供maxBuyable/sumCost使用)
 * 锚点走compute/buying的priceCountAnchor:预算 →(价格软上限求逆)→ 原始价 →(曲线求逆)→ 数量
 * 契约:估算只当搜索锚点(见tools/bisect),偏差只影响迭代次数,不影响正确性
 */
export function dimensionItem(layer: LayerId, id: number): BuyableItem {
  const info = DIMENSIONS[getLayerOrder(layer)]
  const owned = () => dimensionAmount(layer, id, 1)
  const item: BuyableItem = {
    amount: owned,
    cost: (n) => dimensionCostAt(layer, id, n),
  }
  if (info) {
    item.sumInverse = (budget) =>
      priceCountAnchor(info.curve, 'dimensionCost', { pos: layer, id }, budget, owned())
  }
  return item
}

/**获取某维度的价格 */
export function dimensionCost(layer: LayerId, id: number): Decimal {
  return dimensionCostAt(layer, id, dimensionAmount(layer, id, 1))
}
/**获取某维度的乘数 */
export function dimensionMultiplier(layer: LayerId, id: number): Decimal {
  return applyTo('dimensionMult', new Decimal(1), { pos: layer, id })
}
/**获取某维度的指数 */
export function dimensionExponent(layer: LayerId, id: number): Decimal {
  return applyTo('dimensionExponent', new Decimal(1), { pos: layer, id })
}
/**维度产量的公式基准值(总量×乘数^指数,未经production管道) */
export function productionBase(layer: LayerId, id: number): Decimal {
  return dimensionAmount(layer, id)
    .mul(dimensionMultiplier(layer, id))
    .pow(dimensionExponent(layer, id))
}

/**每秒产量 */
export function productionPerSecond(layer: LayerId, id: number): Decimal {
  let value = applyTo('production', productionBase(layer, id), { pos: layer, id })
  //层级0的维度1产量即点数获取,统一在pointsGain目标应用(含软上限cap效果)
  if (isLayer0(layer) && id == 0) {
    value = applyTo('pointsGain', value, { pos: layer, id })
  }
  return value
}
