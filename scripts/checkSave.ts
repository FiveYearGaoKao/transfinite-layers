//存档机制验证脚本(对撞式,无测试框架):
//1. 往返:导出→导入后关键字段与Decimal组件完全一致(层0的Decimal是按位精确路径,最容易丢ulp)
//2. 校验码:内容被改而校验码未重算时必须拒绝(错误码250)并解锁隐藏成就s15,且不替换当前存档
//3. 形状:多余字段不写进存档、旧档缺失字段按默认值补齐、非规范/非法层级键被清掉
//4. 守卫:带NaN的存档拒绝(102);来自未来的存档(301)、创建时间晚于最后游玩(302)、创建过早(303)都拒绝
//5. 迁移与结构:旧版本号存档可导入并升到当前版本;导入后层级不变量必须自洽
//用法:node scripts/run-ts.mjs scripts/checkSave.ts
import Decimal from 'break_eternity.js'
import { compressToBase64, decompressFromBase64 } from 'lz-string'
import { player } from '@/data/player'
import { getLayer, getOrderedLayers } from '@/access'
import { clearLogs, logs } from '@/data/log'
import { exportSaveString, importSaveString } from '@/save/save'
import { checkCode, CHECKSUM_SALT } from '@/save/checksum'
import { findInvalidValues } from '@/save/validate'
import { checkLayerInvariants } from '@/logic/layerStructure'
import { getLayerAutomation } from '@/logic/automations'
import { gameVersion, EARLIEST_SAVE_TIME } from '@/data/constants'
import { check, ensureLayer0Order, freshSave, loadRealSave, reportChecks } from './helpers'

/**最近一条日志的文本(读档失败原因写在日志里) */
function lastLog(): string {
  return logs[logs.length - 1]?.text ?? ''
}
/**日志里是否出现过该文本(读档失败后还可能解锁成就并追加日志,故不能只看最后一条) */
function logHas(text: string): boolean {
  return logs.some((l) => l.text.includes(text))
}
/**导入该存档并断言"被拒绝且日志里含该错误码" */
function expectReject(s: string, code: string): boolean {
  clearLogs()
  const ok = importSaveString(s)
  check(`拒绝导入(错误代码${code})`, !ok && logHas(`错误代码:${code}`), lastLog())
  return !ok
}
/**解码存档字符串(与save.ts的序列化基准一致:已是markDecimals+裁剪后的对象) */
function decodeSave(s: string): Record<string, unknown> {
  return JSON.parse(decompressFromBase64(s) || 'null') as Record<string, unknown>
}
/**重算校验码(改写解码出的对象后必须调用,否则会被当成"被改过的存档") */
function reseal(json: Record<string, unknown>) {
  json.checkCode = 0
  json.checkCode = checkCode(JSON.stringify(json), (json.firstPlay as number) ^ CHECKSUM_SALT)
}
/**重新编码为可直接导入的存档字符串 */
function encodeSave(json: unknown): string {
  return compressToBase64(JSON.stringify(json))
}
/**层级指纹:判定"失败的导入不替换当前存档"(读档失败本身会解锁s15并发放知识,故不含成就与知识) */
function layerFingerprint(): string {
  return getOrderedLayers('asc')
    .map((e) => `${e.key}:${e.L.points.toString()}`)
    .join(',')
}
/**状态指纹:往返前后的整体核对 */
function fingerprint(): string {
  return `${layerFingerprint()}|知识${player.knowledge}|base${player.base}`
}

