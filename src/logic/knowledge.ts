//知识购买行为
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import { addValue } from '@/save/save'
import { KNOWLEDGE_TIME_RATE } from '@/data/constants'
import {
  canBuyKnowledgeUpgrade,
  getKnowledgeUpgrade,
  KNOWLEDGE_UPGRADES,
  knowledgeItem,
} from '@/compute/knowledge'
import { maxBuyable, sumCost } from '@/compute/buying'

/**
 * 购买知识升级
 * @param amount 一次性购买的数量上限,默认1
 * @returns 实际花费的知识
 */
export function buyKnowledgeUpgrade(id: string, amount: DecimalSource = 1): Decimal {
  const def = getKnowledgeUpgrade(id)
  if (!def || !canBuyKnowledgeUpgrade(def)) return new Decimal(0)
  const item = knowledgeItem(id)
  const n = Decimal.min(
    Decimal.min(new Decimal(amount), maxBuyable(item, player.knowledge)),
    def.maxAmount.sub(item.amount()),
  )
  if (n.lte(0)) return new Decimal(0)
  const cost = sumCost(item, n)
  if (cost.gt(player.knowledge)) return new Decimal(0)
  player.knowledge = player.knowledge.sub(cost)
  player.knowledgeUpgrades[id] = item.amount().add(n)
  return cost
}
/**购买指定秒数离线时间所需的知识 */
export function offlineTimeCost(seconds: Decimal): Decimal {
  return seconds.div(KNOWLEDGE_TIME_RATE)
}
/**
 * 用知识购买离线时间
 * @param seconds 购买的离线时间(秒),按1知识=1分钟折算
 * @returns 实际花费的知识
 */
export function buyOfflineTime(seconds: Decimal): Decimal {
  if (seconds.lt(1)) return new Decimal(0)
  const cost = offlineTimeCost(seconds)
  if (player.knowledge.lt(cost)) return new Decimal(0)
  player.knowledge = player.knowledge.sub(cost)
  addValue('offlineTime', seconds)
  return cost
}
/**
 * 按当前知识百分比购买离线时间
 * @param pct 消耗的知识比例(如0.5表示50%)
 * @returns 实际花费的知识
 */
export function buyOfflineTimePct(pct: number): Decimal {
  return buyOfflineTime(player.knowledge.mul(pct).mul(KNOWLEDGE_TIME_RATE))
}
/**
 * 把离线时间转换为加速时间(1:1),实际转换min(seconds, offlineTime)
 * @param seconds 请求转换的秒数
 * @returns 实际转换的秒数
 */
export function convertOfflineToWarp(seconds: Decimal): Decimal {
  const s = Decimal.min(seconds, player.offlineTime)
  if (s.lte(0)) return new Decimal(0)
  addValue('offlineTime', s.neg())
  addValue('warpTime', s)
  return s
}
/**
 * 按当前离线时间百分比转换为加速时间
 * @param pct 转换的离线时间比例(如0.5表示50%)
 * @returns 实际转换的秒数
 */
export function convertOfflineToWarpPct(pct: number): Decimal {
  return convertOfflineToWarp(player.offlineTime.mul(pct))
}
/**调试用:把所有"时间"类知识升级(离线/暂停/加速等新机制)设为满级(忽略前置与知识消耗) */
export function unlockAllUi() {
  for (const def of KNOWLEDGE_UPGRADES) {
    if (def.category == 'time') player.knowledgeUpgrades[def.id] = new Decimal(def.maxAmount)
  }
}
