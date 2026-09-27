//测试脚本共用的断言、引导与工具(用法见scripts/run-ts.mjs)
//约定:脚本用check记录断言,最后reportChecks()打印汇总;开发构建的自检走console.error,
//      用captureErrors()把它们变成断言(否则只会打印、不会让脚本失败)
//本文件同时负责"游戏引导":导入各系统的注册模块,使脚本拥有与游戏启动相同的注册状态
import { readdirSync, readFileSync } from 'node:fs'
import Decimal from 'break_eternity.js'
import { initializeSave, player } from '@/data/player'
import { initializeLayer, type LayerId } from '@/data/types'
import { getLayer, invalidateLayerOrder } from '@/access'
import { layerKey } from '@/tools/ordinal'
import { importSaveString } from '@/save/save'
//触发各系统的效果/成就/挑战注册(均为副作用导入,与app/core.ts的引用图一致)
import '@/compute/upgrades'
import '@/compute/crossLayer'
import '@/compute/infinity'
import '@/compute/infinityMilestones'
import '@/compute/metaDimension'
import '@/logic/achievements'
import '@/logic/challenges'

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

/**
 * 载入仓库根目录下的真实存档(未找到或载入失败时保持当前状态)
 * 真实存档能让断言覆盖到只在后期才生效的分支
 * @returns 实际载入的文件名(未载入为空串)
 */
export function loadRealSave(): string {
  const file = readdirSync('.').find(
    (f) => f.startsWith('TransfiniteLayers-') && f.endsWith('.txt'),
  )
  if (!file) {
    console.log('  未找到真实存档,使用初始状态')
    return ''
  }
  const ok = importSaveString(readFileSync(file, 'utf8').trim())
  console.log(`  载入真实存档 ${file}:${ok ? '成功' : '失败(改用初始状态)'}`)
  return ok ? file : ''
}

/**把内存中的存档恢复为空白存档(构造测试状态前先调用) */
export function freshSave() {
  Object.assign(player, initializeSave())
}

/**
 * 确保0阶的层级1..slot都存在(构造多层级测试状态用)
 * 高度按槽位号给(层级n的高度为n),使同一窗口内的高度严格递增
 */
export function ensureLayer0Order(slot: number) {
  for (let i = 1; i <= slot; i++) {
    const pos: LayerId = [i]
    if (!getLayer(pos)) player.layers[layerKey(pos)] = initializeLayer(i)
  }
  player.layerDepth = Math.max(player.layerDepth, slot + 1)
  invalidateLayerOrder()
}
