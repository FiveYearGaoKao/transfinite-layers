//诊断曲线:每N秒一行各层状态 + 每次重置/级联清空一行事件(定位"某层为什么长期不动")
//用法:node scripts/run-ts.mjs scripts/curve.ts [分钟数=180] [步长秒=1] [--every=300] [--rules=JSON] [--config=名字]
//  事件行来自bot的回合快照对比:层级重置会把下层级联清空(那次不发收益、也不走onReset),
//  只在"点重置"处打日志会漏掉级联——所以诊断要对比前后快照,而不是在重置点打日志
import { readFileSync } from 'node:fs'
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayer, getOrderedLayers, normalChallengeCompletions } from '@/access'
import { format, formatTime } from '@/tools/format'
import { resetGain, resetThreshold, resetExponent } from '@/compute/prestige'
import { buyableAmount } from '@/compute/buyables'
import { challengeGoal, challengeResource, getAllChallenges, isActive } from '@/logic/challenges'
import { PHASED_DEFAULTS, phasedPolicy, RuleSet, runSim, type BotRuleConfig } from './bot'

/**读取--key=value形式的参数 */
function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

const minutes = Number(process.argv[2] ?? 0) || 180
const dt = Number(process.argv[3] ?? 0) || 1
const every = Number(flag('every') ?? 0) || 300
const rulesJson = flag('rules')
const cfgName = flag('config')
const config: BotRuleConfig = rulesJson
  ? (JSON.parse(rulesJson) as BotRuleConfig)
  : cfgName
    ? (JSON.parse(readFileSync(`scripts/config/${cfgName}.json`, 'utf8')) as BotRuleConfig)
    : {}

let nextAt = 0
const policy = phasedPolicy({
  ...PHASED_DEFAULTS,
  ruleSet: new RuleSet(config),
  resetLog: (text) => console.log(`  ${text}`),
  onNote: (text) => console.log(`  ${text}`),
})
runSim({
  seconds: minutes * 60,
  dt,
  maxDt: dt,
  every: 1e9,
  fresh: true,
  policy,
  onStep: (elapsed) => {
    const t = elapsed.toNumber()
    if (t < nextAt) return
    nextAt = t + every
    const active = getAllChallenges().find((d) => isActive(d))
    const parts: string[] = [
      `t=${formatTime(elapsed)}`,
      `阶段=${policy.phase?.() ?? '-'}`,
      `层级数=${getOrderedLayers('asc').length}`,
      `成就=${player.achievements.length}`,
      `挑战完成=${format(normalChallengeCompletions())}`,
      `层0加速器=${format(buyableAmount([0], 11))}`,
      `层0加倍器=${format(buyableAmount([0], 12))}`,
    ]
    for (const e of getOrderedLayers('asc')) {
      parts.push(
        `[${e.key}] 点=${format(e.L.points)} 能=${format(e.L.energy)}` +
          ` 收益=${format(resetGain(e.pos))} 重置=${format(e.L.resetCount)}` +
          ` 维=${e.L.dimensions.map((d) => format(d[1])).join('/')}`,
      )
    }
    if (active)
      parts.push(`挑战中=${active.id} ${format(challengeResource(active))}/${format(challengeGoal(active))}`)
    console.log(`  == ${parts.join(' ')}`)
    if (getLayer([1])) {
      console.log(
        `     层1门槛=${format(resetThreshold([1]))} 指数=${format(resetExponent([1]))}` +
          ` 层0点=${format(getLayer([0])?.points ?? 0)}`,
      )
    }
    void Decimal
  },
})
