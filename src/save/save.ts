//关于存档读取、导入的一些函数
import Decimal from 'break_eternity.js'
import { ref } from 'vue'
import { compressToBase64, decompressFromBase64 } from 'lz-string'
import { player, type Player, initializeSave } from '@/data/player'
import { gameName, gameVersion, EARLIEST_SAVE_TIME, SAVE_SLOT_COUNT } from '@/data/constants'
import { getLayer, invalidateLayerOrder } from '@/access'
import { clearTempLayers } from '@/data/temp'
import { unlockAchievementById } from '@/logic/achievements'
import { seedRng } from './rng'
import { migrate } from './migration'
import { checkCode, CHECKSUM_VERSION, CHECKSUM_SALT } from './checksum'
import { versionComp } from '@/tools/utils'
import { layerKey, posArray } from '@/tools/ordinal'
import { addLog } from '@/data/log'

//------存档槽位------
const CURRENT_SLOT_KEY = gameName + '-slot'
/**当前存档槽位(ref使UI可响应展示) */
const currentSlot = ref(0)

/**恢复上次使用的存档槽位(启动时调用) */
export function loadSlotChoice() {
  const n = Number(localStorage.getItem(CURRENT_SLOT_KEY))
  if (Number.isInteger(n) && n >= 0 && n < SAVE_SLOT_COUNT) currentSlot.value = n
}
/**获取当前存档槽位 */
export function getCurrentSlot(): number {
  return currentSlot.value
}
/**设置当前存档槽位并持久化 */
export function setCurrentSlot(slot: number) {
  if (slot >= 0 && slot < SAVE_SLOT_COUNT) {
    currentSlot.value = slot
    localStorage.setItem(CURRENT_SLOT_KEY, String(slot))
  }
}

/**单个存档槽位的摘要信息 */
export interface SlotSummary {
  /**槽位序号 */
  slot: number
  /**该槽位是否有存档 */
  exists: boolean
  /**游戏时长(秒) */
  totalTime: Decimal
  /**层级0点数(总点数) */
  points: Decimal
  /**已解锁的成就数 */
  achievements: number
  /**存档版本 */
  version: string
}

/**读取指定槽位的摘要,槽位为空或存档损坏时返回exists=false */
export function getSlotSummary(slot: number): SlotSummary {
  const res: SlotSummary = {
    slot,
    exists: false,
    totalTime: new Decimal(0),
    points: new Decimal(0),
    achievements: 0,
    version: '',
  }
  const s = localStorage.getItem(gameName + '-save' + slot)
  if (s == null) return res
  try {
    const saveFile = parse(decompressFromBase64(s) || 'null')
    if (saveFile == null || typeof saveFile != 'object') return res
    res.exists = true
    res.totalTime = new Decimal(saveFile.totalTime ?? 0)
    res.points = new Decimal(saveFile.layers?.['0']?.points ?? 0)
    res.achievements = saveFile.achievements?.filter((x) => x.startsWith('a')).length ?? 0
    res.version = saveFile.version ?? ''
  } catch {
    //存档损坏时按空槽位处理
  }
  return res
}
/**获取全部存档槽位的摘要 */
export function getSlotSummaries(): SlotSummary[] {
  return Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => getSlotSummary(i))
}
/**指定槽位是否存在存档记录(无论内容是否有效) */
export function hasSlotSave(slot: number): boolean {
  return localStorage.getItem(gameName + '-save' + slot) != null
}

//------修改存档------
/**player中类型为Decimal的属性名 */
type decimalKey = { [K in keyof Player]: Player[K] extends Decimal ? K : never }[keyof Player]
/**将player中类型为Decimal的属性key增加value */
export function addValue(key: decimalKey, value: Decimal) {
  player[key] = player[key].add(value)
}

//------存档和读档------
/**将对象中的Decimal替换为{$d:字符串,$l:layer}标记(序列化用)
 * 注:layer0存mag的精确字符串(Double.toString/parseFloat为精确往返),
 * break_eternity的toString对|mag|<1会丢1ulp(导致存档往返不恒等) */
function markDecimals(obj: unknown): unknown {
  if (obj instanceof Decimal) {
    //Infinity(dInf)的layer为Infinity:JSON会把$l序列化成null,且字符串'Infinity'无法被Decimal解析成Infinity,须专门序列化保证往返精确
    if (!obj.isFinite()) return { $d: String(obj.sign * obj.mag), $l: 'Infinity' }
    if (obj.layer === 0) return { $d: String(obj.sign * obj.mag), $l: 0 }
    return { $d: obj.toString(), $l: obj.layer }
  }
  if (Array.isArray(obj)) return obj.map(markDecimals)
  if (obj != null && typeof obj == 'object') {
    const res: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      res[key] = markDecimals((obj as Record<string, unknown>)[key])
    }
    return res
  }
  return obj
}
/**将{$d,$l}标记还原为Decimal(读档用)
 * 注:层0用fromComponents_noNormalize按位精确还原(不经过会丢精度的normalize),
 * Infinity用数字入参构造(字符串'Infinity'会被解析成0),无$l标记的旧存档走fromString,保持旧行为 */
