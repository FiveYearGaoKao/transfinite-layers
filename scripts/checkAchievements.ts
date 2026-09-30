//成就触发机制验证脚本(对撞式,无测试框架):
//1. 分桶:每个成就恰好属于一种触发时机(每帧/层级重置/无限重置/手动),四类之和等于总数
//2. 行为:三类自动检查各自只解锁自己那一批(构造出让该类条件成立的状态,并检查幂等)
//3. 手动成就:每个都必须在源码里有 unlockAchievementById 触发点,否则永远无法解锁
//4. 约定:隐藏成就标记secret且奖励固定1知识;非手动成就必须带判定条件;id不得重复
//5. 条件型隐藏成就的判据:s23(新闻随机数阈值)、s18(单条配置全67/所有层级的所有自动化全67)
//用法:node scripts/run-ts.mjs scripts/checkAchievements.ts
import { readdirSync, readFileSync } from 'node:fs'
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { temp } from '@/data/temp'
import { getLayer, getOrderedLayers } from '@/access'
import { clearFrameCache } from '@/compute/frameCache'
import {
  defaultAutoReset,
  type AutoBuyConfig,
  type AutoConfig,
  type AutoResetConfig,
} from '@/data/types'
import {
  AUTO_RESET_ID,
  AUTOMATIONS,
  allLayersAllSixSeven,
  getLayerAutomation,
  isAllSixSeven,
} from '@/logic/automations'
import {
  checkInfinityResetAchievements,
  checkResetAchievements,
  getAchievements,
  getNormalAchievements,
  getSecretAchievements,
  updateAchievements,
} from '@/logic/achievements'
import { check, ensureLayer0Order, freshSave, reportChecks } from './helpers'

type Trigger = 'frame' | 'reset' | 'infinity' | 'manual'

