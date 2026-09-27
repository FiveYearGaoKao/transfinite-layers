//元维度提升(Meta-Dimension Boost)的对撞验证脚本
//断言原则:期望值必须来自"与实现不同的路径"(独立裁判/真实路径的可观察后果/往返对撞/响应式/开发自检),
//         不把实现里的公式再抄一遍——所以调整数值(需求倍率、加成大小、维度上限)不需要改本文件
//1. 性质:维度数范围与单调性、需求单调递增、指数加成的单调性与饱和边界
//2. "所有层级已购买的维度总数"与逐层逐维度暴力求和相等(独立裁判)
//3. 门槛与真实路径:不持有iu25不可提升;提升后强制无限重置(不获得IP)/维度数到位/指数增量正确
//4. 层级重置不会把元维度提升解锁的维度截回去
//5. 提升次数>0时新效果真的生效:折叠=逐条求值、可逆数值点求逆往返
//6. 多次提升的累积与边界 + 存档往返(提升次数与超过4个维度的层级原样保留)
//7. 响应式:把"已购维度总数"包进Vue的computed读取时,购买维度必须能驱动它更新
//8. 开发构建的static自检不得报警(标错static/漏清缓存会当场暴露)
//用法:node scripts/run-ts.mjs scripts/checkMetaDimension.ts
import Decimal from 'break_eternity.js'
import { computed, nextTick, watchEffect } from 'vue'
import { player } from '@/data/player'
import { addAmount, getLayer, getOrderedLayers } from '@/access'
import { DIMENSION_COUNT } from '@/data/constants'
import { dimensionExponent } from '@/compute/dimensions'
import { applyTo, effectTrace, invertAt, runStaticSelfCheck } from '@/compute/effects'
import { clearFrameCache } from '@/compute/frameCache'
import {
  canMetaDimensionBoost,
  dimensionCount,
  metaDimensionBoostCount,
  metaDimensionExponentBonus,
  metaDimensionRequirement,
  nextDimensionCount,
  totalBoughtDimensions,
  META_DIMENSION_BASE_REQUIREMENT,
  META_DIMENSION_EXPONENT_PER_BOOST,
  META_DIMENSION_MAX_COUNT,
} from '@/compute/metaDimension'
import { doMetaDimensionBoost } from '@/logic/metaDimension'
import { buyDimension } from '@/logic/purchase'
import { resetData } from '@/logic/reset'
import { updateLayers } from '@/logic/update'
import { exportSaveString, importSaveString } from '@/save/save'
import { findInvalidValues } from '@/save/validate'
import { captureErrors, check, ensureLayer0Order, freshSave, relErr, reportChecks } from './helpers'

const takeErrors = captureErrors()

console.log('== 1. 不随公式变化的性质 ==')
{
  //小次数覆盖"还在解锁维度"的区间,大次数覆盖"取到上限/极大值"的区间
  const ns = [0, 1, 2, 4, 5, 8, 100]
  const dims: number[] = []
  const nextDims: number[] = []
  const reqs: Decimal[] = []
  const bonuses: Decimal[][] = []
  for (const n of ns) {
    player.metaDimensionBoosts = new Decimal(n)
    dims.push(dimensionCount())
    nextDims.push(nextDimensionCount())
    reqs.push(metaDimensionRequirement())
    //多取两个id:覆盖"已超出加成范围"的一侧
    bonuses.push(
      Array.from({ length: META_DIMENSION_MAX_COUNT + 2 }, (_, id) => metaDimensionExponentBonus(id)),
    )
  }
  check(
    '每层维度数恒在设计范围内',
    dims.every((d) => Number.isInteger(d) && d >= DIMENSION_COUNT && d <= META_DIMENSION_MAX_COUNT),
    dims.join(','),
  )
  check('每层维度数随提升次数不减', dims.every((d, i) => i == 0 || d >= dims[i - 1]!), dims.join(','))
  check('下次维度数不少于当前维度数', nextDims.every((d, i) => d >= dims[i]!), nextDims.join(','))
  check(
    '需求为正、有限且随次数严格递增',
    reqs.every((r, i) => r.gt(0) && r.isFinite() && (i == 0 || r.gt(reqs[i - 1]!))),
    `${reqs[0]} … ${reqs[reqs.length - 1]}`,
  )
  check(
    '指数加成随维度编号不减且非负',
    bonuses.every((row) => row.every((b, i) => b.gte(0) && (i == 0 || b.lte(row[i - 1]!)))),
  )
  check(
    '超出覆盖范围的维度加成为0(只覆盖维度1~min(次数,上限))',
    ns.every((n, i) => bonuses[i]!.every((b, id) => id < n || b.eq(0))),
  )
}

