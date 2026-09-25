//加成管道验证脚本:
//1. 效果计划(合并static后的折叠步骤)与逐条求值必须一致——A1"模板并入计划"的核心不变量
//2. 可逆数值点:applyTo → invertAt 必须回到基准值(软上限的往返有约1e-12相对误差)
//3. 统计树必须由数值点声明自动派生(层级页/全局页都要有节点)
//4. 跑一帧后开发构建的static自检不得报警(标错static或漏清缓存会当场暴露)
//若仓库根目录存在真实存档,会先载入它以覆盖更多生效分支
//用法:node scripts/run-ts.mjs scripts/checkEffects.ts
import Decimal from 'break_eternity.js'
import { getOrderedLayers } from '@/access'
import { player } from '@/data/player'
import {
  DEFAULT_CONTEXT,
  applyTo,
  effectTrace,
  invertAt,
  runStaticSelfCheck,
  type EffectContext,
} from '@/compute/effects'
import { clearFrameCache } from '@/compute/frameCache'
import { applyChallengePenalties, updateLayers } from '@/logic/update'
import { buildGlobalNodes, buildLayerNodes } from '@/compute/statistics'
import { captureErrors, check, loadRealSave, relErr, reportChecks } from './helpers'

const takeErrors = captureErrors()

loadRealSave()
const layerCount = getOrderedLayers('asc').length
console.log(`  层级数 ${layerCount},成就 ${player.achievements.length},无限升级 ${player.infinityUpgrades.length}`)

/**待验证的数值点(覆盖调用型与声明型) */
const targets = [
  'dimensionMult',
  'dimensionExponent',
  'production',
  'dimensionCost',
  'buyableCost',
  'pointsGain',
  'psdSpeed',
  'knowledgeGain',
  'infinityGain',
  'b11:base',
  'b11:amount',
  'b12:base',
  'b12:amount',
  'b12:quad',
  'b13:base',
  'b13:amount',
  'b13:costMult',
  'energy:base',
  'priceCap:base',
  'priceCap:power',
  'dimCap:base',
  'dimCap:power',
  'u1:base',
  'iu33:base',
  'a41:decay',
  'challengeGoalIndex',
  'crossLayer:reward',
  'crossLayer:penalty',
]

/**上下文网格:全部层级 × 若干物品id */
const ctxs: EffectContext[] = [DEFAULT_CONTEXT]
for (const e of getOrderedLayers('asc')) {
  for (const id of [0, 1, 3, 11, 12, 13]) ctxs.push({ pos: e.pos, id })
}

/**可逆数值点(管道里没有custom):applyTo → invertAt 应回到基准值 */
const invertible = ['dimensionMult', 'dimensionExponent', 'production', 'dimensionCost', 'buyableCost']

console.log('== 1. 折叠步骤 vs 逐条求值,以及可逆数值点的往返 ==')
let pairs = 0
let worstFold = 0
for (const target of targets) {
  for (const ctx of ctxs) {
    for (const base of [new Decimal(1), new Decimal('1e12'), new Decimal('1e300')]) {
      pairs++
      const folded = applyTo(target, base, ctx)
      const trace = effectTrace(target, base, ctx)
      const label = `${target} 层${ctx.pos.toString()} id${ctx.id} 基准${base.toExponential(0)}`
      //折叠只是"先合成段内数值再加一次":与逐条求值数学等价,但浮点结合顺序不同,
      //末位(约1e-16相对)会有差异;差到这个量级以上说明折叠漏了效果
      const foldErr = relErr(folded, trace.total)
      if (foldErr > worstFold) worstFold = foldErr
      check(`${label} 折叠=逐条`, foldErr < 1e-9, `${folded} vs ${trace.total}`)
      if (!invertible.includes(target)) continue
      const back = invertAt(target, folded, ctx)
      check(
        `${label} 求逆往返`,
        back != undefined && relErr(back, base) < 1e-6,
        back == undefined ? 'undefined' : `回解${back}`,
      )
    }
  }
}
console.log(`  对撞 ${pairs} 组(数值点×上下文×基准值),折叠最大相对差 ${worstFold.toExponential(2)}`)

console.log('== 2. 统计树由数值点声明派生 ==')
const layerNodes = buildLayerNodes(getOrderedLayers('asc')[0]!.pos)
const globalNodes = buildGlobalNodes()
console.log(`  层级页节点 ${layerNodes.length} 个,全局页节点 ${globalNodes.length} 个`)
check('层级页有节点', layerNodes.length > 0)
check('全局页有节点', globalNodes.length > 0)
check('节点带效果明细', layerNodes.some((n) => n.children.length > 0))
check(
  '产出节点含公式输入',
  (layerNodes.find((n) => n.label == '维度1产量')?.children.length ?? 0) >= 2,
)

console.log('== 3. 一帧生产后:开发构建static自检 ==')
clearFrameCache()
updateLayers(new Decimal(1 / 20))
applyChallengePenalties(new Decimal(1 / 20))
runStaticSelfCheck('脚本(生产阶段后)')
runStaticSelfCheck('脚本(帧末)')

const devErrors = takeErrors()
check('开发构建无自检告警', devErrors.length == 0, devErrors.slice(0, 3).join(' | '))
process.exit(reportChecks() ? 0 : 1)
