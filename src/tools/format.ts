//数字格式化函数
import Decimal, { type DecimalSource } from 'break_eternity.js'

/**
 * 科学计数法:把double按precision位有效数字格式化为"m.eX"
 * 用toExponential直接取尾数,避免手算除法/幂的精度损失,并正确处理尾数进位到10的情况
 */
function sci(mag: number, precision: number): string {
  const [mantissa, expStr] = mag.toExponential(precision).split('e')
  const exp = parseInt(expStr ?? '0').toString()
  return `${mantissa}e${exp}`
}

/**
 * 指数塔表示:用于layer>=1的数(10^10^...^mag)
 * mag>=1e6直接走科学计数;否则手算10^(mag小数部分),并把尾数进位并入指数(避免"10.000e999999")
 */
function expTower(mag: number, layers: number, precision: number): string {
  if (mag >= 1e6) return 'e'.repeat(layers) + sci(mag, precision)
  const exp = Math.floor(mag)
  const mantissa = Math.pow(10, mag - exp)
  const [man, expStr] = mantissa.toExponential(precision).split('e')
  const totalExp = exp + parseInt(expStr ?? '0')
  return 'e'.repeat(layers - 1) + `${man}e${totalExp}`
}

//一般的格式化
export function format(x: DecimalSource, precision: number = 3): string {
  const xd: Decimal = new Decimal(x)
  if (xd.isNan()) return 'NaN'
  else if (xd.sign < 0) return '-' + format(xd.neg(), precision)
  else if (!xd.isFinite()) return 'Infinity'
  else if (xd.layer >= 1e6) return 'F' + format(xd.slog(), precision)
  else if (xd.layer >= 5) return xd.mag.toFixed(precision) + 'F' + xd.layer
  else if (xd.layer >= 1) return expTower(xd.mag, xd.layer, precision)
  else if (xd.gte(1e6)) return sci(xd.mag, precision)
  else if (xd.gte(1000)) return xd.mag.toFixed(0)
  else if (xd.gte(0.001)) return xd.mag.toFixed(precision)
  //0<x<0.001:用科学计数法提供更精确的表示,有效数字与precision一致(如precision=3→"1.23e-4")
  else if (xd.gt(0)) return sci(xd.mag, Math.max(precision - 1, 0))
  return (0).toFixed(precision)
}
//格式化整数
//Copied from "The moddin tree"
export function formatWhole(x: DecimalSource) {
  const xd: Decimal = new Decimal(x)
  //1e6以上走科学计数,保留3位有效数字(避免1e6~1e9只显示1位)
  if (xd.gte(1e6)) return format(xd, 2)
  if (xd.lte(0.99) && !xd.eq(0)) return format(xd, 2)
  return format(xd, 0)
}
//格式化时间
export function formatTime(x: DecimalSource): string {
  const xd = new Decimal(x)
  if (xd.eq(0)) return '0秒'
  else if (xd.lt(0)) return '-' + formatTime(xd.neg())
  else if (xd.gte(3.1536e9)) return format(xd.div(31536000)) + '年'
  else {
    const xn = xd.toNumber()
    if (xn >= 31536000) return (xn / 31536000).toFixed(0) + '年' + (xn % 31536000).toFixed(2) + '天'
    else if (xn >= 1) {
      const seconds = xn % 60
      const minutes = Math.floor(xn / 60) % 60
      const hours = Math.floor(xn / 3600) % 24
      const days = Math.floor(xn / 86400)
      return (
        (xn >= 86400 ? days + '天' : '') +
        (xn >= 3600 ? hours + '小时' : '') +
        (xn >= 60 ? minutes + '分' : '') +
        (seconds.toFixed(3) + '秒')
      )
    } else if (xn > 1e-3) return (xn * 1000).toFixed(0) + '毫秒'
    else return '<1毫秒'
  }
}