function unmarkDecimals(obj: unknown): unknown {
  if (obj != null && typeof obj == 'object' && '$d' in obj) {
    const marked = obj as { $d: string; $l?: number | string }
    if (marked.$l === 'Infinity') {
      return new Decimal(parseFloat(marked.$d))
    }
    if (marked.$l === 0) {
      const n = parseFloat(marked.$d)
      return Decimal.fromComponents_noNormalize(Math.sign(n), 0, Math.abs(n))
    }
    return new Decimal(marked.$d)
  }
  if (Array.isArray(obj)) return obj.map(unmarkDecimals)
  if (obj != null && typeof obj == 'object') {
    const res: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      res[key] = unmarkDecimals((obj as Record<string, unknown>)[key])
    }
    return res
  }
  return obj
}
/**
 * 规范层级键:把补零等非规范写法归一化,并删除非法键、含-1的键与空值
 * 层级表只存层级对象(无空占位),且同一槽位只能有一种写法,否则会破坏顺序索引与键查找
 * 规范化是无损的(如'0,5'→'5'、'0,0'→'0'),故旧档的补零键按迁移处理而不是丢弃;
 * 归一化后与已有键重合时保留先到的那一个
 */
function sanitizeLayers() {
  for (const key of Object.keys(player.layers)) {
    const L = player.layers[key]
    const pos = posArray(key)
    const valid =
      L != null && pos.length > 0 && pos.every((d) => Number.isInteger(d) && d >= 0)
    if (!valid) {
      delete player.layers[key]
      continue
    }
    const canonical = layerKey(pos)
    if (canonical == key) continue
    delete player.layers[key]
    if (player.layers[canonical] == null) player.layers[canonical] = L
    else addLog('warning', `存档中存在重复层级(${key}与${canonical}),已保留${canonical}`)
  }
}

/**校验存档的校验码(与stringify共用同一序列化基准) */
function verifySave(saveFile: Player): boolean {
  const previous = saveFile.checkCode
  const marked = markDecimals(saveFile) as Record<string, unknown>
  marked.checkCode = 0
  const code = checkCode(JSON.stringify(marked), saveFile.firstPlay ^ CHECKSUM_SALT)
  return previous == code
}
/**将存档转化为字符串 */
function stringify(): string {
  const marked = markDecimals(player) as Record<string, unknown>
  marked.checkCode = 0
  marked.checkCode = checkCode(JSON.stringify(marked), player.firstPlay ^ CHECKSUM_SALT)
  return compressToBase64(JSON.stringify(marked))
}
/**将字符串转化为Player对象 */
function parse(s1: string): Player {
  return unmarkDecimals(JSON.parse(s1)) as Player
}
/**尝试从字符串导入存档，并返回错误码 */
function load(s: string): number {
  const s1 = decompressFromBase64(s) || 'null'
  const saveFile = parse(s1)
  if (saveFile == null || typeof saveFile != 'object') {
    addLog('error', '导入失败!存档格式不正确![错误代码:101]')
    return 101
  } else if (versionComp(saveFile.version, CHECKSUM_VERSION) >= 0 && !verifySave(saveFile)) {
    addLog('error', '导入失败!存档疑似被修改过![错误代码:250]')
    unlockAchievementById('s15')
    return 250
  } else if (saveFile.lastPlay > Date.now()) {
    addLog('error', '导入失败!存档来自未来，加载它可能导致时空错乱![错误代码:301]')
    return 301
  } else if (saveFile.firstPlay > saveFile.lastPlay) {
    addLog('error', '导入失败!存档时间异常，加载它可能导致时空错乱![错误代码:302]')
    return 302
  } else if (saveFile.firstPlay < EARLIEST_SAVE_TIME) {
    addLog('error', '导入失败!存档创建时间过早，加载它可能导致时空错乱![错误代码:303]')
    return 303
  } else {
    try {
      migrate(saveFile)
    } catch {
      addLog('error', '导入失败!存档迁移出错![错误代码:400]')
      return 400
    }
    Object.assign(player, saveFile)
    player.version = gameVersion
    if (versionComp(saveFile.version, gameVersion) < 0) {
      addLog('warning', '存档版本过旧,部分迁移未执行,缺失内容已按默认值补齐')
    }
    //结构性校验(游戏未发布,无旧档迁移;缺失字段由initializeSave默认值覆盖)
    if (!(player.seed >= 0)) player.seed = 0
    if (!['warp', 'store', 'ask'].includes(player.offlineMode)) player.offlineMode = 'warp'
    //层级结构校验:丢弃非规范键;临时层不存档,清空后由下一次结构阶段按新层级重建
    sanitizeLayers()
    clearTempLayers()
    invalidateLayerOrder()
    if (getLayer(player.layerSubtab) == null) player.layerSubtab = [0]
    seedRng(player.rngState ?? player.seed)
    return 0
  }
}
/**保存存档到本地存储 */
export function localSave(slot: number = currentSlot.value) {
  localStorage.setItem(gameName + '-save' + slot, stringify())
}
/**从本地存储导入存档 */
export function localLoad(slot: number = currentSlot.value): boolean {
  const s = localStorage.getItem(gameName + '-save' + slot)
  if (s == null) {
    return false
  } else {
    return load(s) == 0
  }
}
/**获取当前存档的字符串(用于导出) */
export function exportSaveString(): string {
  return stringify()
}
/**从字符串导入存档 */
export function importSaveString(s: string): boolean {
  return load(s) == 0
}
/**硬重置 */
export function hardReset() {
  Object.assign(player, initializeSave())
  clearTempLayers()
  invalidateLayerOrder()
  addLog('info', '游戏已重置')
  localSave()
}