console.log('== 2. 需求口径:所有层级已购买的维度总数 ==')
freshSave()
player.metaDimensionBoosts = new Decimal(0)
clearFrameCache()
ensureLayer0Order(2)
let expectTotal = new Decimal(0)
for (const e of getOrderedLayers('asc')) {
  for (let i = 0; i < e.L.dimensions.length; i++) {
    //每个维度都塞入至少一次"首次需求",总数必然远超需求
    const add = new Decimal(i + 1).mul(META_DIMENSION_BASE_REQUIREMENT)
    addAmount(e.L, i, add, 1)
    expectTotal = expectTotal.add(add)
  }
}
clearFrameCache()
check(
  '已购维度总数=逐层逐维度求和',
  totalBoughtDimensions().eq(expectTotal),
  `${totalBoughtDimensions()} vs ${expectTotal}`,
)
check('未购买iu25时不可提升(即使已达标)', !canMetaDimensionBoost())

console.log('== 3. 门槛与真实路径:持有iu25 + 达标 → 提升一次 ==')
player.infinityUpgrades = ['iu25']
clearFrameCache()
check('持有iu25且达标 → 可提升', canMetaDimensionBoost())
const dimsBefore = dimensionCount()
const exp1Before = dimensionExponent([0], 0)
const exp2Before = dimensionExponent([0], 1)
doMetaDimensionBoost()
check('提升次数+1', player.metaDimensionBoosts.eq(1), `${player.metaDimensionBoosts}`)
check('强制无限重置不获得无限点数', player.infinityPoints.eq(0), `${player.infinityPoints}`)
const afterLayers = getOrderedLayers('asc')
check(
  '强制无限重置:只剩层级0',
  afterLayers.length == 1 && afterLayers[0]!.key == '0',
  afterLayers.map((e) => e.key).join(','),
)
check(
  '层级0维度数=dimensionCount()',
  getLayer([0])!.dimensions.length == dimensionCount(),
  `${getLayer([0])!.dimensions.length} vs ${dimensionCount()}`,
)
check('本次解锁了新维度(维度数增加)', dimensionCount() > dimsBefore, `${dimsBefore} → ${dimensionCount()}`)
clearFrameCache()
check(
  '维度1的指数增加一次加成',
  relErr(dimensionExponent([0], 0), exp1Before.add(META_DIMENSION_EXPONENT_PER_BOOST)) < 1e-12,
  `${exp1Before} → ${dimensionExponent([0], 0)}`,
)
check(
  '维度2的指数不变(本次只覆盖维度1)',
  relErr(dimensionExponent([0], 1), exp2Before) < 1e-12,
  `${exp2Before} → ${dimensionExponent([0], 1)}`,
)

console.log('== 4. 层级重置不会截断元维度提升解锁的维度 ==')
resetData([0])
check(
  '层级重置后维度数仍为dimensionCount()',
  getLayer([0])!.dimensions.length == dimensionCount(),
  `${getLayer([0])!.dimensions.length} vs ${dimensionCount()}`,
)

console.log('== 5. 效果生效时的折叠/求逆 ==')
{
  const ctx = { pos: [0], id: 0 }
  const base = new Decimal('1e12')
  const folded = applyTo('dimensionExponent', base, ctx)
  const trace = effectTrace('dimensionExponent', base, ctx)
  check('折叠=逐条求值', relErr(folded, trace.total) < 1e-9, `${folded} vs ${trace.total}`)
  const back = invertAt('dimensionExponent', folded, ctx)
  check(
    '求逆往返',
    back != undefined && relErr(back, base) < 1e-6,
    back == undefined ? 'undefined' : `回解${back}`,
  )
}

