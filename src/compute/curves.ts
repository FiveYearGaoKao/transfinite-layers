//曲线:把"以次数为自变量的递增函数"声明成一份可正可逆、可求和可反解和的声明
//本文件同时放"族工厂(绑定参数来源)"与它们的公式:每个族只有这一个消费者,
//拆成 tools+compute 两层反而要在两个文件间来回看(见docs/面向开发者/开发规范.md §二.4)
//约定(见docs/面向开发者/effect机制.md §六):
//- 四个方法按需声明,缺哪个就退回哪条通用路径;没有解析解/参数退化一律返回undefined
//- 参数与返回值一律Decimal(输入字面量允许DecimalSource);数值回调不得再包new Decimal(...)
//- 等差/等比的和与求逆直接用break_eternity的sumArithmeticSeries/sumGeometricSeries/afford*:
//  它们与本项目原手写公式同源,但退化参数(公差0、公比1)会算出NaN,故必须先判参数
//- 价格底数=序数进制;本文件是**唯一**读取getBase()的地方(升级价格由upgradeCost传入base)
//  "与进制无关的价格"(知识升级)必须显式给常量底数或不带底数的族
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { getBase } from '@/access'
import { frameCachedByObject } from './frameCache'
import { DEFAULT_CONTEXT, resolveCtx, type EffectContext, type EffectContextInput } from './effects'

/** 曲线参数:常量,或按上下文取值(读槽位/玩家状态) */
export type CurveParam = DecimalSource | ((ctx: EffectContext) => Decimal)

/**
 * 递增曲线:四件套(正向/逆向/求和/和逆);缺省的方法为undefined
 * 契约:不可逆/无解析解/参数退化时返回undefined,由调用方退回通用路径(只影响迭代次数)
 */
export interface Curve {
  /** 正向:第n项的值 */
  at(n: Decimal, ctx?: EffectContextInput): Decimal
  /** 逆向:给定值求n;无解析逆时不给该方法 */
  inverse?(v: Decimal, ctx?: EffectContextInput): Decimal | undefined
  /** 求和:从已购n0起买k个的原始总价(相对误差<1%);无解析和时不给该方法 */
  sum?(n0: Decimal, k: Decimal, ctx?: EffectContextInput): Decimal | undefined
  /** 和的反解:预算→可买数量;无解析解时不给该方法 */
  sumInverse?(n0: Decimal, budget: Decimal, ctx?: EffectContextInput): Decimal | undefined
}

/** 序数进制的帧内缓存宿主(进制整帧不变) */
const BASE_OWNER = { name: 'ordinalBase' }

/**
 * 序数进制:价格与挑战目标的底数
 * 玩家进制只取2~10的整数;进制缩减时价格与挑战目标同步下降(这是有意为之)
 * 开发构建会校验取值范围(超出范围时曲线的逆不再是单调函数)
 */
export function priceBase(): Decimal {
  return frameCachedByObject(
    BASE_OWNER,
    '',
    () => {
      const raw = getBase()
      if (import.meta.env.DEV && (!Number.isInteger(raw) || raw < 2 || raw > 10)) {
        console.error(`[曲线]序数进制必须是2~10的整数(当前${raw})`)
      }
      return new Decimal(raw)
    },
    'base:ordinal',
  )
}

/** 解析一个曲线参数(常量与函数统一成Decimal) */
function runParam(p: CurveParam, ctx: EffectContext): Decimal {
  return typeof p == 'function' ? p(ctx) : new Decimal(p)
}

/** 值是否可安全取对数(正且有限) */
function loggable(v: Decimal): boolean {
  return v.isFinite() && v.gt(0)
}

/** 曲线创建参数:参数解析与上下文补全由makeCurve统一处理 */
interface CurveSpec {
  /** 展示名(仅用于开发构建的自检报错) */
  label: string
  at(ctx: EffectContext, n: Decimal): Decimal
  inverse?(ctx: EffectContext, v: Decimal): Decimal | undefined
  sum?(ctx: EffectContext, n0: Decimal, k: Decimal): Decimal | undefined
  sumInverse?(ctx: EffectContext, n0: Decimal, budget: Decimal): Decimal | undefined
  /** 和/和逆往返自检的相对容差(幂族是积分近似,需要放宽) */
  sumTolerance?: number
}