console.log('== 1. 往返:导出→导入后关键字段与Decimal组件一致 ==')
loadRealSave()
ensureLayer0Order(1)
player.knowledge = new Decimal('123.456')
player.base = 7
player.infinityBestResetTime = Decimal.dInf
const beforeFp = fingerprint()
const beforeAchievements = player.achievements.length
const beforeDecimals = getOrderedLayers('asc').map((e) => ({
  key: e.key,
  points: e.L.points,
  energy: e.L.energy,
}))
const packed = exportSaveString()
freshSave()
check('导入前状态确实被清空', fingerprint() != beforeFp)
check('往返导入成功', importSaveString(packed))
check('往返后关键字段一致', fingerprint() == beforeFp, fingerprint())
check('往返后成就数一致', player.achievements.length == beforeAchievements)
for (const b of beforeDecimals) {
  const L = getLayer(b.key.split(',').map(Number))
  const same =
    L != undefined &&
    L.points.sign == b.points.sign &&
    L.points.mag == b.points.mag &&
    L.points.layer == b.points.layer &&
    L.energy.sign == b.energy.sign &&
    L.energy.mag == b.energy.mag
  check(`层级${b.key}的Decimal按位一致`, same, `${L?.points.toString()} vs ${b.points.toString()}`)
}
check('无穷大(无限重置最短时间)往返仍是无穷', player.infinityBestResetTime.eq(Decimal.dInf))
console.log(`  往返层级 ${getOrderedLayers('asc').length} 个,成就 ${player.achievements.length} 个`)
const invariantProblems = checkLayerInvariants()
check('导入后层级不变量自洽', invariantProblems.length == 0, invariantProblems.join(' | '))

console.log('== 2. 极端值与多层级Decimal的往返 ==')
const tricky: [string, Decimal][] = [
  ['0.1', new Decimal(0.1)],
  ['1e-7(|mag|<1)', new Decimal('1e-7')],
  ['-1e-7', new Decimal('-1e-7')],
  ['Number.MAX_VALUE', new Decimal(Number.MAX_VALUE)],
  ['1e-300', new Decimal('1e-300')],
  ['1e1e300(层2)', new Decimal('1e1e300')],
  ['10^^10(极高层)', Decimal.tetrate(10, 10)],
]
for (const [name, value] of tricky) {
  freshSave()
  ensureLayer0Order(1)
  getLayer([0])!.points = value
  getLayer([1])!.points = value
  const s = exportSaveString()
  freshSave()
  check(`极端值${name}导入成功`, importSaveString(s))
  for (const pos of [[0], [1]]) {
    const got = getLayer(pos)!.points
    const bitExact = got.sign == value.sign && got.mag == value.mag && got.layer == value.layer
    check(`极端值${name} 层${pos}按位一致`, bitExact, `${got.toString()} vs ${value.toString()}`)
  }
}

console.log('== 3. 校验码:改了内容但没重算校验码 ==')
freshSave()
ensureLayer0Order(1)
const good = exportSaveString()
const tampered = decodeSave(good)
tampered.knowledge = { $d: '999', $l: 0 }
const beforeLayers = layerFingerprint()
check('篡改后的存档被拒绝', expectReject(encodeSave(tampered), '250'))
check('被拒绝时当前存档的层级不变', layerFingerprint() == beforeLayers)
check('篡改存档会解锁隐藏成就s15', player.achievements.includes('s15'))

console.log('== 4. 形状:多余字段、缺失字段、层级键 ==')
freshSave()
ensureLayer0Order(1)
;(player as unknown as Record<string, unknown>).obsoleteField = 123
const withExtra = decodeSave(exportSaveString())
check('多余字段不写进存档', !('obsoleteField' in withExtra))
delete (player as unknown as Record<string, unknown>).obsoleteField

const missing = decodeSave(good)
delete missing.seenNews
reseal(missing)
freshSave()
check('缺失字段的旧档可导入', importSaveString(encodeSave(missing)))
check('缺失字段按默认值补齐(已看新闻为空)', JSON.stringify(player.seenNews) == '[]')

