//重置规则扫参/长测:同一起点跑多套命名规则,比较各里程碑的到达时刻(可复现的对照实验)
//用法:node scripts/run-ts.mjs scripts/sweep.ts [分钟数=180] [步长秒=1] [--configs=名,名] [--verbose]
//  --dump=目录     在到达每个里程碑时导出存档(下次用 --save=目录/文件名.txt 从该节点继续,省掉重跑前段)
//  --save=路径     从指定存档开始(仓库相对路径;通常是 --dump 出来的节点档)
//  --ready=N --prepare-energy=N --prepare-dim=N  放宽/收紧进挑战的门槛(扫参用)
//  --stall=N --timeout=N  覆盖挑战内的"停滞放弃"与"最长尝试"秒数(缺省900/7200)
//  --open-points=N  第一次层级1重置前要求的层级0点数(缺省0=够条件就解锁)
//  规则集写在 scripts/config/ 下的JSON里(文件名去扩展名即规则名;缺省全部跑;不指定时补一个baseline)
//  现存的规则集与各自的用途:
//   a-default   空规则(baseline,走通用贪心回退),对照用
//   acc2        层级2只给minGain(永不首次重置):修"空层立刻重置"死锁后的推荐配置
//   g2-e0      层级2的首次重置门槛1点(=旧行为,必然死锁的负对照)
//   g2-e4/e6/e8 层级2首次重置门槛1e4/1e6/1e8(三个门槛都够不到,故与acc2等价)
//   l1-mult2   层级1按"收益≥历史最佳×2"重置(重置得最勤,负对照)
//口径见 docs/面向开发者/测试与平衡.md §五
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayer, getOrderedLayers, getPoints, hasAchievement, normalChallengeCompletions } from '@/access'
import { exportSaveString } from '@/save/save'
import { format, formatTime, formatWhole } from '@/tools/format'
import { hasInfinityUpgrade } from '@/compute/infinity'
import { isWorldCapacityReached } from '@/logic/layerStructure'
import { PHASED_DEFAULTS, phasedPolicy, RuleSet, runSim, type BotRuleConfig, type SimRow } from './bot'

/**读取--key=value形式的参数 */
function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

const minutes = Number(process.argv[2] ?? 0) || 180
const dt = Number(process.argv[3] ?? 0) || 1
const verbose = process.argv.includes('--verbose')
const only = flag('configs')?.split(',')
const dumpDir = flag('dump')
const savePath = flag('save')
/**进挑战的门槛(扫参时可放宽,用来看"挑战本身能不能打完") */
const challengeReady = Number(flag('ready') ?? 0) || PHASED_DEFAULTS.challengeReady
const challengePrepareEnergy = Number(flag('prepare-energy') ?? -1)
const challengePrepareDim = Number(flag('prepare-dim') ?? -1)
/**挑战内的"停滞放弃"秒数(覆盖缺省900:挑战内目标资源是翻倍式增长,耐心比超时更重要) */
const stallSec = Number(flag('stall') ?? -1)
/**挑战的最长尝试秒数(覆盖缺省7200) */
const timeoutSec = Number(flag('timeout') ?? -1)
/**第一次层级1重置(解锁层级1)前要求的层级0点数(覆盖缺省0=够条件就解锁) */
const openPoints = Number(flag('open-points') ?? -1)

/**本次运行的层0点数峰值(里程碑判定要用它:层0点数会被重置削平,瞬时值会低估进度) */
let peakReached = new Decimal(1)
/**本次运行的"层级1点数峰值"与"层级2点数"峰值(诊断层级1/层级2为什么不动) */
let l1Peak = new Decimal(0)
let l2Peak = new Decimal(0)

/**一个里程碑:名字+判定 */
interface Milestone {
  name: string
  done(): boolean
}
/**里程碑表(顺序即到达顺序;每个里程碑只有第一次到达会被记时) */
const MILESTONES: Milestone[] = [
  { name: '层级1', done: () => getOrderedLayers('asc').length > 1 },
  { name: 'a24', done: () => hasAchievement('a24') },
  { name: '层级2', done: () => getOrderedLayers('asc').length > 2 },
  { name: 'e50', done: () => peakReached.gte(1e50) },
  { name: 'a28/e100', done: () => hasAchievement('a28') },
  { name: 'e150', done: () => peakReached.gte(1e150) },
  { name: '层级3', done: () => getOrderedLayers('asc').length > 3 },
  { name: 'e308/无限', done: () => peakReached.gte(Number.MAX_VALUE) },
  { name: 'c1完成', done: () => normalChallengeCompletions().gte(1) },
  { name: '层级4', done: () => getOrderedLayers('asc').length > 4 },
  { name: '无限重置1', done: () => player.infinityResets.gte(1) },
  { name: 'iu15', done: () => hasInfinityUpgrade('iu15') },
  { name: 'iu25', done: () => hasInfinityUpgrade('iu25') },
  { name: '世界上限', done: () => isWorldCapacityReached([-1]) },
]

/**一次扫参运行的配置 */
interface SweepCase {
  name: string
  config: BotRuleConfig
}

/**从 scripts/config/ 读规则集(文件名去扩展名即规则名) */
function loadCases(): SweepCase[] {
  const files = readdirSync('scripts/config')
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !only || only.includes(f.replace(/\.json$/, '')))
    .sort()
  const cases: SweepCase[] = files.map((f) => ({
    name: f.replace(/\.json$/, ''),
    config: JSON.parse(readFileSync(`scripts/config/${f}`, 'utf8')) as BotRuleConfig,
  }))
  //显式点名了却没有文件时,仍跑一个基线,避免"什么都没跑"的假结论
  if (cases.length == 0)
    cases.push({ name: only ? 'baseline(未找到规则集)' : 'baseline', config: {} })
  return cases
}

