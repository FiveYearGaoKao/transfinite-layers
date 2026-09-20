//只读访问层级数据(以及少量写入维度的便捷函数)
//层级结构、坐标/高度与相邻关系的权威实现在layerGraph中,这里统一重导出,保证'@/access'仍是单一入口
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import { type LayerId, type LayerRef } from '@/data/types'
import { getLayerIndex, isLayer0, shiftLayer } from '@/tools/ordinal'
import { getLayer, getLayerName, getOrderedLayers } from './layerGraph'
import { isChallengeActive } from './challengeState'

export * from './layerGraph'
//挑战激活状态与完成次数:权威实现在challengeState(叶子模块),经此处统一出口
export * from './challengeState'

/**层级选择矩阵中的一个按钮项 */
export interface LayerRow {
  pos: LayerId
  name: string
  selected: boolean
}

/**
 * 层级选择矩阵:以锚点层级为准,遍历layerDepth×base用shiftLayer生成按钮矩阵(含临时层)
 * 供层级选择组件(layerSelect)与快捷键层级循环(navigation)共用,保证两者永远一致
 */
export function getLayerRows(modelValue: LayerId): LayerRow[][] {
  const rows: LayerRow[][] = []
  for (let i = player.layerDepth - 1; i >= 0; --i) {
    const row: LayerRow[] = []
    for (let j = 0; j <= player.base; ++j) {
      const k = j < player.base ? j : -1
      const pos = shiftLayer(modelValue, i, k)
      row.push({ pos, name: getLayerName(pos, i), selected: k == getLayerIndex(modelValue, i) })
    }
    rows.push(row)
  }
  return rows
}

/**获取某个层级的点数，层级0的点数即玩家的总点数 */
export function getPoints(pos: LayerId): Decimal {
  return getLayer(pos)?.points || new Decimal(0)
}
/**获取某个层级的能量，层级0的能量恒为0 */
export function getEnergy(pos: LayerId): Decimal {
  if (isLayer0(pos)) return new Decimal(0)
  return getLayer(pos)?.energy || new Decimal(0)
}
/**
 * 获取某维度的数量
 * @param type 0表示总数，1表示购买数量
 */
export function dimensionAmount(
  layer: LayerRef | undefined,
  id: number,
  type: number = 0,
): Decimal {
  if (layer instanceof Array) layer = getLayer(layer)
  return layer?.dimensions[id]?.[type] || new Decimal(0)
}
/**
 * 增加某维度的数量
 * @param type 0表示总数，1表示购买数量
 */
export function addAmount(
  layer: LayerRef | undefined,
  id: number,
  amount: Decimal,
  type: number = 0,
) {
  if (layer instanceof Array) layer = getLayer(layer)
  const dim = layer?.dimensions[id]
  if (dim) dim[type] = dimensionAmount(layer, id, type).add(amount)
}
/**获取某层所有维度的已购买数量总和 */
export function dimensionTotalBought(layer: LayerRef | undefined): Decimal {
  const L = layer instanceof Array ? getLayer(layer) : layer
  if (!L) return new Decimal(0)
  let total = new Decimal(0)
  for (let i = 0; i < L.dimensions.length; ++i) {
    const dim = L.dimensions[i]
    if (dim) total = total.add(dim[1])
  }
  return total
}
/**获取某层所有可购买的已购买数量总和 */
export function buyableTotalBought(layer: LayerRef | undefined): Decimal {
  const L = layer instanceof Array ? getLayer(layer) : layer
  if (!L) return new Decimal(0)
  let total = new Decimal(0)
  for (const key of Object.keys(L.buyables)) {
    total = total.add(L.buyables[Number(key)] || 0)
  }
  return total
}
/**获取序数进制 */
export function getBase(): number {
  return player.base
}
/**是否有任意层购买了指定升级 */
export function hasAnyUpgrade(id: number): boolean {
  return getOrderedLayers('asc').some((e) => e.L.upgrades.includes(id))
}
/**是否已解锁指定成就 */
export function hasAchievement(id: string): boolean {
  return player.achievements.includes(id)
}

//------隐藏成就------
/**普通成就id集合(由logic/achievements注册,供计算普通成就数量) */
const normalAchievements = new Set<string>()
/**注册一个普通成就id(普通成就定义时调用) */
export function registerNormalAchievement(id: string) {
  normalAchievements.add(id)
}
/**已解锁的普通(非隐藏)成就数量 */
export function getUnlockedNormalAchievementCount(): number {
  return player.achievements.filter((id) => normalAchievements.has(id)).length
}
/**
 * 挑战C4的价格偏移:购买本层维度或可购买会使除加速器加成外的价格视为多购买1次
 * 价格索引 = 本物品将购数 + 本层购买总数 + 同批已买次数(每买1个总购买数+1,该物品价格索引再+1)
 * 非C4时原样返回n;批量第j个的价格索引 = 已购数 + 总数 + 2j
 * @param owned 本物品当前已购数(同批额外次数的基准)
 * @param n 本物品的将购数(已购数 + 同批内已买数)
 */
export function c4BoughtOffset(
  layer: LayerRef | undefined,
  owned: DecimalSource,
  n: DecimalSource,
): Decimal {
  if (!isChallengeActive('c4')) return new Decimal(n)
  const total = dimensionTotalBought(layer).add(buyableTotalBought(layer))
  const extra = new Decimal(n).sub(owned).max(0)
  return new Decimal(n).add(total).add(extra)
}
