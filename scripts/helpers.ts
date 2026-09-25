//测试脚本共用的断言与工具(用法见scripts/run-ts.mjs)
//约定:脚本用check记录断言,最后reportChecks()打印汇总;开发构建的自检走console.error,
//      用captureErrors()把它们变成断言(否则只会打印、不会让脚本失败)
import Decimal from 'break_eternity.js'

let checks = 0
let failures: string[] = []

/**记录一次断言 */
export function check(name: string, ok: boolean, detail = '') {
  checks++
  if (ok) return
  failures.push(`${name}${detail ? ` (${detail})` : ''}`)
}

/**相对误差(a相对b) */
export function relErr(a: Decimal, b: Decimal): number {
  if (b.eq(0)) return a.abs().toNumber()
  return a.sub(b).div(b).abs().toNumber()
}

/**
 * 两个购买数量是否一致
 * 小数量级要求逐位相等;大到Decimal分辨不出+1时(约1e16以上)只要求相对差<1e-9,
 * 因为此时"k与k+1"本身就不可分辨,任何求解器都只能给出同一个数
 */
export function sameCount(a: Decimal, b: Decimal): boolean {
  if (a.eq(b)) return true
  if (a.lte(0) || b.lte(0)) return false
  return a.gt('1e15') && relErr(a, b) < 1e-9
}

/**
 * 捕获console.error(开发构建的自检都用它报警)
 * @returns 取回已捕获内容并恢复原实现的函数
 */
export function captureErrors(): () => string[] {
  const captured: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    captured.push(args.map((a) => String(a)).join(' '))
  }
  return () => {
    console.error = original
    return captured
  }
}

/**打印汇总;返回是否全部通过 */
export function reportChecks(): boolean {
  const ok = failures.length == 0
  console.log(`\n${ok ? '全部通过' : '存在失败'}:${checks} 条断言,失败 ${failures.length} 条`)
  for (const f of failures.slice(0, 30)) console.error(`  ✗ ${f}`)
  if (failures.length > 30) console.error(`  ...另有 ${failures.length - 30} 条`)
  failures = []
  checks = 0
  return ok
}