console.log('== 6. 多次提升的累积与边界 + 存档往返 ==')
clearFrameCache()
const exp1At1 = dimensionExponent([0], 0)
const exp4Before = dimensionExponent([0], 3)
for (let k = 0; k < 2; k++) {
  //每个维度都塞入一份当前需求,保证下一次提升必然达标(不依赖具体公式)
  const add = metaDimensionRequirement()
  for (const e of getOrderedLayers('asc')) {
    for (let i = 0; i < e.L.dimensions.length; i++) addAmount(e.L, i, add, 1)
  }
  clearFrameCache()
  check(`第${metaDimensionBoostCount().toNumber() + 1}次可提升`, canMetaDimensionBoost())
  doMetaDimensionBoost()
}
check('次数=3', player.metaDimensionBoosts.eq(3), `${player.metaDimensionBoosts}`)
clearFrameCache()
check(
  '维度1的指数按次数累积',
  relErr(
    dimensionExponent([0], 0),
    exp1At1.add(new Decimal(META_DIMENSION_EXPONENT_PER_BOOST).mul(2)),
  ) < 1e-12,
  `${exp1At1} → ${dimensionExponent([0], 0)}`,
)
check(
  '维度4的指数仍无变化(超出本次加成范围)',
  relErr(dimensionExponent([0], 3), exp4Before) < 1e-12,
  `${exp4Before} → ${dimensionExponent([0], 3)}`,
)
check(
  '层级0维度数=dimensionCount()',
  getLayer([0])!.dimensions.length == dimensionCount(),
  `${getLayer([0])!.dimensions.length} vs ${dimensionCount()}`,
)
const text = exportSaveString()
check('导入成功', importSaveString(text))
check('提升次数往返', player.metaDimensionBoosts.eq(3), `${player.metaDimensionBoosts}`)
check(
  '超过4个维度的层级往返',
  getLayer([0])!.dimensions.length == dimensionCount(),
  `${getLayer([0])!.dimensions.length} vs ${dimensionCount()}`,
)
check('存档无非法值', findInvalidValues(player).length == 0, findInvalidValues(player).join(' | '))

console.log('== 7. 响应式:读取已购总数的computed必须随购买更新 ==')
{
  //回归护栏:本函数一度被包进帧内缓存,而缓存命中路径不读player.layers,
  //Vue重算时收集不到依赖,computed一次命中后就永久冻结(症状:元声望的"已购维度总数"不随购买变化、
  //提升按钮不会因达标而解禁)。这里用computed+watchEffect复现组件读取方式
  const bought = computed(() => totalBoughtDimensions())
  let seen = ''
  const stop = watchEffect(() => {
    seen = bought.value.toString()
  })
  await nextTick()
  const before = seen
  check(
    '挂载时computed与直接求和一致',
    before == totalBoughtDimensions().toString(),
    `${before} vs ${totalBoughtDimensions()}`,
  )
  //买一次维度(真实购买入口)
  player.layers['0']!.points = new Decimal('1e30')
  buyDimension([0], 0)
  await nextTick()
  const afterBuy = totalBoughtDimensions().toString()
  check('购买维度后computed更新', seen == afterBuy && afterBuy != before, `${before} → ${seen}`)
  //同代次内再改一次(旧实现从第一次缓存命中起就永久冻结,这条能抓住)
  addAmount(player.layers['0'], 0, new Decimal('7'), 1)
  await nextTick()
  const afterAdd = totalBoughtDimensions().toString()
  check('再次变更后仍更新', seen == afterAdd && afterAdd != afterBuy, `${afterBuy} → ${seen}`)
  stop()
}

console.log('== 8. 一帧生产后:开发构建static自检 ==')
clearFrameCache()
updateLayers(new Decimal(1 / 20))
runStaticSelfCheck('脚本(生产阶段后)')
runStaticSelfCheck('脚本(帧末)')
const devErrors = takeErrors()
check('开发构建无自检告警', devErrors.length == 0, devErrors.slice(0, 3).join(' | '))

process.exit(reportChecks() ? 0 : 1)