/**按声明的触发时机收集id(未写trigger即为每帧) */
function idsByTrigger(trigger: Trigger): Set<string> {
  const out = new Set<string>()
  for (const d of getAchievements()) if ((d.trigger ?? 'frame') == trigger) out.add(d.id)
  return out
}
/**跑一次检查,返回这次新解锁的成就id(判定"某一批只解锁自己那批") */
function newlyUnlocked(run: () => void): Set<string> {
  const before = new Set(player.achievements)
  run()
  return new Set(player.achievements.filter((id) => !before.has(id)))
}
/**递归拼接源码文本(手动成就的触发点只在源码里出现一次) */
function readSources(dir: string): string {
  let out = ''
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${e.name}`
    if (e.isDirectory()) out += readSources(path)
    else if (/\.(ts|vue)$/.test(e.name)) out += readFileSync(path, 'utf8')
  }
  return out
}
/**把id集合拼成可读文本 */
function show(ids: Set<string>): string {
  return [...ids].sort().join(',') || '(空)'
}

const frameIds = idsByTrigger('frame')
const resetIds = idsByTrigger('reset')
const infinityIds = idsByTrigger('infinity')
const manualIds = idsByTrigger('manual')
const all = getAchievements()
console.log(
  `  每帧 ${frameIds.size} 个,层级重置 ${resetIds.size} 个,无限重置 ${infinityIds.size} 个,手动 ${manualIds.size} 个`,
)

console.log('== 1. 分桶与约定 ==')
const ids = all.map((d) => d.id)
check('成就id不重复', new Set(ids).size == ids.length)
check(
  '四类触发时机之和=成就总数',
  frameIds.size + resetIds.size + infinityIds.size + manualIds.size == ids.length,
)
check(
  '成就总数=普通+隐藏',
  getNormalAchievements().length + getSecretAchievements().length == ids.length,
)
check(
  '隐藏成就标记secret且奖励固定为1知识',
  getSecretAchievements().every((d) => d.secret === true && new Decimal(d.reward).eq(1)),
)
check(
  '成就奖励为正',
  all.every((d) => new Decimal(d.reward).gt(0)),
)
check(
  '非手动成就都带判定条件',
  all.filter((d) => d.trigger != 'manual').every((d) => 'isCompleted' in d),
)
check(
  '手动成就不带判定条件',
  all.filter((d) => d.trigger == 'manual').every((d) => !('isCompleted' in d)),
)

console.log('== 2. 每帧桶:只解锁每帧成就 ==')
freshSave()
getLayer([0])!.points = new Decimal('1e120') //让"拥有1e100点数"(a28)等条件成立
clearFrameCache()
const frameNew = newlyUnlocked(updateAchievements)
check(
  '每帧检查只解锁每帧成就',
  [...frameNew].every((id) => frameIds.has(id)),
  show(frameNew),
)
check('每帧检查确实解锁了成就(非空测试)', frameNew.size > 0, show(frameNew))
check('每帧检查解锁了a28(Googol)', frameNew.has('a28'), show(frameNew))
check('每帧检查幂等(已解锁的不再重复解锁)', newlyUnlocked(updateAchievements).size == 0)

console.log('== 3. 层级重置桶:只解锁层级重置成就 ==')
freshSave()
//层级重置成就按"绝对高度"认层,所以逐层构造:重置层级n解锁层级n,同时给"获得至少1个层级n点数"发收益
//(这些条件只在层级重置瞬间可能成立,不能靠事后造状态)
const resetNew = newlyUnlocked(() => {
  //覆盖重置桶成就引用到的所有高度(现为层级1~4、6、9):改成就条件时同步这份高度清单
  //(层级10 及以上在最高阶窗口满时会进位成 ω,不再作为0阶层级出现,故重置桶里没有它的成就)
  //(测试夹具直接建到槽位9:base=10的窗口正常只会轮转到高度9,这里只关心"绝对高度=引用"的判定)
  for (const n of [1, 2, 3, 4, 6, 9]) {
    //先让目标层存在(层级1由解锁层级1的重置产生,故这一轮要先建层级1再发这次重置事件)
    ensureLayer0Order(n)
    checkResetAchievements({ layer: [n], gain: new Decimal('1e300') })
  }
})
check(
  '层级重置检查只解锁层级重置成就',
  [...resetNew].every((id) => resetIds.has(id)),
  show(resetNew),
)
check('层级重置桶的成就全部可解锁', resetNew.size == resetIds.size, show(resetNew))
check(
  '层级重置检查幂等',
  newlyUnlocked(() => checkResetAchievements({ layer: [1], gain: new Decimal(0) })).size == 0,
)

console.log('== 4. 无限重置桶:只解锁无限重置成就 ==')
freshSave()
const infinityNew = newlyUnlocked(() =>
  checkInfinityResetAchievements({ gain: new Decimal('1e10') }),
)
check(
  '无限重置检查只解锁无限重置成就',
  [...infinityNew].every((id) => infinityIds.has(id)),
  show(infinityNew),
)
check('无限重置桶的成就全部可解锁', infinityNew.size == infinityIds.size, show(infinityNew))

console.log('== 5. 手动成就:源码里必须有触发点 ==')
const source = readSources('src')
for (const id of manualIds) {
  check(`手动成就${id}有触发点`, source.includes(`unlockAchievementById('${id}')`))
}
check(
  '手动成就不会由自动检查解锁',
  ![...frameNew, ...resetNew, ...infinityNew].some((id) => manualIds.has(id)),
)

console.log('== 6. 条件型隐藏成就的判据(s18/s23) ==')
/**把一个自动化配置的所有数值项设为67(s18的两条路线共用这个判据) */
function setAll67(cfg: AutoConfig) {
  cfg.priority = 67
  if ('combine' in cfg) {
    const c = cfg as AutoResetConfig
    c.time = 67
    c.point = new Decimal(67)
    c.mult = new Decimal(67)
    c.power = new Decimal(67)
  } else (cfg as AutoBuyConfig).percent = 67
}
//s23:阈值取自新闻文案(>9990),随机数由app/news写进temp
freshSave()
temp.lastNewsRoll = 9990
updateAchievements()
check('s23:不大于9990不解锁', !player.achievements.includes('s23'))
temp.lastNewsRoll = 9991
updateAchievements()
check('s23:大于9990解锁', player.achievements.includes('s23'))
temp.lastNewsRoll = 0
//s18:①一条配置的所有数值项为67;②所有层级的所有自动化类型都为67(全局配置路线)
freshSave()
const oneCfg = defaultAutoReset()
check('s18:默认配置不算全67', !isAllSixSeven(oneCfg))
setAll67(oneCfg)
check('s18:单条配置全67', isAllSixSeven(oneCfg))
freshSave()
ensureLayer0Order(2)
for (const e of getOrderedLayers('asc')) {
  const auto = getLayerAutomation(e.pos)
  for (const def of AUTOMATIONS) setAll67(auto.cfgs[def.id]!)
}
check('s18:所有层级的所有自动化都全67', allLayersAllSixSeven())
check(
  's18:任一类型的任一字段不是67就不算',
  (() => {
    getLayerAutomation([1])!.cfgs[AUTO_RESET_ID]!.priority = 1
    return !allLayersAllSixSeven()
  })(),
)
check('s18:解锁点存在(源码扫描见第5节)', source.includes(`unlockAchievementById('s18')`))

process.exit(reportChecks() ? 0 : 1)
