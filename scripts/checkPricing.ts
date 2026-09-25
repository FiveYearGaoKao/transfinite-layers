//价格机制验证脚本(对撞式,无测试框架):
//1. 曲线四件套:sum 与逐项暴力相加对撞(误差口径<1%;常量/线性/几何必须精确)
//2. 无解析和的族:几何闭式回退与暴力对撞
//3. maxBuyable 与独立裁判对撞(解可行且解+1不可行),并验证"带锚点与不带锚点结果一致"
//4. 真实价格路径(维度/可购买的软上限支)对撞;若存在真实存档,再逐层级跑一遍自动化口径
//5. 知识升级价格与player.base无关,且与原硬编码公式逐个对得上
//6. 回归:线性价格"买最大"必须花光预算(旧几何近似会少买约20%)
//用法:node scripts/run-ts.mjs scripts/checkPricing.ts
import { readdirSync, readFileSync } from 'node:fs'
import Decimal from 'break_eternity.js'
import {
  constantCurve,
  expLinear,
  geometric,
  linear,
  power,
  powerDoubleExp,
  powerQuadratic,
  type Curve,
} from '@/compute/curves'
import { maxBuyable, sumCost, type BuyableItem } from '@/compute/buying'
import { getKnowledgeUpgrade, KNOWLEDGE_UPGRADES, knowledgeCost } from '@/compute/knowledge'
import { dimensionItem } from '@/compute/dimensions'
import { buyableItem, getBuyables } from '@/compute/buyables'
import { clearFrameCache } from '@/compute/frameCache'
import { maxSatisfying } from '@/tools/bisect'
import { getOrderedLayers, getPoints } from '@/access'
import { getLayerOrder } from '@/tools/ordinal'
import { player } from '@/data/player'
import { importSaveString } from '@/save/save'
import { buyKnowledgeUpgrade } from '@/logic/knowledge'
import { captureErrors, check, relErr, reportChecks, sameCount } from './helpers'

//开发构建的自检(曲线正逆/和往返等)走console.error,这里把它们变成断言
const takeErrors = captureErrors()

/**把曲线的前k项逐项相加(暴力裁判) */
function bruteSum(curve: Curve, n0: Decimal, k: number): Decimal {
  let sum = new Decimal(0)
  for (let i = 0; i < k; i++) sum = sum.add(curve.at(n0.add(i)))
  return sum
}

/**
 * 预算内最多能买几个(独立裁判:倍增找上界 + 整数二分,不依赖compute/buying与tools/bisect的实现)
 * 倍增上限给到2^200,故不会像LOOP_CAP=64的搜索那样在大数量级被截断
 */
function refereeCount(cost: (k: Decimal) => Decimal, budget: Decimal): Decimal {
  let lo = new Decimal(0)
  let hi = new Decimal(1)
  for (let i = 0; i < 200 && cost(hi).lte(budget); i++) {
    lo = hi
    const next = hi.mul(2)
    if (next.eq(hi)) return lo
    hi = next
  }
  for (let i = 0; i < 200 && hi.sub(lo).gt(1); i++) {
    const mid = lo.add(hi).div(2).floor()
    if (mid.lte(lo) || mid.gte(hi)) break
    if (cost(mid).lte(budget)) lo = mid
    else hi = mid
  }
  return lo
}

/**把曲线包成可购买项(已购owned个) */
function curveItem(curve: Curve, owned: number): BuyableItem {
  const n0 = new Decimal(owned)
  const item: BuyableItem = { amount: () => n0, cost: (n) => curve.at(n) }
  if (curve.sum) item.sum = (k) => curve.sum!(n0, k)
  if (curve.sumInverse) item.sumInverse = (budget) => curve.sumInverse!(n0, budget)
  return item
}

