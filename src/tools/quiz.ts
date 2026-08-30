//答题数学题的纯函数生成(零项目依赖,随机函数由调用方注入)
//共六个等级(0~5),递归构建表达式:先随机选算符,再生成操作数(纯数字或嵌套表达式),递归深度有限
//按"难度分"(算符权重+数字位数)限制每等级题量;答案可为小数时设相对容差
//等级0自然可生成"1 + 1"(隐藏成就"你是认真的?"用此题,无特殊分支)
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

/**算符种类 */
type OpKind = 'add' | 'sub' | 'mul' | 'div' | 'mod' | 'pow' | 'round' | 'sqrt'

/**各等级解锁的算符(0:加减法,1:乘法,2:减法可为负,3:除法取模,4:乘方取整,5:开方) */
const TIER_OPS: OpKind[][] = [
  ['add', 'sub'],
  ['add', 'sub', 'mul'],
  ['add', 'sub', 'mul'],
  ['add', 'sub', 'mul', 'div', 'mod'],
  ['add', 'sub', 'mul', 'div', 'mod', 'pow', 'round'],
  ['add', 'sub', 'mul', 'div', 'mod', 'pow', 'round', 'sqrt'],
]

/**算符的难度权重 */
const OP_WEIGHT: Record<OpKind, number> = {
  add: 1,
  sub: 1,
  mul: 2,
  div: 3,
  mod: 3,
  round: 3,
  pow: 4,
  sqrt: 5,
}

/**各等级允许的最大难度分(实现时可按体验微调) */
const TIER_CAP = [3, 4, 6, 8, 10, 12]

/**表达式的最大嵌套深度(叶子深度为0) */
const MAX_DEPTH = 2

/**小数答案的相对容差 */
const FRACTION_TOLERANCE = 0.001

/**表达式的内部表示 */
interface Expr {
  text: string
  value: Decimal
  /**难度分 */
  score: number
  /**是否"原子"表达式(叶子/乘方/取整/开方),作为操作数时无需加括号 */
  atomic: boolean
}

/**操作数文本:非原子(复合)表达式加括号,避免运算顺序歧义 */
function wrap(e: Expr): string {
  return e.atomic ? e.text : `(${e.text})`
}

/**一个正整数的"位数分"(至少1) */
function digitScore(v: number): number {
  return Math.max(1, Math.floor(Math.log10(Math.abs(v) + 1)) + 1)
}

/**叶子数字的范围上限(随等级扩大) */
function leafMax(tier: number): number {
  return 10 + tier * 10
}

/**生成一个叶子数字 */
function genLeaf(tier: number, randInt: RandIntFn): Expr {
  const v = randInt(1, leafMax(tier))
  return { text: String(v), value: new Decimal(v), score: digitScore(v), atomic: true }
}

/**生成一个操作数:约1/3概率为嵌套表达式,否则为叶子数字 */
function genOperand(tier: number, depth: number, randInt: RandIntFn): Expr {
  return randInt(0, 3) == 0 ? genExpr(tier, depth + 1, randInt) : genLeaf(tier, randInt)
}