const badKeys = decodeSave(good)
const layer0 = badKeys.layers as Record<string, unknown>
layer0['0,0'] = layer0['0'] //非规范写法:归一化后与'0'重合,应被丢弃
layer0['-1'] = layer0['0'] //临时层坐标不得出现在存档里
layer0['x,y'] = layer0['0'] //非法坐标
reseal(badKeys)
const layerCount = getOrderedLayers('asc').length
check('含非法层级键的存档可导入', importSaveString(encodeSave(badKeys)))
check('非规范键不残留', !('0,0' in player.layers))
check('临时层键不残留', !('-1' in player.layers))
check('非法坐标键不残留', !('x,y' in player.layers))
check('合法层级数不变', getOrderedLayers('asc').length == layerCount)

console.log('== 5. 守卫:非法数值与时间 ==')
freshSave()
player.knowledge = new Decimal(NaN)
check('NaN存档被本地保存前置检查拦下', findInvalidValues(player).length > 0)
const nanSave = exportSaveString()
freshSave()
expectReject(nanSave, '102')

const future = decodeSave(good)
future.lastPlay = Date.now() + 86400000
reseal(future)
freshSave()
expectReject(encodeSave(future), '301')

const inverted = decodeSave(good)
inverted.firstPlay = Date.now()
inverted.lastPlay = Date.now() - 1000
reseal(inverted)
freshSave()
expectReject(encodeSave(inverted), '302')

const ancient = decodeSave(good)
ancient.firstPlay = EARLIEST_SAVE_TIME - 1
reseal(ancient)
freshSave()
expectReject(encodeSave(ancient), '303')

console.log('== 6. 迁移:旧版本号存档可导入并升到当前版本 ==')
const old = decodeSave(good)
old.version = 'v0.1.0'
reseal(old)
freshSave()
clearLogs()
check('旧版本存档导入成功', importSaveString(encodeSave(old)))
check('导入后版本号升为当前版本', player.version == gameVersion, player.version)
check('提示了存档版本过旧', lastLog().includes('过旧'), lastLog())

console.log('== 7. 自动化配置:全局模板缺字段时逐项补齐(不能把缺字段的模板拷给新层级) ==')
//旧档的全局模板(reset)里没有"幂次"这两个字段(机制是后加的)
const stale = decodeSave(good)
const staleGlobal = stale.autoGlobal as { cfgs: Record<string, unknown> } | undefined
if (!staleGlobal) (stale as Record<string, unknown>).autoGlobal = { cfgs: {} }
const staleCfgs = (stale.autoGlobal as { cfgs: Record<string, unknown> }).cfgs
//只留"倍率"相关的字段,模拟升级前写下的模板
staleCfgs['reset'] = { enabled: true, priority: 3, combine: 'all', useMult: true }
reseal(stale)
check('缺usePower的旧模板可导入', importSaveString(encodeSave(stale)))
check(
  '导入时补齐了模板的usePower',
  'usePower' in (player.autoGlobal.cfgs['reset'] as unknown as Record<string, unknown>),
)
//新层级从全局模板拷贝配置:必须带上后加的字段(这条不经过读档,验证的是读取模板时的兜底)
freshSave()
ensureLayer0Order(1)
player.knowledgeUpgrades['auto-global-config'] = new Decimal(1)
//模板里只有"倍率"相关的字段,没有"幂次"
player.autoGlobal.cfgs['reset'] = { combine: 'all', useMult: true, mult: new Decimal(5) } as never
const newLayerCfg = getLayerAutomation([1]).cfgs['reset'] as unknown as Record<string, unknown>
check('新层级从模板拷贝时带上usePower', 'usePower' in newLayerCfg)
check('新层级从模板拷贝时带上power', 'power' in newLayerCfg)
check('拷贝保留了模板里的玩家设置', newLayerCfg.combine == 'all' && newLayerCfg.useMult === true)
check(
  '读取模板时就地补齐(不依赖读档)',
  'usePower' in (player.autoGlobal.cfgs['reset'] as unknown as Record<string, unknown>),
)

process.exit(reportChecks() ? 0 : 1)