/** 创建一条曲线(四件套按声明补齐;开发构建做正逆/和往返自检) */
function makeCurve(spec: CurveSpec): Curve {
  const curve: Curve = { at: (n, ctx) => spec.at(resolveCtx(ctx), n) }
  if (spec.inverse) curve.inverse = (v, ctx) => spec.inverse!(resolveCtx(ctx), v)
  if (spec.sum) curve.sum = (n0, k, ctx) => spec.sum!(resolveCtx(ctx), n0, k)
  if (spec.sumInverse)
    curve.sumInverse = (n0, budget, ctx) => spec.sumInverse!(resolveCtx(ctx), n0, budget)
  checkCurveRoundTrip(curve, spec)
  return curve
}

/** 相对误差比较(自检用) */
function closeRel(a: Decimal, b: Decimal, tol: number): boolean {
  if (a.eq(b)) return true
  if (!a.isFinite() || !b.isFinite()) return false
  if (b.eq(0)) return a.abs().lt(tol)
  return a.sub(b).div(b).abs().lt(tol)
}

/**
 * 开发构建自检:曲线正逆、和与和逆必须往返一致
 * (不一致说明正向与逆向不再同源,估算会失准;锚点错只影响迭代次数,不会算错)
 * 自检用的k取3(幂族走精确逐项分支)、20、1e30(积分近似充分收敛)
 * 两种合法偏差:和逆对参数退化(如几何族公比≤1)返回undefined;和逆向下取整时浮点误差可落到k-1
 */
function checkCurveRoundTrip(curve: Curve, spec: CurveSpec) {
  if (!import.meta.env.DEV) return
  const n0 = new Decimal(2)
  for (const n of [new Decimal(3), new Decimal(20), new Decimal(1e30)]) {
    try {
      const v = curve.at(n, DEFAULT_CONTEXT)
      if (curve.inverse) {
        const back = curve.inverse(v, DEFAULT_CONTEXT)
        if (back == undefined || !closeRel(back, n, 1e-6)) {
          console.error(`[曲线]${spec.label}正逆不一致:n=${n} → ${v} → ${back}`)
        }
      }
      if (curve.sum && curve.sumInverse) {
        const s = curve.sum(n0, n, DEFAULT_CONTEXT)
        if (s == undefined) continue
        const back = curve.sumInverse(n0, s, DEFAULT_CONTEXT)
        if (back == undefined) continue
        const tol = spec.sumTolerance ?? 1e-6
        if (!closeRel(back, n, tol) && !back.sub(n).abs().lte(1)) {
          console.error(`[曲线]${spec.label}和/和逆不一致:n0=${n0} k=${n} 和=${s} → ${back}`)
        }
      }
    } catch (e) {
      console.error(`[曲线]${spec.label}自检异常`, e)
    }
  }
}

//------族:常量/线性/几何/幂(不取序数进制,用于不随进制变化的价格,如知识升级)------

/** 常量曲线:at=c(无解析逆;求逆用整除,公比为1的等比族在库函数里会除0) */
export function constantCurve(c: DecimalSource, label = `constant(${String(c)})`): Curve {
  const value = new Decimal(c)
  return makeCurve({
    label,
    at: () => value,
    sum: (_ctx, _n0, k) => value.mul(k),
    sumInverse: (_ctx, _n0, budget) =>
      value.gt(0) && budget.gt(0) ? budget.div(value).floor() : undefined,
  })
}

/** 线性曲线:a + b·n(等差级数,和与和逆精确) */
export function linear(opts: { a: CurveParam; b: CurveParam; label?: string }): Curve {
  const { a, b } = opts
  return makeCurve({
    label: opts.label ?? 'linear',
    at: (ctx, n) => runParam(a, ctx).add(runParam(b, ctx).mul(n)),
    inverse: (ctx, v) => {
      const diff = runParam(b, ctx)
      if (diff.eq(0)) return undefined
      return new Decimal(v).sub(runParam(a, ctx)).div(diff)
    },
    sum: (ctx, n0, k) => Decimal.sumArithmeticSeries(k, runParam(a, ctx), runParam(b, ctx), n0),
    sumInverse: (ctx, n0, budget) => {
      const diff = runParam(b, ctx)
      //公差≤0时价格不递增(公差0还会让库函数除0):求逆无意义
      if (!diff.gt(0)) return undefined
      return Decimal.affordArithmeticSeries(budget, runParam(a, ctx), diff, n0)
    },
  })
}