/**递归生成一个表达式;深度到顶时退化为叶子 */
function genExpr(tier: number, depth: number, randInt: RandIntFn): Expr {
  if (depth >= MAX_DEPTH) return genLeaf(tier, randInt)
  const ops = TIER_OPS[Math.min(tier, TIER_OPS.length - 1)] ?? ['add']
  const op = ops[randInt(0, ops.length)] ?? 'add'
  switch (op) {
    case 'add': {
      const a = genOperand(tier, depth, randInt)
      const b = genOperand(tier, depth, randInt)
      return {
        text: `${wrap(a)} + ${wrap(b)}`,
        value: a.value.add(b.value),
        score: OP_WEIGHT.add + a.score + b.score,
        atomic: false,
      }
    }
    case 'sub': {
      let a = genOperand(tier, depth, randInt)
      let b = genOperand(tier, depth, randInt)
      //等级2起减法结果可为负数;等级0~1保证非负(交换操作数)
      if (tier < 2 && a.value.lt(b.value)) [a, b] = [b, a]
      return {
        text: `${wrap(a)} - ${wrap(b)}`,
        value: a.value.sub(b.value),
        score: OP_WEIGHT.sub + a.score + b.score,
        atomic: false,
      }
    }
    case 'mul': {
      const a = genOperand(tier, depth, randInt)
      const b = genOperand(tier, depth, randInt)
      return {
        text: `${wrap(a)} × ${wrap(b)}`,
        value: a.value.mul(b.value),
        score: OP_WEIGHT.mul + a.score + b.score,
        atomic: false,
      }
    }
    case 'div': {
      //除数非零;约一半概率构造整除(被除数=除数×整数商),其余为小数答案(设容差)
      if (randInt(0, 2) == 0) {
        const b = randInt(2, 10)
        const k = randInt(1, 10)
        const a = b * k
        return {
          text: `${a} ÷ ${b}`,
          value: new Decimal(k),
          score: OP_WEIGHT.div + digitScore(a) + digitScore(b),
          atomic: false,
        }
      }
      const a = randInt(2, leafMax(tier))
      const b = randInt(2, Math.min(10, leafMax(tier)))
      return {
        text: `${a} ÷ ${b}`,
        value: new Decimal(a).div(b),
        score: OP_WEIGHT.div + digitScore(a) + digitScore(b),
        atomic: false,
      }
    }
    case 'mod': {
      const a = genOperand(tier, depth, randInt)
      const b = randInt(2, 10)
      return {
        text: `${wrap(a)} % ${b}`,
        value: a.value.mod(b),
        score: OP_WEIGHT.mod + a.score + digitScore(b),
        atomic: false,
      }
    }
    case 'pow': {
      //乘方:底数为叶子,指数为整数且不宜过大(2~min(2+tier,5))
      const base = genLeaf(tier, randInt)
      const exp = randInt(2, Math.min(2 + tier, 5))
      return {
        text: `${base.text}^${exp}`,
        value: base.value.pow(exp),
        score: OP_WEIGHT.pow + base.score + digitScore(exp),
        atomic: true,
      }
    }
    case 'round': {
      //取整:内部为不能整除的除法,答案为四舍五入后的整数
      const b = randInt(3, 10)
      const k = randInt(1, 10)
      const a = b * k + randInt(1, b - 1)
      return {
        text: `round(${a} ÷ ${b})`,
        value: new Decimal(Math.round(a / b)),
        score: OP_WEIGHT.round + digitScore(a) + digitScore(b),
        atomic: true,
      }
    }
    case 'sqrt': {
      //平方根:被开方数为完全平方数(非负),答案为整数
      const k = randInt(1, 10)
      return {
        text: `√(${k * k})`,
        value: new Decimal(k),
        score: OP_WEIGHT.sqrt + digitScore(k * k),
        atomic: true,
      }
    }
  }
}

/**
 * 按难度等级生成一道数学题(纯函数)
 * 等级0~5逐级解锁新算符;难度分超限时重试,失败则退回简单的加法题
 */
export function generateMathQuestion(tier: number, randInt: RandIntFn): QuizQuestion {
  const cap = TIER_CAP[Math.min(tier, TIER_CAP.length - 1)] ?? 3
  let expr: Expr | undefined
  for (let i = 0; i < 8; i++) {
    const e = genExpr(tier, 0, randInt)
    if (e.score <= cap) {
      expr = e
      break
    }
  }
  //重试均超限:退回最简单的加法题
  if (!expr) {
    const a = randInt(1, 10)
    const b = randInt(1, 10)
    expr = { text: `${a} + ${b}`, value: new Decimal(a + b), score: 3, atomic: true }
  }
  const question: QuizQuestion = { text: expr.text, answer: expr.value }
  //答案为小数时允许一定误差
  if (!expr.value.eq(expr.value.floor())) question.tolerance = FRACTION_TOLERANCE
  return question
}
