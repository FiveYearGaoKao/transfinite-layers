//答题题库:游戏机制题(按解锁条件依次开放,防剧透)与增量/大数梗题
//本题库为多选题(4选1)
import { getPoints, hasAchievement, hasAnyUpgrade } from '@/access'
import { hasKnowledge } from '@/compute/knowledge'
import { rng } from '@/save/rng'
import type { QuizQuestion } from '@/tools/quiz'

/**题库中的一道题 */
interface BankQuestionDef {
  id: string
  text: string
  /**选项(4个,第一个为正确答案) */
  options: string[]
  /**是否已解锁(防剧透:相关机制解锁后才加入抽题池) */
  unlocked(): boolean
}

/**题库(梗题始终可用,机制题按解锁条件依次开放) */
const BANK: BankQuestionDef[] = [
  {
    id: 'bank-layers',
    text: '本游戏一共有多少个常规层级?',
    options: ['ω^ω', '10', '无限', '100'],
    unlocked: () => true,
  },
  {
    id: 'bank-max',
    text: '1.79e308在JavaScript里对应哪个内置常量?',
    options: ['Number.MAX_VALUE', 'Infinity', 'Number.MAX_SAFE_INTEGER', 'Number.MIN_VALUE'],
    unlocked: () => true,
  },
  {
    id: 'bank-base',
    text: '《序数增量》中，序数进制的初始值是多少?',
    options: ['10', '8', '2', '100'],
    unlocked: () => true,
  },
  {
    id: 'bank-ad',
    text: '《反物质维度》中,点数达到1.8e308后解锁什么?',
    options: ['无限', '永恒', '现实', '终局'],
    unlocked: () => true,
  },
  {
    id: 'bank-egg',
    text: '输入哪个指令可以触发彩蛋?',
    options: ['/egg', '/quiz', '/checkin', '/set'],
    unlocked: () => hasKnowledge('command-checkin'),
  },
  {
    id: 'bank-knowledge',
    text: '1知识可以兑换多少秒离线时间?',
    options: ['60', '30', '100', '120'],
    unlocked: () => hasKnowledge('time-offline'),
  },
  {
    id: 'bank-layer1',
    text: '层级1的第1维度生产什么?',
    options: ['能量', '点数', '知识', '加速器'],
    unlocked: () => getPoints([1]).gte(1),
  },
  {
    id: 'bank-u4',
    text: '哪个通用升级解锁层级k-1的维度自动购买?',
    options: ['自动化1', '自动化2', '自动重置', '升级保留'],
    unlocked: () => hasAnyUpgrade(4),
  },
  {
    id: 'bank-u8',
    text: '哪个通用升级使重置保留下层升级?',
    options: ['升级保留', '能量保留', '软重置', '自协同'],
    unlocked: () => hasAnyUpgrade(8),
  },
  {
    id: 'bank-challenge',
    text: '挑战1中哪种可购买无效?',
    options: ['加速器', '加倍器', '加速器加成', '维度'],
    unlocked: () => hasAchievement('a28'),
  },
  {
    id: 'bank-c4',
    text: '挑战C4的名称是什么?',
    options: ['花费暴增', '能量衰弱', '维度蒸发', '无加倍器'],
    unlocked: () => hasAchievement('a28'),
  },
  {
    id: 'bank-achievement',
    text: '以下哪个成就奖励的知识最多?',
    options: ['挑战者', '能量过载', '速通高手', '全速前进'],
    unlocked: () => hasAchievement('a38'),
  },
  {
    id: 'bank-achievementEffect',
    text: '以下哪个成就不提供额外加成?',
    options: ['永无止境', '我需要能量吗', '加倍器棋盘', '逆流而上'],
    unlocked: () => hasAchievement('a48'),
  },
  {
    id: 'bank-infinity',
    text: '解锁"无限"需要多少层级0点数?',
    options: ['1.79e308', '1e100', '9.99e307', '2^512'],
    unlocked: () => hasAchievement('a48'),
  },
  {
    id: 'bank-infinityUpgrades',
    text: '"无限升级"页面有几个升级?',
    options: ['25', '16', '64', '36'],
    unlocked: () => hasAchievement('a51'),
  },
]

/**
 * 从题库中随机抽一道已解锁的题(无可用题返回null)
 * 选项顺序每次抽取都打乱:题库里正确答案的位置是写死的(多数在第1个),照搬会让玩家靠"总选第一个"通关
 * 打乱在抽取时完成并随题目一起存档(pendingQuiz),故刷新/重开不会重掷选项顺序
 */
export function randomBankQuestion(): QuizQuestion | null {
  const pool = BANK.filter((b) => b.unlocked())
  if (pool.length == 0) return null
  const pick = pool[Math.floor(rng() * pool.length)]
  if (!pick) return null
  const order = pick.options.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = order[i]!
    const b = order[j]!
    order[i] = b
    order[j] = a
  }
  return {
    text: pick.text,
    options: order.map((i) => pick.options[i] ?? ''),
    correctIndex: order.indexOf(0),
  }
}
