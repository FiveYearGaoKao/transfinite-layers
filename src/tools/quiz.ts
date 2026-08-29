//答题数学题的纯函数生成(零项目依赖,随机函数由调用方注入)
import Decimal from 'break_eternity.js'

/**一道题:输入式数学题(Decimal)或多选题(库题) */
export interface QuizQuestion {
  text: string
  /**输入式答案(数学题) */
  answer?: Decimal
  /**数字答案的相对容差(如0.001表示0.1%,缺省精确比较) */
  tolerance?: number
  /**多选题选项与正确答案下标(库题) */
  options?: string[]
  correctIndex?: number
}
type RandIntFn = (left: number, right: number) => number

/**
 * 按难度分级生成一道数学题(纯函数)
 * tier 0:1位数加减法,约1/200概率抽到"1+1=?"
 * tier 1:新增2位数加减法与1位数乘法
 * tier 2:数字范围增大
 * tier 3:混合运算(如 a×b+c)
 */
export function generateMathQuestion(tier: number, randInt: RandIntFn): QuizQuestion {
  if (tier <= 0) {
    //经典问题"1+1=?"(隐藏成就"你是认真的?"):约1/200概率
    if (randInt(0, 200) == 0) return { text: '1+1=?', answer: new Decimal(2) }
    const a = randInt(1, 10)
    const b = randInt(1, 10)
    if (randInt(0, 2) == 0) return { text: `${a} + ${b}`, answer: new Decimal(a + b) }
    const hi = Math.max(a, b)
    const lo = Math.min(a, b)
    return { text: `${hi} - ${lo}`, answer: new Decimal(hi - lo) }
  }
  if (tier <= 1) {
    //1位数乘法 + 2位数加减
    if (randInt(0, 3) == 0) {
      const a = randInt(2, 10)
      const b = randInt(2, 10)
      return { text: `${a} × ${b}`, answer: new Decimal(a * b) }
    }
    const a = randInt(10, 100)
    const b = randInt(10, 100)
    if (randInt(0, 2) == 0) return { text: `${a} + ${b}`, answer: new Decimal(a + b) }
    const hi = Math.max(a, b)
    const lo = Math.min(a, b)
    return { text: `${hi} - ${lo}`, answer: new Decimal(hi - lo) }
  }
  if (tier <= 2) {
    //更大范围:3位数加减 + 2位数×1位数
    const op = randInt(0, 3)
    if (op == 0) {
      const a = randInt(100, 1000)
      const b = randInt(100, 1000)
      return { text: `${a} + ${b}`, answer: new Decimal(a + b) }
    }
    if (op == 1) {
      const a = randInt(100, 1000)
      const b = randInt(100, 1000)
      const hi = Math.max(a, b)
      const lo = Math.min(a, b)
      return { text: `${hi} - ${lo}`, answer: new Decimal(hi - lo) }
    }
    const a = randInt(11, 100)
    const b = randInt(2, 10)
    return { text: `${a} × ${b}`, answer: new Decimal(a * b) }
  }
  //tier 3:混合运算
  const a = randInt(2, 21)
  const b = randInt(2, 21)
  const c = randInt(2, 21)
  const op = randInt(0, 4)
  if (op == 0) return { text: `${a} × ${b} + ${c}`, answer: new Decimal(a * b + c) }
  if (op == 1) return { text: `${a} + ${b} × ${c}`, answer: new Decimal(a + b * c) }
  if (op == 2) return { text: `(${a} + ${b}) × ${c}`, answer: new Decimal((a + b) * c) }
  return { text: `${a} × ${b} - ${c}`, answer: new Decimal(a * b - c) }
}
