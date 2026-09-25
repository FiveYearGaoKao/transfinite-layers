//成就触发机制验证脚本(对撞式,无测试框架):
//1. 分桶:每个成就恰好属于一种触发时机(每帧/层级重置/无限重置/手动),四类之和等于总数
//2. 行为:三类自动检查各自只解锁自己那一批(构造出让该类条件成立的状态,并检查幂等)
//3. 手动成就:每个都必须在源码里有 unlockAchievementById 触发点,否则永远无法解锁
//4. 约定:隐藏成就标记secret且奖励固定1知识;非手动成就必须带判定条件;id不得重复
//用法:node scripts/run-ts.mjs scripts/checkAchievements.ts
import { readdirSync, readFileSync } from 'node:fs'
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayer } from '@/access'
import { clearFrameCache } from '@/compute/frameCache'
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
ensureLayer0Order(1)
getLayer([0])!.resetTime = new Decimal(0)
const resetNew = newlyUnlocked(() =>
  checkResetAchievements({ layer: [1], gain: new Decimal('1e300') }),
)
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

process.exit(reportChecks() ? 0 : 1)