/**一次运行的结果 */
interface RunResult {
  name: string
  /**各里程碑的到达时间(秒;null=未到达) */
  times: (number | null)[]
  rows: SimRow[]
  peak: Decimal
  layers: number
  achievements: number
  knowledge: Decimal
  infinityResets: string
  challenges: string
  l1Peak: Decimal
  l2Peak: Decimal
  realMs: number
}

/**里程碑名 → 文件名安全的slug */
function slug(name: string): string {
  return name.replace(/[^\w\u4e00-\u9fa5]+/g, '-')
}

/**
 * 跑一次配置并收集里程碑时间
 * @param seconds 模拟时长(秒)
 * @param dumpTo 非空时在每个里程碑导出存档到该目录(首次到达才导出)
 */
function runCase(c: SweepCase, seconds: number, dumpTo?: string): RunResult {
  const reached: (number | null)[] = MILESTONES.map(() => null)
  peakReached = new Decimal(1)
  l1Peak = new Decimal(0)
  l2Peak = new Decimal(0)
  const policy = phasedPolicy({
    ...PHASED_DEFAULTS,
    ruleSet: new RuleSet(c.config),
    challengeReady,
    ...(challengePrepareEnergy >= 0 ? { challengePrepareEnergy } : {}),
    ...(challengePrepareDim >= 0 ? { challengePrepareDim } : {}),
    ...(stallSec > 0 ? { challengeStallTime: stallSec } : {}),
    ...(timeoutSec > 0 ? { challengeTimeout: timeoutSec } : {}),
    ...(openPoints >= 0 ? { openPoints } : {}),
    resetLog: verbose ? (text) => console.log(`    ${text}`) : undefined,
    onNote: verbose ? (text) => console.log(`    ${text}`) : () => {},
  })
  const result = runSim({
    seconds,
    dt,
    maxDt: dt,
    every: Math.max(60, seconds / 40),
    fresh: !savePath,
    saveFile: savePath,
    policy,
    onStep: (elapsed) => {
      const t = elapsed.toNumber()
      peakReached = Decimal.max(peakReached, getPoints([0]))
      l1Peak = Decimal.max(l1Peak, getLayer([1])?.points ?? new Decimal(0))
      l2Peak = Decimal.max(l2Peak, getLayer([2])?.points ?? new Decimal(0))
      for (let i = 0; i < MILESTONES.length; i++) {
        if (reached[i] != null || !MILESTONES[i]!.done()) continue
        reached[i] = t
        if (dumpTo) {
          mkdirSync(dumpTo, { recursive: true })
          const file = `${dumpTo}/${c.name}-${String(i).padStart(2, '0')}-${slug(MILESTONES[i]!.name)}.txt`
          writeFileSync(file, exportSaveString())
        }
      }
    },
  })
  let peak = new Decimal(1)
  for (const r of result.rows) peak = Decimal.max(peak, r.points0Peak)
  peak = Decimal.max(peak, peakReached)
  const last = result.rows[result.rows.length - 1]!
  return {
    name: c.name,
    times: reached,
    rows: result.rows,
    peak,
    layers: last.layerCount,
    achievements: last.achievements,
    knowledge: last.knowledgeLevels,
    infinityResets: last.infinityResets.toString(),
    challenges: last.challengeCompletions.toString(),
    l1Peak,
    l2Peak,
    realMs: result.realMs,
  }
}

/**把一个里程碑时间格式化 */
function fmtTime(t: number | null): string {
  return t == null ? '—' : formatTime(new Decimal(t))
}

const cases = loadCases()
const seconds = minutes * 60
console.log('=== 重置规则扫参 ===')
console.log(
  `  游戏时间 ${minutes} 分钟,步长 ${dt} 秒,起点 ${savePath ?? '空白档'},规则集:${cases.map((c) => c.name).join(', ')}`,
)
const rows: RunResult[] = []
for (const c of cases) {
  const r = runCase(c, seconds, dumpDir)
  rows.push(r)
  console.log(
    `  ${r.name}: 层级数=${r.layers} 层0峰值=${format(r.peak)} 层1峰值点数=${format(r.l1Peak)}` +
      ` 层2峰值点数=${format(r.l2Peak)} 成就=${r.achievements}` +
      ` 无限重置=${r.infinityResets} 挑战=${r.challenges} 知识等级=${formatWhole(r.knowledge)}` +
      ` (${(r.realMs / 1000).toFixed(0)}秒现实)`,
  )
}
console.log('')
const width = Math.max(16, ...rows.map((r) => r.name.length + 2))
console.log(`  ${'里程碑'.padEnd(12)}${rows.map((r) => r.name.padStart(width)).join('')}`)
for (let i = 0; i < MILESTONES.length; i++) {
  const line = rows.map((r) => fmtTime(r.times[i] ?? null).padStart(width)).join('')
  console.log(`  ${MILESTONES[i]!.name.padEnd(12)}${line}`)
}
if (verbose) {
  console.log('')
  for (const r of rows) {
    console.log(`  --- ${r.name} 曲线(层0峰值/层级数/成就/挑战/层1峰值点数/层2点数) ---`)
    for (const row of r.rows) {
      console.log(
        `    t=${formatTime(row.t)} 层0峰值=${format(row.points0Peak)} 层级数=${row.layerCount}` +
          ` 成就=${row.achievements} 挑战=${formatWhole(row.challengeCompletions)} 阶段=${row.phase ?? '-'}`,
      )
    }
  }
}
