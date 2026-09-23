//曲线:把"以次数为自变量的递增函数"声明成一份可正可逆的声明
//本层负责绑定参数来源(序数进制/槽位/上下文),数学原语在tools/curves
//约定(见docs/面向开发者/effect机制.md):
//- 价格与挑战目标的底数=序数进制;本文件是**唯一**读取getBase()的地方(升级价格由upgradeCost传入)
//- 参数与返回值一律Decimal(输入字面量允许DecimalSource)
//- 没有解析逆的公式不要声明曲线:返回undefined即退回通用搜索,正确性由tools/bisect保证
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { getBase } from '@/access'
import {
  expLinearAt,
  expLinearInverse,
  powerDoubleExpAt,
  powerDoubleExpInverse,
  powerQuadraticAt,
  powerQuadraticInverse,
} from '@/tools/curves'
import { frameCachedByObject } from './frameCache'
import { DEFAULT_CONTEXT, resolveCtx, type EffectContext, type EffectContextInput } from './effects'

/** 曲线参数:常量,或按上下文取值(读槽位/玩家状态) */
export type CurveParam = DecimalSource | ((ctx: EffectContext) => Decimal)

/** 递增曲线:正向与逆向来自同一份参数声明 */
export interface Curve {
  /** 正向:第n项的值 */
  at(n: Decimal, ctx?: EffectContextInput): Decimal
  /** 逆向:给定值求n;不可逆/越界返回undefined */
  inverse(v: Decimal, ctx?: EffectContextInput): Decimal | undefined
  /** 公比(仅几何级数有):把"总预算"折成"末项预算"用;非常数公比不要声明 */
  ratio?(ctx?: EffectContextInput): Decimal
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

/** 解析一个曲线参数(常量在创建时已预解析,这里只处理函数形式) */
function runParam(p: DecimalSource | ((ctx: EffectContext) => Decimal), ctx: EffectContext): Decimal {
  return typeof p == 'function' ? p(ctx) : new Decimal(p)
}

/** 曲线创建参数 */
interface CurveSpec {
  /** 展示名(仅用于开发构建的自检报错) */
  label: string
  /** 缺省底数=序数进制 */
  base?: CurveParam
  at(base: Decimal, ctx: EffectContext, n: Decimal): Decimal
  inverse(base: Decimal, ctx: EffectContext, v: Decimal): Decimal | undefined
  ratio?(base: Decimal, ctx: EffectContext): Decimal
}

/** 创建一条曲线:参数在创建时预解析(常量零开销),底数缺省取序数进制 */
function makeCurve(spec: CurveSpec): Curve {
  const baseParam = spec.base ?? priceBase
  const curve: Curve = {
    at(n, ctx) {
      const c = resolveCtx(ctx)
      return spec.at(runParam(baseParam, c), c, n)
    },
    inverse(v, ctx) {
      const c = resolveCtx(ctx)
      return spec.inverse(runParam(baseParam, c), c, v)
    },
  }
  if (spec.ratio) {
    const ratio = spec.ratio
    curve.ratio = (ctx) => {
      const c = resolveCtx(ctx)
      return ratio(runParam(baseParam, c), c)
    }
  }
  checkCurveRoundTrip(curve, spec.label)
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
 * 开发构建自检:曲线正逆必须往返一致
 * (不一致说明正向与逆向不再同源,估算会失准;锚点错只影响迭代次数,不会算错)
 */
function checkCurveRoundTrip(curve: Curve, label: string) {
  if (!import.meta.env.DEV) return
  for (const n of [new Decimal(3), new Decimal(20), new Decimal(1e30)]) {
    try {
      const v = curve.at(n, DEFAULT_CONTEXT)
      const back = curve.inverse(v, DEFAULT_CONTEXT)
      if (back == undefined || !closeRel(back, n, 1e-6)) {
        console.error(`[曲线]${label}正逆不一致:n=${n} → ${v} → ${back}`)
      }
    } catch (e) {
      console.error(`[曲线]${label}自检异常`, e)
    }
  }
}

/**
 * 指数线性曲线:base^(a + b·n)
 * 维度价格(a=维度id,b=id+1)、加速器价格(a=1,b=1/2)、挑战目标(a/b为指数常数)
 */
export function expLinear(opts: { a: CurveParam; b: CurveParam; base?: CurveParam; label?: string }): Curve {
  const a = opts.a
  const b = opts.b
  return makeCurve({
    label: opts.label ?? `expLinear(${String(opts.a)},${String(opts.b)})`,
    base: opts.base,
    at: (base, ctx, n) => expLinearAt(base, runParam(a, ctx), runParam(b, ctx), n),
    inverse: (base, ctx, v) => expLinearInverse(base, runParam(a, ctx), runParam(b, ctx), v),
  })
}

/** 幂二次曲线(加倍器价格):base^(q·n² + n + c) */
export function powerQuadratic(opts: {
  q: CurveParam
  c: CurveParam
  base?: CurveParam
  label?: string
}): Curve {
  const q = opts.q
  const c = opts.c
  return makeCurve({
    label: opts.label ?? 'powerQuadratic',
    base: opts.base,
    at: (base, ctx, n) => powerQuadraticAt(base, runParam(q, ctx), runParam(c, ctx), n),
    inverse: (base, ctx, v) => powerQuadraticInverse(base, runParam(q, ctx), runParam(c, ctx), v),
  })
}

/** 双重指数曲线(加速器加成价格):base^(2^n·m·base) */
export function powerDoubleExp(opts: {
  m: CurveParam
  base?: CurveParam
  label?: string
}): Curve {
  const m = opts.m
  return makeCurve({
    label: opts.label ?? 'powerDoubleExp',
    base: opts.base,
    at: (base, ctx, n) => powerDoubleExpAt(base, runParam(m, ctx), n),
    inverse: (base, ctx, v) => powerDoubleExpInverse(base, runParam(m, ctx), v),
  })
}

/**
 * 把曲线正向取整(价格向下取整)
 * 逆向不建模取整:锚点允许偏差(精确性由maxSatisfying的逐步校验保证)
 */
export function floored(curve: Curve): Curve {
  const out: Curve = {
    at: (n, ctx) => curve.at(n, ctx).floor(),
    inverse: (v, ctx) => curve.inverse(v, ctx),
  }
  if (curve.ratio) out.ratio = (ctx) => curve.ratio!(ctx)
  return out
}