console.log('== 1. 曲线求和:解析和 vs 逐项暴力相加 ==')
interface FamilyCase {
  name: string
  curve: Curve
  /**true=族的和必须精确(误差<1e-9) */
  exact: boolean
}
const families: FamilyCase[] = [
  { name: 'constant(7)', curve: constantCurve(7), exact: true },
  { name: 'linear(5,5)', curve: linear({ a: 5, b: 5 }), exact: true },
  { name: 'linear(20,10)', curve: linear({ a: 20, b: 10 }), exact: true },
  { name: 'linear(1e6,3)', curve: linear({ a: 1e6, b: 3 }), exact: true },
  { name: 'linear(0.5,0.001)', curve: linear({ a: 0.5, b: 0.001 }), exact: true },
  { name: 'geometric(50,2)', curve: geometric({ c: 50, r: 2 }), exact: true },
  { name: 'geometric(10,10)', curve: geometric({ c: 10, r: 10 }), exact: true },
  { name: 'geometric(0.3,1.7)', curve: geometric({ c: 0.3, r: 1.7 }), exact: true },
  { name: 'power(1,1,2)', curve: power({ c: 1, a: 1, p: 2 }), exact: false },
  { name: 'power(3,0.01,1.5)', curve: power({ c: 3, a: 0.01, p: 1.5 }), exact: false },
  { name: 'power(0.7,5,3)', curve: power({ c: 0.7, a: 5, p: 3 }), exact: false },
  { name: 'power(1,1,0.5)', curve: power({ c: 1, a: 1, p: 0.5 }), exact: false },
  { name: 'power(1,1,1)', curve: power({ c: 1, a: 1, p: 1 }), exact: false },
]
let worstErr = 0
let worstCase = ''
for (const f of families) {
  for (const n0 of [0, 3, 50]) {
    for (const k of [2, 3, 5, 8, 9, 13, 40, 100, 199]) {
      const parsed = f.curve.sum!(new Decimal(n0), new Decimal(k))
      if (parsed == undefined) {
        check(`${f.name} n0=${n0} k=${k} 有解析和`, false)
        continue
      }
      const truth = bruteSum(f.curve, new Decimal(n0), k)
      const err = relErr(parsed, truth)
      if (err > worstErr) {
        worstErr = err
        worstCase = `${f.name} n0=${n0} k=${k}`
      }
      check(
        `${f.name} n0=${n0} k=${k} 误差<1%`,
        err < 0.01,
        `实际${(err * 100).toFixed(4)}%`,
      )
      if (f.exact) {
        check(`${f.name} n0=${n0} k=${k} 精确`, err < 1e-9, `实际${err}`)
      }
    }
    //和→和逆往返(和逆向下取整且带浮点误差,允许±1;幂族是积分近似,容差放宽到10%)
    for (const k of [3, 20, 500]) {
      const parsed = f.curve.sum!(new Decimal(n0), new Decimal(k))
      const back = f.curve.sumInverse!(new Decimal(n0), parsed)
      const tol = f.exact ? 1e-9 : 0.1
      check(
        `${f.name} n0=${n0} k=${k} 和逆往返`,
        back != undefined && (back.sub(k).abs().lte(1) || relErr(back, new Decimal(k)) < tol),
        back == undefined ? 'undefined' : `回解${back}`,
      )
    }
  }
}
console.log(
  `  最差相对误差 ${(worstErr * 100).toFixed(4)}% (${worstCase})`,
)

console.log('== 2. 无解析和的族:几何闭式回退 vs 暴力 ==')
const fallbackCurves: [string, Curve][] = [
  ['expLinear(1,0.5) base10', expLinear({ a: 1, b: 0.5 })],
  ['expLinear(0,1) base10', expLinear({ a: 0, b: 1 })],
  ['expLinear(3,4) base10', expLinear({ a: 3, b: 4 })],
  ['powerQuadratic(0.1,2) base10', powerQuadratic({ q: 0.1, c: 2 })],
  ['powerQuadratic(0.1,0) base10', powerQuadratic({ q: 0.1, c: 0 })],
  ['powerDoubleExp(4) base10', powerDoubleExp({ m: 4 })],
]
for (const [name, curve] of fallbackCurves) {
  check(`${name} 未声明解析和(应走几何闭式)`, curve.sum == undefined)
  for (const n0 of [0, 7]) {
    for (const k of [2, 5, 20, 100]) {
      const item: BuyableItem = { amount: () => new Decimal(n0), cost: (n) => curve.at(n) }
      const err = relErr(sumCost(item, new Decimal(k)), bruteSum(curve, new Decimal(n0), k))
      check(`${name} n0=${n0} k=${k} 回退误差<1%`, err < 0.01, `实际${(err * 100).toFixed(3)}%`)
    }
  }
}

