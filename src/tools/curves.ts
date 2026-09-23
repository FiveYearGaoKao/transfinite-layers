//指数型公式族的纯数学(正逆同源)
//放在tools:不读player/槽位,参数一律已解析;绑定参数来源的糖在compute/curves.ts
//约定:不可逆或越界一律返回undefined,由调用方退回通用搜索(锚点只影响迭代次数)
import Decimal, { type DecimalSource } from 'break_eternity.js'

/** 值是否可安全取对数(正且有限) */
function loggable(v: Decimal): boolean {
  return v.isFinite() && v.gt(0)
}

/**
 * 指数线性形状:base^(a + b·n)
 * 维度价格(a=id,b=id+1)、加速器价格(a=1,b=1/2)、挑战目标(a=目标指数常数)都属于该形状
 */
export function expLinearAt(base: Decimal, a: Decimal, b: Decimal, n: Decimal): Decimal {
  return base.pow(b.mul(n).add(a))
}

/**
 * 指数线性形状的逆:n = (log_base(v) - a)/b
 * @returns 数量;不可逆(base≤1、b=0、v非正)时返回undefined
 */
export function expLinearInverse(
  base: Decimal,
  a: Decimal,
  b: Decimal,
  v: DecimalSource,
): Decimal | undefined {
  const value = new Decimal(v)
  if (!base.gt(1) || b.eq(0) || !loggable(value)) return undefined
  return value.log(base).sub(a).div(b)
}

/** 幂二次形状(加倍器价格):base^(n·(1 + q·n) + c) */
export function powerQuadraticAt(
  base: Decimal,
  q: Decimal,
  c: Decimal,
  n: Decimal,
): Decimal {
  //写法与原公式逐位一致(n*(q*n+1)+c):浮点结合顺序不同会产生~1e-15的相对差
  return base.pow(n.mul(q.mul(n).add(1)).add(c))
}

/**
 * 幂二次形状的逆:解 q·n² + n + (c - log_base(v)) = 0,取正根
 * n = (√(1 + 4q(E - c)) - 1)/(2q),E = log_base(v)
 * @returns 数量;不可逆(q≤0、判别式为负、v非正)时返回undefined
 */
export function powerQuadraticInverse(
  base: Decimal,
  q: Decimal,
  c: Decimal,
  v: DecimalSource,
): Decimal | undefined {
  const value = new Decimal(v)
  if (!base.gt(1) || !q.gt(0) || !loggable(value)) return undefined
  const e = value.log(base)
  const disc = new Decimal(1).add(q.mul(4).mul(e.sub(c)))
  if (!disc.gte(0)) return undefined
  return disc.sqrt().sub(1).div(q.mul(2))
}

/** 双重指数形状(加速器加成价格):base^(2^n · m · base) */
export function powerDoubleExpAt(base: Decimal, m: Decimal, n: Decimal): Decimal {
  //写法与原公式逐位一致:(2^n * m) * base
  return base.pow(new Decimal(2).pow(n).mul(m).mul(base))
}

/**
 * 双重指数形状的逆:n = log2(log_base(v)/(m·base))
 * @returns 数量;不可逆(m≤0、log_base(v)/(m·base)≤1、v非正)时返回undefined
 */
export function powerDoubleExpInverse(
  base: Decimal,
  m: Decimal,
  v: DecimalSource,
): Decimal | undefined {
  const value = new Decimal(v)
  if (!base.gt(1) || !m.gt(0) || !loggable(value)) return undefined
  const e = value.log(base).div(m.mul(base))
  if (!e.gt(1)) return undefined
  return e.log(2)
}
