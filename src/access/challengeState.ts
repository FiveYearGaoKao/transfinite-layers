//挑战激活状态与完成次数的只读访问(叶子模块)
//放在access层:普通挑战与无限挑战共用player.activeChallenges/player.challenges,
//而"无限挑战强制视为进入哪些普通挑战"这条规则同时被access(c4价格偏移)、compute(能量/C5损失)与logic(挑战注册)读取,
//因此登记在此作为单一来源,避免access与logic互相引用
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'

/**
 * 无限挑战强制"视为进入"的普通挑战(id → 被强制进入的挑战id列表)
 * 语义:某无限挑战激活期间,列表中的普通挑战视为已进入 —— isChallengeActive 对它们恒为true,
 * 于是它们的惩罚(效果禁用/点数减半/能量削弱/价格偏移)自动生效,无需重复注册一份效果
 * 注:挑战定义在logic/challenges.ts,logic侧在注册后会做一次交叉校验,防止这里的id与注册表失配
 */
export const FORCED_ACTIVE: Record<string, string[]> = {
  ic1: ['c1', 'c2'],
  ic2: ['c3', 'c4'],
}

/**某挑战是否在激活列表中(不做强制进入判定,即"玩家真正进入了它") */
export function isChallengeEntered(id: string): boolean {
  return player.activeChallenges.includes(id)
}

/**
 * 当前被强制激活的挑战id集合
 * @param currentActive 当前激活列表(缺省读player.activeChallenges;调用方已取过时可直接传入,避免重复读取)
 */
export function forcedActiveChallengeIds(currentActive: string[] = player.activeChallenges): string[] {
  const res: string[] = []
  for (const id of currentActive) {
    const forced = FORCED_ACTIVE[id]
    if (forced) res.push(...forced)
  }
  return res
}

/**
 * 某挑战是否正在激活(可叠加):玩家真正进入它,或被某个激活的无限挑战强制视为进入
 * 这是游戏规则与卡片样式共用的唯一状态谓词(效果禁用器、惩罚效果、进度显示都读它)
 */
export function isChallengeActive(id: string): boolean {
  return player.activeChallenges.includes(id) || forcedActiveChallengeIds().includes(id)
}

/**
 * 当前激活列表中的无限挑战id
 * 无限挑战互斥,故至多1个;IC的id约定为'ic'+编号(如'ic1'),取前缀即可与普通挑战区分
 */
export function activeInfinityChallengeIds(
  currentActive: string[] = player.activeChallenges,
): string[] {
  return currentActive.filter((id) => id.startsWith('ic'))
}

/**是否有无限挑战正在激活(无限挑战互斥,有则至多1个) */
export function isAnyInfinityChallengeActive(): boolean {
  return activeInfinityChallengeIds().length > 0
}

/**某挑战的完成次数(普通挑战与无限挑战共用player.challenges) */
export function challengeCompletions(id: string): Decimal {
  return player.challenges[id] || new Decimal(0)
}

/**
 * 挑战的总完成次数(只计普通挑战;无限挑战的完成次数不计入iu52的软上限削弱与相关成就)
 * 放在access而非logic:compute/infinity的iu52需要它,而compute不能引用logic(会形成
 * compute/infinity→logic/challenges→…→compute/infinity的循环,并在模块求值期触发TDZ错误)
 * 判据是id约定(普通挑战'c'+编号,无限挑战'ic'+编号),无需挑战注册表
 */
export function totalChallengeCompletions(): Decimal {
  let total = new Decimal(0)
  for (const id in player.challenges) {
    if (id.startsWith('ic')) continue
    total = total.add(challengeCompletions(id))
  }
  return total
}
