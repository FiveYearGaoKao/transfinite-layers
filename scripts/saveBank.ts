//基准存档银行:从空白档跑机器人,在几个阶段节点导出可直接导入的存档(用途与命名见 saves/README.md)
//用法:node scripts/run-ts.mjs scripts/saveBank.ts [--minutes=分钟] [--stages=01,02] [--opening=invest|fast] [--dt=秒] [--no-a24]
//  分钟数  模拟的游戏时间上限(缺省1440=24小时);阶段没跑齐时会明确报出来
//  阶段    只导出这些序号(缺省全部);机器人的起点始终是空白档,故序号不影响推进过程
import { mkdirSync, writeFileSync } from 'node:fs'
import Decimal from 'break_eternity.js'
import { gameVersion } from '@/data/constants'
import { initializeSave, player } from '@/data/player'
import { getLayerName, getOrderedLayers, hasAchievement } from '@/access'
import { hasInfinityUpgrade } from '@/compute/infinity'
import { isWorldCapacityReached } from '@/logic/layerStructure'
import { exportSaveString } from '@/save/save'
import { formatTime, formatWhole } from '@/tools/format'
import { phasedPolicy, PHASED_DEFAULTS, runSim } from './bot'

/**基准档的一个阶段:判定条件一旦成立就导出当前存档 */
interface BankStage {
  id: string
  slug: string
  /**阶段中文名(打印与 saves/README.md 的阶段表用) */
  name: string
  done(): boolean
}

/**阶段表(顺序即推进顺序;判定一律读游戏状态,不看时间) */
const STAGES: BankStage[] = [
  { id: '01', slug: 'start', name: '开局', done: () => true },
  { id: '02', slug: 'challenges', name: '解锁挑战', done: () => hasAchievement('a28') },
  { id: '03', slug: 'infinity', name: '第1次无限重置', done: () => player.infinityResets.gte(1) },
  {
    id: '04',
    slug: 'infinity-challenges',
    name: '解锁无限挑战',
    done: () => hasInfinityUpgrade('iu15'),
  },
  { id: '05', slug: 'meta-boost', name: '解锁元维度提升', done: () => hasInfinityUpgrade('iu25') },
  {
    id: '06',
    slug: 'world-limit',
    name: '世界容量上限',
    done: () => isWorldCapacityReached([-1]),
  },
]

const OUT_DIR = 'saves'
/**读取--key=value形式的参数 */
function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

const minutes = Number(flag('minutes') ?? 0) || 1440
const dt = Number(flag('dt') ?? 0) || 1
const opening = flag('opening') == 'fast' ? 'fast' : 'invest'
const only = flag('stages')?.split(',')
const wanted = STAGES.filter((s) => !only || only.includes(s.id))
/**已经导出过的阶段 */
const doneStages = new Set<string>()

/**导出一份基准档(文件名:游戏名-版本-baseline-序号-阶段.txt) */
function writeStage(stage: BankStage, elapsed: Decimal) {
  mkdirSync(OUT_DIR, { recursive: true })
  const file = `${OUT_DIR}/TransfiniteLayers-${gameVersion}-baseline-${stage.id}-${stage.slug}.txt`
  writeFileSync(file, exportSaveString())
  const layers = getOrderedLayers('asc')
  const top = layers[layers.length - 1]
  console.log(
    `  [${stage.id}] ${formatTime(elapsed)} ${stage.name} → ${file}` +
      ` (最高层=${top ? getLayerName(top.pos) : '-'},成就=${formatWhole(player.achievements.length)})`,
  )
}

console.log('=== 基准存档银行 ===')
console.log(
  `  导出到 ${OUT_DIR}/,阶段 ${wanted.map((s) => s.id).join(',')},共 ${minutes} 分钟游戏时间`,
)
//开局档就是空白档(确定性,不必跑机器人)
Object.assign(player, initializeSave())
const first = wanted.find((s) => s.id == '01')
if (first) {
  doneStages.add(first.id)
  writeStage(first, new Decimal(0))
}

const policy = phasedPolicy({
  ...PHASED_DEFAULTS,
  opening,
  huntA24: !process.argv.includes('--no-a24'),
  onNote: (text) => console.log(`  ${text}`),
})
const result = runSim({
  seconds: minutes * 60,
  dt,
  maxDt: 60,
  every: minutes * 60 + 1,
  fresh: true,
  policy,
  onEvent: (text) => console.log(`  ${text}`),
  onStep: (elapsed) => {
    for (const stage of wanted) {
      if (doneStages.has(stage.id) || !stage.done()) continue
      doneStages.add(stage.id)
      writeStage(stage, elapsed)
    }
  },
})

const missing = wanted.filter((s) => !doneStages.has(s.id))
console.log(
  `跑了 ${result.frames} 步,${(result.realMs / 1000).toFixed(1)} 秒现实时间` +
    `(游戏时间 ${formatTime(new Decimal(minutes * 60))})`,
)
if (missing.length > 0)
  console.log(
    `  未到达:${missing.map((s) => `${s.id} ${s.name}`).join('、')}` +
      `(需要更长时间,或先按测试与平衡.md调整机器人策略)`,
  )