console.log('== 3. maxBuyable:解析求解 vs 独立裁判 ==')
const budgets = ['0', '1', '6', '50', '51', '100', '1234', '1e5', '1e12', '1e40']
for (const f of families.filter((x) => !x.name.startsWith('power(1,1,1)'))) {
  for (const owned of [0, 7, 33]) {
    for (const budget of budgets) {
      const b = new Decimal(budget)
      const item = curveItem(f.curve, owned)
      const got = maxBuyable(item, b)
      const truth = refereeCount((k) => sumCost(item, k), b)
      const label = `${f.name} owned=${owned} 预算=${budget}`
      check(`${label} 解析解=裁判`, sameCount(got, truth), `解${got} 裁判${truth}`)
      check(`${label} 解可行`, sumCost(item, got).lte(b), `花费${sumCost(item, got)}`)
      //数量级大到Decimal分辨不出+1时,"解+1不可行"无从校验
      if (!got.add(1).eq(got)) {
        check(
          `${label} 解+1不可行`,
          sumCost(item, got.add(1)).gt(b),
          `花费${sumCost(item, got.add(1))}`,
        )
      }
      if (f.exact && got.lte(2000)) {
        //精确族再对撞"真实价格和的独立裁判"
        const trueTruth = refereeCount((k) => bruteSum(f.curve, new Decimal(owned), k.toNumber()), b)
        check(`${label} 精确族=真实价格`, got.eq(trueTruth), `解${got} 真实${trueTruth}`)
      }
    }
  }
}

console.log('== 4. 真实价格路径(维度/可购买的软上限支) ==')
const freshLayer = [0]
player.layers['0']!.points = new Decimal(1)
player.layers['0']!.buyables = { 11: new Decimal(0), 12: new Decimal(0), 13: new Decimal(0) }
clearFrameCache()
for (const budget of ['1e5', '1e150', '1e1000', '1e100000']) {
  const b = new Decimal(budget)
  for (const id of [0, 3]) {
    const item = dimensionItem(freshLayer, id)
    const got = maxBuyable(item, b)
    const truth = refereeCount((k) => sumCost(item, k), b)
    const label = `维度${id + 1} 预算=${budget}`
    check(`${label} 解析解=裁判`, sameCount(got, truth), `解${got} 裁判${truth}`)
    check(`${label} 解可行`, sumCost(item, got).lte(b))
    if (!got.add(1).eq(got)) check(`${label} 解+1不可行`, sumCost(item, got.add(1)).gt(b))
    //估算偏大/偏小/不可行三种形态:带锚点必须与完全不带估算时一致
    if (got.lt('1e15')) {
      const noAnchor = maxSatisfying((k) => sumCost(item, k), b, new Decimal(0), undefined)
      check(`${label} 锚点不影响结果`, got.eq(noAnchor), `带锚${got} 无锚${noAnchor}`)
    }
  }
  for (const id of [11, 12, 13]) {
    const item = buyableItem(freshLayer, id)
    const got = maxBuyable(item, b)
    const truth = refereeCount((k) => sumCost(item, k), b)
    const label = `可购买${id} 预算=${budget}`
    check(`${label} 解析解=裁判`, sameCount(got, truth), `解${got} 裁判${truth}`)
    check(`${label} 解可行`, sumCost(item, got).lte(b))
    if (!got.add(1).eq(got)) check(`${label} 解+1不可行`, sumCost(item, got.add(1)).gt(b))
  }
}

console.log('== 4b. 真实存档下逐层级的买最大(自动化口径) ==')
const saveFile = readdirSync('.').find(
  (f) => f.startsWith('TransfiniteLayers-') && f.endsWith('.txt'),
)
if (!saveFile) {
  console.log('  未找到真实存档,跳过')
} else if (!importSaveString(readFileSync(saveFile, 'utf8').trim())) {
  console.log('  真实存档载入失败,跳过')
} else {
  clearFrameCache()
  let cases = 0
  for (const entry of getOrderedLayers('asc')) {
    const pos = entry.pos
    const points = getPoints(pos)
    if (!points.gt(0)) continue
    const dims = player.layers[pos.toString()]?.dimensions.length ?? 0
    const items: BuyableItem[] = []
    for (let id = 0; id < dims; id++) items.push(dimensionItem(pos, id))
    for (const b of getBuyables(getLayerOrder(pos))) items.push(buyableItem(pos, b.id))
    for (const item of items) {
      //三种预算:全部点数、软上限拐点附近的极小预算(可行窗口最窄)、正好只买得起1个
      const budgets = [points, points.mul('1e-10'), item.cost(item.amount())]
      for (const b of budgets) {
        if (!b.gt(0)) continue
        cases++
        const got = maxBuyable(item, b)
        const truth = refereeCount((k) => sumCost(item, k), b)
        const label = `层${pos.toString()} 物品${item.amount().toString()} 预算${b.toExponential(2)}`
        check(`${label} 解析解=裁判`, sameCount(got, truth), `解${got} 裁判${truth}`)
        check(`${label} 解可行`, sumCost(item, got).lte(b))
        if (!got.add(1).eq(got)) check(`${label} 解+1不可行`, sumCost(item, got.add(1)).gt(b))
      }
    }
  }
  console.log(`  ${saveFile}:${getOrderedLayers('asc').length} 层级 × 每种物品 × 3 种预算,共 ${cases} 组`)
}

