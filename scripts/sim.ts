//平衡模拟脚本:无头跑真实的游戏循环,输出进度时间线与收尾快照
//用途:改数值后看趋势(而不是在浏览器里手点几十分钟),以及新机制的推进是否卡住
//用法:node scripts/run-ts.mjs scripts/sim.ts [分钟数] [步长秒] [打印间隔秒]
//  分钟数   模拟的游戏时间(缺省10)
//  步长秒   每次gameLoop的dt(缺省1;越小越接近真实60帧,但越慢)
//  打印间隔秒 每经过这么多游戏时间打印一行(缺省60)
//会先尝试载入仓库根目录的真实存档(用真实进度做基准),否则从空白档开始
//注意:步长>1/60时,自动化与重置的判定粒度比真实游玩粗(时间类条件仍按累计时间比较)
//详见docs/面向开发者/测试与平衡.md
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getHighestActiveLayer, getLayerName, getOrderedLayers, getPoints } from '@/access'
import { format, formatTime, formatWhole } from '@/tools/format'
import { gameLoop } from '@/app/core'
import { loadRealSave } from './helpers'

/**读取一个命令行数字参数(缺省或非法时用默认值) */
function arg(index: number, fallback: number): number {
  const v = Number(process.argv[2 + index])
  return isFinite(v) && v > 0 ? v : fallback
}

const minutes = arg(0, 10)
const step = arg(1, 1)
const every = arg(2, 60)
const total = minutes * 60
const dt = new Decimal(step)

console.log('=== 平衡模拟 ===')
loadRealSave()
console.log(`  步长 ${step} 秒/次,共 ${minutes} 分钟游戏时间,每 ${every} 秒打印一行`)

/**一行进度快照 */
function snapshot(t: number): string {
  const highest = getHighestActiveLayer()
  return [
    `t=${formatTime(new Decimal(t))}`,
    `层0点数=${format(getPoints([0]))}`,
    `最高层=${highest ? getLayerName(highest) : '-'}`,
    `IP=${format(player.infinityPoints)}`,
    `无限重置=${formatWhole(player.infinityResets)}`,
    `成就=${player.achievements.length}`,
  ].join(' ')
}

const started = Date.now()
let t = 0
let next = 0
let layers = getOrderedLayers('asc').length
let resets = player.infinityResets.toString()
console.log(`  ${snapshot(0)}`)
while (t < total) {
  gameLoop(dt)
  t += step
  //进度时间线:解锁层级与无限重置是平衡的主要观察点,发生时立刻打一行
  const nowLayers = getOrderedLayers('asc').length
  if (nowLayers != layers) {
    layers = nowLayers
    console.log(
      `  [层级] t=${formatTime(new Decimal(t))} 层级数=${nowLayers} ` +
        `最高层=${getLayerName(getHighestActiveLayer() ?? [0])} 层0点数=${format(getPoints([0]))}`,
    )
  }
  if (player.infinityResets.toString() != resets) {
    resets = player.infinityResets.toString()
    console.log(
      `  [无限] t=${formatTime(new Decimal(t))} 第${formatWhole(player.infinityResets)}次,` +
        `本次用时${formatTime(player.infinityRunTime)} IP=${format(player.infinityPoints)}`,
    )
  }
  if (t >= next) {
    next += every
    console.log(`  ${snapshot(t)}`)
  }
}
console.log(`  ${snapshot(t)}`)

console.log('=== 收尾:各层级 ===')
for (const e of getOrderedLayers('asc')) {
  console.log(
    `  ${e.key.padEnd(6)} 点数=${format(e.L.points)} 能量=${format(e.L.energy)} ` +
      `重置次数=${formatWhole(e.L.resetCount)} 重置计时=${formatTime(e.L.resetTime)}`,
  )
}
console.log(`知识=${format(player.knowledge)} 最佳IP/秒=${format(player.infinityBestRate)}`)
console.log(`模拟 ${total} 秒游戏时间用了 ${((Date.now() - started) / 1000).toFixed(1)} 秒现实时间`)
