//平衡模拟CLI:无头跑真实游戏循环,输出指标快照与进度时间线
//用法:node scripts/run-ts.mjs scripts/sim.ts [分钟数] [步长秒] [打印间隔秒] [--bot=greedy|none] [--fresh] [--max-step=秒] [--no-challenges]
//  分钟数     模拟的游戏时间(缺省10)
//  步长秒     有动作时的基础步长(缺省1;越接近1/60越真实,但越慢)
//  打印间隔秒 每多少游戏时间打印一行(缺省60)
//  --bot      机器人策略:greedy=贪心模拟玩家(缺省),none=挂机观察(只看游戏内自动化)
//  --fresh    无视真实存档,从空白档开始
//  --max-step 无动作时步长放大的上限(缺省60;等于步长即固定步长)
//  --no-challenges 机器人不主动进挑战(从真实存档继续做实验时用:进挑战会强制重置甚至无限重置)
//  --unlock-gate=点数 解锁新层级所需的最低层级0点数(缺省1e100=先拿到a28与挑战;填1=一够条件就解锁)
//  --reset-mult=倍数   层级重置要求"本次收益 ≥ 历史最佳收益×该倍数"(缺省2;调小=重置更频繁)
//  --verbose  每行指标快照后附上各层级状态(诊断用)
//不指定--bot时按挂机观察跑(与旧版行为一致);策略与口径见 docs/面向开发者/测试与平衡.md
import { format, formatTime, formatWhole } from '@/tools/format'
import { GREEDY_DEFAULTS, greedyPolicy, nonePolicy, runSim, type SimRow } from './bot'

/**读取一个命令行数字参数(缺省或非法时用默认值) */
function arg(index: number, fallback: number): number {
  const v = Number(process.argv[2 + index])
  return isFinite(v) && v > 0 ? v : fallback
}
/**读取--key=value形式的参数 */
function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}
/**是否带开关 */
function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const minutes = arg(0, 10)
const step = arg(1, 1)
const every = arg(2, 60)
const bot = flag('bot') ?? (has('bot') ? 'greedy' : 'none')
const maxStep = Number(flag('max-step') ?? 60)
const unlockGate = Number(flag('unlock-gate') ?? 0)
const resetMult = Number(flag('reset-mult') ?? 0)

console.log('=== 平衡模拟 ===')
console.log(`  策略 ${bot},基础步长 ${step} 秒,共 ${minutes} 分钟游戏时间,每 ${every} 秒打印一行`)
const result = runSim({
  seconds: minutes * 60,
  dt: step,
  maxDt: bot == 'none' ? step : maxStep,
  every,
  fresh: has('fresh'),
  verbose: has('verbose'),
  policy:
    bot == 'none'
      ? nonePolicy()
      : greedyPolicy({
          ...GREEDY_DEFAULTS,
          challenges: !has('no-challenges'),
          unlockGate: unlockGate > 0 ? unlockGate : GREEDY_DEFAULTS.unlockGate,
          resetMult: resetMult > 0 ? resetMult : GREEDY_DEFAULTS.resetMult,
        }),
  onEvent: (text) => console.log(`  ${text}`),
})

/**把一行快照格式化成可读文本 */
function row(r: SimRow): string {
  return [
    `t=${formatTime(r.t)}`,
    `层0点数=${format(r.points0)}`,
    `层级数=${r.layerCount}`,
    `最高层=${r.highest}`,
    `IP=${format(r.ip)}`,
    `无限重置=${formatWhole(r.infinityResets)}`,
    `知识=${format(r.knowledge)}`,
    `挑战=${formatWhole(r.challengeCompletions)}`,
    `成就=${r.achievements}`,
    `结构=${r.structure}`,
  ].join(' ')
}
console.log('=== 指标快照 ===')
for (const r of result.rows) {
  console.log(`  ${row(r)}`)
  for (const line of r.layers ?? []) console.log(line)
}
const last = result.rows[result.rows.length - 1]!
console.log(
  `跑了 ${result.frames} 步,${(result.realMs / 1000).toFixed(1)} 秒现实时间` +
    `(游戏时间 ${formatTime(last.t)})`,
)