/** 几何曲线:c·r^n(等比级数,和与和逆精确) */
export function geometric(opts: { c: CurveParam; r: CurveParam; label?: string }): Curve {
  const { c, r } = opts
  return makeCurve({
    label: opts.label ?? 'geometric',
    at: (ctx, n) => runParam(c, ctx).mul(runParam(r, ctx).pow(n)),
    inverse: (ctx, v) => {
      const value = new Decimal(v)
      const ratio = runParam(r, ctx)
      const start = runParam(c, ctx)
      if (!start.gt(0) || !ratio.gt(0) || ratio.eq(1) || !loggable(value)) return undefined
      return value.div(start).log(ratio)
    },
    sum: (ctx, n0, k) => {
      const ratio = runParam(r, ctx)
      const start = runParam(c, ctx)
      //公比1退化为常量(库函数在此处会除0)
      return ratio.eq(1) ? start.mul(k) : Decimal.sumGeometricSeries(k, start, ratio, n0)
    },
    sumInverse: (ctx, n0, budget) => {
      const ratio = runParam(r, ctx)
      const start = runParam(c, ctx)
      //公比≤1时价格不递增:求逆无意义
      if (!ratio.gt(1) || !start.gt(0)) return undefined
      return Decimal.affordGeometricSeries(budget, start, ratio, n0)
    },
  })
}

/** 幂族求和的"逐项相加"上限:项数不超过它就不用积分近似(-1%误差口径下的取舍) */
const EXACT_SUM_LIMIT = 8

/**
 * 幂曲线的和(相对误差<1%):
 * - 小k逐项相加(精确):积分近似在"k与a+n0同量级"时误差可达百分之几
 * - 大k用Euler-Maclaurin积分近似:Σ ≈ ∫_{n0}^{n0+k-1} f + (首项+末项)/2
 *   = c·[(a+n0+k-1)^(p+1) − (a+n0)^(p+1)]/(p+1) + (首项+末项)/2
 * p=1时精确退化为算术级数
 */
function powerSum(c: Decimal, a: Decimal, p: Decimal, n0: Decimal, k: Decimal): Decimal {
  if (k.lte(0)) return Decimal.dZero
  const first = c.mul(a.add(n0).pow(p))
  if (k.lte(1)) return first
  if (k.lte(EXACT_SUM_LIMIT)) {
    let sum = first
    const count = k.toNumber()
    for (let i = 1; i < count; i++) sum = sum.add(c.mul(a.add(n0).add(i).pow(p)))
    return sum
  }
  const last = c.mul(a.add(n0).add(k).sub(1).pow(p))
  const lo = a.add(n0)
  const hi = a.add(n0).add(k).sub(1)
  const integral = hi.pow(p.add(1)).sub(lo.pow(p.add(1))).mul(c).div(p.add(1))
  return integral.add(first.add(last).div(2))
}

/**
 * 幂曲线和的反解(积分近似 + 两次半项修正;偏差只影响锚点)
 * 无修正时解 c·[(a+n0+k-1)^(p+1) − (a+n0)^(p+1)]/(p+1) = B
 */
function powerSumInverse(
  c: Decimal,
  a: Decimal,
  p: Decimal,
  n0: Decimal,
  budget: Decimal,
): Decimal | undefined {
  if (!c.gt(0) || !p.gt(0) || !budget.gt(0)) return undefined
  const lo = a.add(n0)
  const first = c.mul(lo.pow(p))
  const solve = (target: Decimal): Decimal =>
    target.mul(p.add(1)).div(c).add(lo.pow(p.add(1))).root(p.add(1)).sub(lo).add(1)
  let k = solve(budget)
  for (let i = 0; i < 2; i++) {
    if (!k.gt(1)) return k
    const last = c.mul(a.add(n0).add(k).sub(1).pow(p))
    const target = budget.sub(first.add(last).div(2))
    if (!target.gt(0)) return Decimal.dZero
    k = solve(target)
  }
  return k
}

/** 幂曲线:c·(a + n)^p(和用Euler-Maclaurin积分近似) */
export function power(opts: {
  c: CurveParam
  a: CurveParam
  p: CurveParam
  label?: string
}): Curve {
  const { c, a, p } = opts
  return makeCurve({
    label: opts.label ?? 'power',
    at: (ctx, n) => runParam(c, ctx).mul(runParam(a, ctx).add(n).pow(runParam(p, ctx))),
    inverse: (ctx, v) => {
      const value = new Decimal(v)
      const scale = runParam(c, ctx)
      const exponent = runParam(p, ctx)
      if (!scale.gt(0) || !exponent.gt(0) || !loggable(value)) return undefined
      return value.div(scale).root(exponent).sub(runParam(a, ctx))
    },
    sum: (ctx, n0, k) => powerSum(runParam(c, ctx), runParam(a, ctx), runParam(p, ctx), n0, k),
    sumInverse: (ctx, n0, budget) =>
      powerSumInverse(runParam(c, ctx), runParam(a, ctx), runParam(p, ctx), n0, budget),
    //积分近似+两轮半项修正:小k时仍有约1%偏差(工程上只作为锚点,由buying的有界校验兜住)
    sumTolerance: 0.05,
  })
}