console.log('== 5. 知识升级:价格与player.base无关,且与原公式一致 ==')
const priceOf = (id: string, n: number): string =>
  getKnowledgeUpgrade(id)!.cost.at(new Decimal(n)).toString()
const withBase = (base: number) => {
  player.base = base
  clearFrameCache()
  return KNOWLEDGE_UPGRADES.map((k) => `${k.id}=${priceOf(k.id, 3)}`).join('|')
}
const atBase2 = withBase(2)
const atBase10 = withBase(10)
check('知识价格与player.base无关', atBase2 == atBase10, `${atBase2} vs ${atBase10}`)
//与原硬编码公式逐个对撞(改造时不能顺手改数值)
const expected: [string, (n: number) => Decimal][] = [
  ['time-offline', () => new Decimal(5)],
  ['time-store', () => new Decimal(10)],
  ['time-boost', () => new Decimal(10)],
  ['time-pause', () => new Decimal(5)],
  ['time-tick', () => new Decimal(20)],
  ['time-overclock', (n) => new Decimal(10).pow(n + 1)],
  ['bonus-achievement', () => new Decimal(10)],
  ['boost-production', (n) => new Decimal(5).add(new Decimal(5).mul(n)).floor()],
  ['depth-points', () => new Decimal(100)],
  ['command-checkin', () => new Decimal(20)],
  ['command-quiz', () => new Decimal(20)],
  ['quiz-accel', (n) => new Decimal(20).add(new Decimal(10).mul(n)).floor()],
  ['quiz-difficulty', (n) => new Decimal(50).mul(new Decimal(2).pow(n)).floor()],
  ['auto-batch', (n) => new Decimal(10).mul(n + 1).floor()],
  ['max-buy', () => new Decimal(50)],
  ['auto-upgrade', () => new Decimal(50)],
  ['knowledge-achievement', () => new Decimal(64)],
  ['auto-global-config', () => new Decimal(100)],
]
for (const [id, formula] of expected) {
  for (const n of [0, 1, 3, 9, 14]) {
    check(
      `${id} n=${n} 价格未变`,
      priceOf(id, n) == formula(n).toString(),
      `现在${priceOf(id, n)} 原${formula(n)}`,
    )
  }
}

console.log('== 6. 回归:线性价格"买最大"必须花光预算 ==')
player.base = 10
player.knowledge = new Decimal(5000)
player.knowledgeUpgrades = {}
clearFrameCache()
const before = player.knowledge
const spent = buyKnowledgeUpgrade('boost-production', 100)
const owned = player.knowledgeUpgrades['boost-production']!
const nextPrice = knowledgeCost('boost-production')
console.log(
  `  预算${before} → 购买${owned}级,花费${spent},剩余${player.knowledge}(下一级价${nextPrice})`,
)
check('买最大花光预算(剩余不足下一级)', player.knowledge.lt(nextPrice))
check('确实买到了多级', owned.gte(20), `只买到${owned}级`)
//旧口径(末两项几何近似)的对照:同样预算下能买几级
const linearCurve = getKnowledgeUpgrade('boost-production')!.cost
const oldSum = (k: number): Decimal => {
  const n0 = new Decimal(0)
  if (k <= 1) return linearCurve.at(n0)
  const last = linearCurve.at(n0.add(k - 1))
  const prev = linearCurve.at(n0.add(k - 2))
  const ratio = last.div(prev)
  return last.mul(ratio.div(ratio.sub(1))).mul(new Decimal(1).sub(ratio.pow(-k)))
}
const oldCount = refereeCount((k) => oldSum(k.toNumber()), before)
console.log(`  对照:旧几何近似同预算只能买${oldCount}级(少买${owned.sub(oldCount)}级)`)
check('新实现比旧近似买得更多', owned.gt(oldCount))

const devErrors = takeErrors()
check('开发构建无自检告警', devErrors.length == 0, devErrors.slice(0, 3).join(' | '))
process.exit(reportChecks() ? 0 : 1)
