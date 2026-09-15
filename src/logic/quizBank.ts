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
  /**选项(4个) */
  options: string[]
  /**正确答案下标 */
  correct: number
  /**是否已解锁(防剧透:相关机制解锁后才加入抽题池) */
  unlocked(): boolean
}

/**题库(梗题始终可用,机制题按解锁条件依次开放) */
const BANK: BankQuestionDef[] = [
  {
    id: 'bank-layers',
    text: '本游戏一共有多少个常规层级?',
    options: ['ω^ω', '10', '无限', '100'],
    correct: 0,
    unlocked: () => true,
  },
  {
    id: 'bank-max',
    text: '1.79e308在JavaScript里对应哪个内置常量?',
    options: ['Number.MAX_VALUE', 'Infinity', 'NaN', 'Number.MIN_VALUE'],
    correct: 0,
    unlocked: () => true,
  },
  {
    id: 'bank-base',
    text: '《序数增量》中，序数进制的初始值是多少?',
    options: ['8', '10', '2', '100'],
    correct: 1,
    unlocked: () => true,
  },
  {
    id: 'bank-ad',
    text: '《反物质维度》中,点数达到1.8e308后解锁什么?',
    options: ['无限', '永恒', '现实', '天体'],
    correct: 0,
    unlocked: () => true,
  },
  {
    id: 'bank-egg',
    text: '输入哪个指令可以触发彩蛋?',
    options: ['/egg', '/quiz', '/checkin', '/set'],
    correct: 0,
    unlocked: () => hasKnowledge('command-checkin'),
  },
  {
    id: 'bank-knowledge',
    text: '1知识可以兑换多少秒离线时间?',
    options: ['30', '60', '100', '120'],
    correct: 1,
    unlocked: () => hasKnowledge('time-offline'),
  },
  {
    id: 'bank-layer1',
    text: '层级1的第1维度生产什么?',
    options: ['点数', '能量', '知识', '加速器'],
    correct: 1,
    unlocked: () => getPoints([1]).gte(1),
  },
  {
    id: 'bank-u4',
    text: '哪个通用升级解锁层级k-1的维度自动购买?',
    options: ['自动化1', '自动化2', '自动重置', '升级保留'],
    correct: 0,
    unlocked: () => hasAnyUpgrade(4),
  },
  {
    id: 'bank-u8',
    text: '哪个通用升级使重置保留下层升级?',
    options: ['能量保留', '升级保留', '软重置', '自协同'],
    correct: 1,
    unlocked: () => hasAnyUpgrade(8),
  },
  {
    id: 'bank-challenge',
    text: '挑战1中哪种可购买无效?',
    options: ['加速器', '加倍器', '加速器加成', '维度'],
    correct: 0,
    unlocked: () => hasAchievement('a28'),
  },
  {
    id: 'bank-c4',
    text: '挑战C4的名称是什么?',
    options: ['立即折算', '能量衰弱', '维度蒸发', '无加倍器'],
    correct: 0,
    unlocked: () => hasAchievement('a28'),
  },
  {
    id: 'bank-infinity',
    text: '解锁"无限"需要多少层级0点数?',
    options: ['1.79e308', '1e100', '9.99e307', '2^512'],
    correct: 0,
    unlocked: () => hasAchievement('a48'),
  },
]

/**从题库中随机抽一道已解锁的题(无可用题返回null) */
export function randomBankQuestion(): QuizQuestion | null {
  const pool = BANK.filter((b) => b.unlocked())
  if (pool.length == 0) return null
  const pick = pool[Math.floor(rng() * pool.length)]
  return pick ? { text: pick.text, options: pick.options, correctIndex: pick.correct } : null
}