//------族:带序数进制的指数族(维度价格/可购买价格/挑战目标)------

/**
 * 指数线性曲线:base^(a + b·n);底数缺省取序数进制
 * 维度价格(a=维度id,b=id+1)、加速器价格(a=1,b=1/2)、挑战目标(a/b为指数常数)
 * 不声明sum:公比恒为base^b,末两项几何闭式本身就是精确值
 */
export function expLinear(opts: {
  a: CurveParam
  b: CurveParam
  base?: CurveParam
  label?: string
}): Curve {
  const { a, b } = opts
  const base = opts.base ?? priceBase
  return makeCurve({
    label: opts.label ?? `expLinear(${String(opts.a)},${String(opts.b)})`,
    at: (ctx, n) => runParam(base, ctx).pow(runParam(b, ctx).mul(n).add(runParam(a, ctx))),
    inverse: (ctx, v) => {
      const value = new Decimal(v)
      const bv = runParam(b, ctx)
      const baseV = runParam(base, ctx)
      if (!baseV.gt(1) || bv.eq(0) || !loggable(value)) return undefined
      return value.log(baseV).sub(runParam(a, ctx)).div(bv)
    },
  })
}

/** 幂二次曲线(加倍器价格):base^(q·n² + n + c) */
export function powerQuadratic(opts: {
  q: CurveParam
  c: CurveParam
  base?: CurveParam
  label?: string
}): Curve {
  const { q, c } = opts
  const base = opts.base ?? priceBase
  return makeCurve({
    label: opts.label ?? 'powerQuadratic',
    at: (ctx, n) =>
      runParam(base, ctx).pow(
        n.mul(runParam(q, ctx).mul(n).add(1)).add(runParam(c, ctx)),
      ),
    inverse: (ctx, v) => {
      const value = new Decimal(v)
      const baseV = runParam(base, ctx)
      const quad = runParam(q, ctx)
      if (!baseV.gt(1) || !quad.gt(0) || !loggable(value)) return undefined
      //解 q·n² + n + (c - log_base(v)) = 0,取正根:n = (√(1 + 4q(E - c)) - 1)/(2q)
      const e = value.log(baseV)
      const disc = new Decimal(1).add(quad.mul(4).mul(e.sub(runParam(c, ctx))))
      if (!disc.gte(0)) return undefined
      return disc.sqrt().sub(1).div(quad.mul(2))
    },
  })
}

/** 双重指数曲线(加速器加成价格):base^(2^n·m·base) */
export function powerDoubleExp(opts: { m: CurveParam; base?: CurveParam; label?: string }): Curve {
  const { m } = opts
  const base = opts.base ?? priceBase
  return makeCurve({
    label: opts.label ?? 'powerDoubleExp',
    at: (ctx, n) =>
      runParam(base, ctx).pow(
        new Decimal(2).pow(n).mul(runParam(m, ctx)).mul(runParam(base, ctx)),
      ),
    inverse: (ctx, v) => {
      const value = new Decimal(v)
      const baseV = runParam(base, ctx)
      const mult = runParam(m, ctx)
      if (!baseV.gt(1) || !mult.gt(0) || !loggable(value)) return undefined
      //解 2^n = log_base(v)/(m·base)
      const e = value.log(baseV).div(mult.mul(baseV))
      if (!e.gt(1)) return undefined
      return e.log(2)
    },
  })
}

/**
 * 把曲线正向取整(价格向下取整)
 * 逆向与求和不建模取整:锚点允许偏差(精确性由maxBuyable的校验保证)
 */
export function floored(curve: Curve): Curve {
  const out: Curve = { at: (n, ctx) => curve.at(n, ctx).floor() }
  if (curve.inverse) out.inverse = (v, ctx) => curve.inverse!(v, ctx)
  if (curve.sum) out.sum = (n0, k, ctx) => curve.sum!(n0, k, ctx)
  if (curve.sumInverse) out.sumInverse = (n0, budget, ctx) => curve.sumInverse!(n0, budget, ctx)
  return out
}
