//指令系统的逻辑:签到/答题的数值与状态(状态存取+纯判定,不涉及UI)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { addLog } from '@/data/log'
import { rng, seedInt } from '@/save/rng'
import { addKnowledge, hasKnowledge, knowledgeAmount, quizStoreLimit } from '@/compute/knowledge'
import { applyTo } from '@/compute/effects'
import { formatWhole } from '@/tools/format'
import { generateMathQuestion, type QuizQuestion } from '@/tools/quiz'
import { unlockAchievementById } from './achievements'
import { randomBankQuestion } from './quizBank'

/**基础答题奖励(知识) */
const QUIZ_BASE_REWARD = 10
/**答题基础冷却(秒) */
const QUIZ_BASE_COOLDOWN = 3600

/**生成偏移offsetDays天的本地日期(YYYY-MM-DD) */
function dateString(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

//------签到------
/**今天是否已签到 */
export function checkedInToday(): boolean {
  return player.checkin.lastDay === dateString(0)
}
/**当前连续签到天数 */
export function checkinStreak(): number {
  return player.checkin.streak
}
/**
 * 签到:每天一次(按自然日),奖励=(0~100)伪随机整数+10*连续签到天数
 * 随机奖励>90时会累计"高随机连击"(隐藏成就"运气不错"用),否则清零
 * @returns 本次奖励与新的连续天数;今天已签到则返回null
 */
export function doCheckin(): { reward: Decimal; streak: number } | null {
  if (checkedInToday()) return null
  const consecutive = player.checkin.lastDay === dateString(-1)
  const streak = consecutive ? player.checkin.streak + 1 : 1
  const roll = seedInt(0, 101)
  const highStreak = consecutive && roll > 90 ? player.checkin.highStreak + 1 : roll > 90 ? 1 : 0
  player.checkin = { lastDay: dateString(0), streak, highStreak }
  const reward = new Decimal(roll).add(10 * streak)
  const finalReward = addKnowledge(reward)
  addLog(
    'progress',
    `签到成功!今日运势:${roll}` + '\n' + `连续签到${streak}天,获得${formatWhole(finalReward)}知识`,
  )
  return { reward, streak }
}

//------答题------
/**答题难度等级(博学升级的已购数) */
export function quizDifficulty(): number {
  return knowledgeAmount('quiz-difficulty').toNumber()
}
/**当前答对奖励的知识=10*1.5^难度 */
export function quizReward(): Decimal {
  return new Decimal(QUIZ_BASE_REWARD).mul(new Decimal(1.5).pow(quizDifficulty()))
}
/**当前答题冷却(秒)=3600*0.9^答题加速等级(经加成管道计算,统计页可见) */
export function quizCooldown(): Decimal {
  return applyTo('quizCooldown', new Decimal(QUIZ_BASE_COOLDOWN))
}
/**当前答题冷却的毫秒数(时间戳用) */
function quizCooldownMs(): number {
  return quizCooldown().mul(1000).toNumber()
}
/**
 * 结算冷却溢出的答题次数:每过一个冷却就把1次答题存入"储存"(上限为知识升级"答题储存"的等级)
 * 由 gameLoop 每帧调用;判定基于时间戳而非逐帧累加,故离线/暂停期间的溢出会在回到游戏后一次结清
 * 未购买"答题储存"(上限0)时不做任何事:计时停在"已就绪",行为与"冷却结束即可答题"完全一致
 */
export function updateQuizStorage() {
  if (!hasKnowledge('command-quiz')) return
  const limit = quizStoreLimit()
  if (limit <= 0) return
  const now = Date.now()
  if (now < player.quizNextAt) return
  const cd = quizCooldownMs()
  if (!(cd > 0)) return
  if (player.quizStored >= limit) {
    //储存已满:重新起一个冷却。若把计时冻在"已就绪",消耗一次后下一帧就会立刻补满
    player.quizNextAt = now + cd
    return
  }
  //能存几次:受剩余空间与"已经过了几个冷却"共同限制(一次算清,不逐帧累加)
  const gained = Math.min(limit - player.quizStored, Math.floor((now - player.quizNextAt) / cd) + 1)
  player.quizStored += gained
  player.quizNextAt += gained * cd
  //正好补满且计时已落在过去时,同样起一个新冷却
  if (player.quizStored >= limit && player.quizNextAt <= now) player.quizNextAt = now + cd
}
/**距可以答题的剩余秒数(有储存的答题次数时恒为0) */
export function quizCooldownLeft(): Decimal {
  if (player.quizStored > 0) return new Decimal(0)
  return Decimal.max(0, new Decimal((player.quizNextAt - Date.now()) / 1000))
}
/**当前是否可答题(已解锁,且有储存的答题次数或冷却已结束) */
export function quizAvailable(): boolean {
  if (!hasKnowledge('command-quiz')) return false
  return player.quizStored > 0 || Date.now() >= player.quizNextAt
}

/**判断玩家答案是否正确(多选题按下标,数学题按文本+容差) */
function answerCorrect(q: QuizQuestion, answer: string | number): boolean {
  if (q.options != null && q.correctIndex != null) {
    return typeof answer == 'number' && answer == q.correctIndex
  }
  if (q.answer == null) return false
  const parsed = new Decimal(typeof answer == 'string' ? answer : '')
  if (Decimal.isNaN(parsed)) return false
  const tol = q.tolerance ?? 0
  if (tol <= 0) return parsed.eq(q.answer)
  return parsed.sub(q.answer).abs().lte(q.answer.abs().mul(tol))
}

/**抽到题库题的概率 */
const QUIZ_BANK_CHANCE = 0.35

/**
 * 获取一道题:存在待答题时复用同一题(防止反复刷新题目/重掷),否则生成并存档
 */
export function getQuizQuestion(): QuizQuestion {
  if (player.pendingQuiz) return player.pendingQuiz
  const q = createQuiz()
  player.pendingQuiz = q
  return q
}

/**
 * 随机生成一道题:一定概率抽题库(机制/梗多选题),否则按难度分级生成数学题(见tools/quiz)
 * 难度分级为0~5共六个等级(封顶tier 5),奖励仍随"博学"升级等级继续乘算
 */
export function createQuiz(): QuizQuestion {
  const d = quizDifficulty()
  if (rng() < QUIZ_BANK_CHANCE) {
    const bank = randomBankQuestion()
    if (bank) return bank
  }
  return generateMathQuestion(Math.min(d, 5), seedInt)
}

/**
 * 提交答案:任意尝试都会开始冷却
 * @param answer 输入式答案(字符串)或多选题选中的下标
 * @returns 是否正确与获得的知识
 */
export function submitQuizAnswer(
  question: QuizQuestion,
  answer: string | number,
): { correct: boolean; reward: Decimal } {
  player.quizCount += 1
  //有储存的答题次数就消耗一次(冷却照常继续跑),否则从这次尝试开始重新冷却
  if (player.quizStored > 0) player.quizStored -= 1
  else player.quizNextAt = Date.now() + quizCooldownMs()
  //已作答,清空待答题(下次/quiz生成新题)
  player.pendingQuiz = null
  const correct = answerCorrect(question, answer)
  if (correct) {
    const reward = addKnowledge(quizReward())
    addLog('progress', `答对!获得${formatWhole(reward)}知识`)
    return { correct, reward }
  }
  addLog('info', '答错了,再接再厉')
  //把"1 + 1"答错触发隐藏成就"你是认真的?"(tier0自然生成,无特殊分支)
  if (question.text == '1 + 1') unlockAchievementById('s14')
  return { correct, reward: new Decimal(0) }
}
