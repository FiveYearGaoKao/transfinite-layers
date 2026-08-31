//购买行为
import Decimal, { type DecimalSource } from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { addAmount, dimensionAmount, getLayer } from '@/access'
import { player } from '@/data/player'
import { dimensionCost, dimensionCostAt } from '@/compute/dimensions'
import { buyableAmount, buyableCostAt, getBuyable } from '@/compute/buyables'
import { canBuyUpgrade, upgradeCost } from '@/compute/upgrades'
import { type BuyableItem, maxBuyable, sumCost } from '@/compute/buying'

/**维度作为可购买项 */
function dimItem(layer: LayerId, id: number): BuyableItem {
  return {
    amount: () => dimensionAmount(layer, id, 1),
    cost: (n) => dimensionCostAt(layer, id, n),
  }
}
/**可购买作为可购买项 */
function buyableItem(layer: LayerId, id: number): BuyableItem {
  return {
    amount: () => buyableAmount(layer, id),
    cost: (n) => buyableCostAt(layer, id, n),
  }
}

/**判断是否能购买某维度 */
export function canAfford(layer: LayerId, id: number): boolean {
  const L = getLayer(layer)
  if (!L) return false
  return L.points.gte(dimensionCost(layer, id))
}

/**
 * 按预算购买可购买项:计算可买数量并扣除点数
 * @returns 购买数量与花费;买不起/数量为0返回null
 */
function buyItem(
  layer: LayerId,
  item: BuyableItem,
  amount: DecimalSource,
  budget?: DecimalSource,
): { n: Decimal; cost: Decimal } | null {
  const L = getLayer(layer)
  if (!L) return null
  const limit = budget != null ? new Decimal(budget) : L.points
  const n = Decimal.min(new Decimal(amount), maxBuyable(item, limit))
  if (n.lte(0)) return null
  const cost = sumCost(item, n)
  if (cost.gt(L.points)) return null
  L.points = L.points.sub(cost)
  return { n, cost }
}

/**
 * 购买维度
 * @param amount 一次性购买的数量上限，默认1
 * @param budget 至多花费的本层点数
 * @returns 实际花费的点数
 */
export function buyDimension(
  layer: LayerId,
  id: number,
  amount: DecimalSource = 1,
  budget?: DecimalSource,
): Decimal {
  const res = buyItem(layer, dimItem(layer, id), amount, budget)
  if (!res) return new Decimal(0)
  addAmount(layer, id, res.n, 0)
  addAmount(layer, id, res.n, 1)
  return res.cost
}
/**
 * 购买可购买
 * @param amount 一次性购买的数量上限，默认1
 * @param budget 至多花费的本层点数
 * @returns 实际花费的点数
 */
export function buyBuyable(
  layer: LayerId,
  id: number,
  amount: DecimalSource = 1,
  budget?: DecimalSource,
): Decimal {
  const def = getBuyable(id)
  if (!def) return new Decimal(0)
  const res = buyItem(layer, buyableItem(layer, id), amount, budget)
  if (!res) return new Decimal(0)
  const L = getLayer(layer)
  if (L) L.buyables[id] = buyableAmount(layer, id).add(res.n)
  //购买了至少一个，onBuy至多触发一次
  def.onBuy?.(layer)
  return res.cost
}
/**购买升级 */
export function buyUpgrade(layer: LayerId, id: number) {
  const L = getLayer(layer)
  if (L && canBuyUpgrade(layer, id)) {
    L.points = L.points.sub(upgradeCost(layer, id))
    L.upgrades.push(id)
    //首次购买自动化1(u4)后永久解锁自动化标签页
    if (id == 4) player.automationUnlocked = true
  }
}
