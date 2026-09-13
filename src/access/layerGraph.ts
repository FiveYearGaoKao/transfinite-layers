//层级结构(坐标/高度/顺序/相邻关系)的权威只读 API
//术语与规则详见 docs/面向开发者/层级系统.md
//- 坐标(LayerId)只表示"槽位",仅用于寻址;层级高度由 Layer.level 承担(绝对高度的末位分量)
//- 坐标是规范形式(去前导零,与layerDepth无关):键一律经layerKey生成与查找,同一槽位永远只有一种写法
//- 遍历顺序一律经本模块的顺序 API;禁止依赖 Object.keys(player.layers) 的键序
//  (JS 会把"数组下标样式"的键排在前面并按数值升序,混合键时无法表达高度顺序)
import Decimal, { type CompareResult, type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import { temp } from '@/data/temp'
import type { Layer, LayerId } from '@/data/types'
import { formatWhole } from '@/tools/format'
import {
  compareLayer,
  getLayerIndex,
  getLayerOrder,
  isLayer0,
  layerKey,
  posArray,
  shiftLayer,
} from '@/tools/ordinal'
import { arrayOrder } from '@/tools/utils'

/**一个层级在顺序表中的条目(层级对象每次调用时现取,避免缓存持有过期对象) */
export interface LayerEntry {
  /**存档键(坐标字符串) */
  key: string
  /**坐标 */
  pos: LayerId
  /**阶(由坐标派生) */
  order: number
  /**层级对象 */
  L: Layer
}

//------基础访问------
/**
 * 坐标字符串是否为临时层
 * 注:坐标数字只可能是-1或非负整数,故子串判定等价于"存在-1位"
 */
function isTempKey(key: string): boolean {
  return key.includes('-1')
}

/**获取某一层的引用(含临时层);坐标无对应层级时返回undefined */
export function getLayer(pos: LayerId | string): Layer | undefined {
  const key = layerKey(pos)
  if (isTempKey(key)) return temp.tempLayers[key]
  return player.layers[key]
}

/**判断某层是否启用 */
export function isActive(pos: LayerId): boolean {
  return getLayer(pos)?.active || false
}

/**
 * 获取层级的名称(显示的就是绝对高度)
 * 名字 = 绝对高度逐位格式化(去前导零)后用逗号连接,末尾hide位显示为星号
 * 任一路径层级不存在时返回"层级未解锁"
 * @param hide 最后多少位用星号"*"代替,至少有hide个星号
 */
export function getLayerName(pos: LayerId, hide: number = 0): string {
  const height = getLayerHeight(pos)
  if (!height) return '层级未解锁'
  const layerNames = height.map((x) => formatWhole(x))
  for (let i = Math.max(0, layerNames.length - hide); i < layerNames.length; ++i)
    layerNames[i] = '*'
  //hide超过坐标位数时补足星号,保证"至少有hide个"
  while (layerNames.length < hide) layerNames.push('*')
  return '层级' + layerNames.join(',')
}

//------层级顺序(唯一权威)------
/**有序键表(坐标升序,缓存) */
let orderedKeys: string[] | null = null
/**缓存对应的键集合签名(键集合变化即失效;自校验,漏调失效也会自愈) */
let orderedSignature = '\u0000'

/**层级键集合签名 */
function keysSignature(): string {
  return Object.keys(player.layers).join('|')
}
/**
 * 确保有序键表与当前层级集合一致
 * 注:顺序只由键(坐标)决定,层级对象在使用时现取,故缓存不会因为对象位置变化而失效
 */
function ensureOrderedKeys(): string[] {
  const sig = keysSignature()
  if (!orderedKeys || sig != orderedSignature) {
    orderedSignature = sig
    orderedKeys = Object.keys(player.layers).sort((a, b) => compareLayer(posArray(a), posArray(b)))
  }
  return orderedKeys
}
/**手动失效有序键表(结构变更后可调用;不调用也会被签名自校验纠正) */
export function invalidateLayerOrder() {
  orderedKeys = null
}

/**
 * 获取全部真实层级的条目
 * @param dir 'asc'低到高(自动化用),'desc'高到低(生产用)
 * 注:不含临时层(临时层只是预览,不参与生产与加成);不含不存在的键
 */
export function getOrderedLayers(dir: 'asc' | 'desc' = 'asc'): LayerEntry[] {
  const keys = ensureOrderedKeys()
  const seq = dir == 'desc' ? keys.toReversed() : keys
  const list: LayerEntry[] = []
  for (const key of seq) {
    const L = player.layers[key]
    if (!L) continue
    const pos = posArray(key)
    list.push({ key, pos, order: getLayerOrder(pos), L })
  }
  return list
}

/**按顺序遍历全部真实层级(生产用'desc',自动化用'asc') */
export function forEachLayer(dir: 'asc' | 'desc', fn: (e: LayerEntry) => void) {
  for (const e of getOrderedLayers(dir)) fn(e)
}

//------相邻与高度关系------
/**
 * 获取某层的前驱层级(纯坐标运算,O(1))
 * 语义:阶数大于等于它、坐标比它小、且存在的最高层级
 * 实现:把自身ω^order位的序号减一(该层级由性质P与窗口连续性保证存在);
 *      本层已是其窗口1号槽位时结果为该窗口的0号槽位(即该窗口的基础层级,基础窗口的就是层级0);
 *      临时层取其窗口内最高的活跃真实层级
 * 返回值是**坐标**:需要层级对象时再getLayer并检查存在性(见层级系统.md)
 */
export function prevLayer(pos: LayerId): LayerId {
  const n = getLayerOrder(pos)
  const idx = getLayerIndex(pos, n)
  if (idx > 0) return shiftLayer(pos, n, idx - 1)
  if (idx < 0) return highestActiveLayer(pos, n)
  //层级0:前驱是自身
  return pos.slice()
}

/**
 * 层级的绝对高度(各路径层级的level;零位为0),位数等于坐标位数
 * 任一路径层级(含临时层)不存在时返回undefined,调用方视为层级不存在/未解锁
 * 前导零位在绝对高度中同样没有意义,故它也是"去前导零的系数序列"(见compareHeight)
 */
export function getLayerHeight(pos: LayerId): Decimal[] | undefined {
  const height: Decimal[] = []
  const prefix: LayerId = new Array(pos.length).fill(0)
  for (let i = 0; i < pos.length; ++i) {
    const digit = pos[i] ?? 0
    prefix[i] = digit
    //零位的绝对高度就是0(无需查层级)
    if (digit == 0) {
      height.push(new Decimal(0))
      continue
    }
    const L = getLayer(prefix)
    if (!L) return undefined
    height.push(L.level)
  }
  return height
}
/**去掉前导零(高度向量与高度引用的规范化) */
function trimLeadingZeros(height: DecimalSource[]): Decimal[] {
  const i = height.findIndex((x) => !new Decimal(x).eq(0))
  return (i < 0 ? [] : height.slice(i)).map((x) => new Decimal(x))
}
/**
 * 比较两个绝对高度的大小(按序数大小:先比位数,再逐位比较)
 * 前导零被忽略,故[2]与[0,2]表示同一高度
 */
export function compareHeight(a: DecimalSource[], b: DecimalSource[]): CompareResult {
  const x = trimLeadingZeros(a)
  const y = trimLeadingZeros(b)
  return arrayOrder(x, y, Decimal.compare)
}
/**
 * 把"高度引用"解析为坐标:取高度等于引用的层级;不存在时取高度大于它的最低层级(上取整)
 * 所有层级都低于该引用时返回undefined(调用方视为未解锁)
 * 注:挑战等对层级的引用一律按高度解析,避免坐标随窗口平移而改变所指层级
 */
export function resolveHeightRef(ref: DecimalSource[]): LayerId | undefined {
  for (const e of getOrderedLayers('asc')) {
    const height = getLayerHeight(e.pos)
    if (height && compareHeight(height, ref) >= 0) return e.pos
  }
  return undefined
}

/**
 * 获取与某层处于同一窗口(同祖先层序列、同阶)内最高的层级
 * 窗口内槽位序即高度序,故"最高槽位"就是"最高层级";窗口内无其他层级时返回自身
 * 用途:需要"同窗口深度差"的计算(如知识升级"深度加成"),差值用 level 相减得到
 */
export function getWindowTopLayer(pos: LayerId): LayerId {
  return highestActiveLayer(pos, getLayerOrder(pos))
}

/**
 * 上层与其最近下层之间的高度差(跨层重置的唯一参数,gap≥1)
 * 无法成立时(层级0/临时层/下层缺失)返回1,即无跨层
 */
export function levelGap(upper: LayerId): Decimal {
  const U = getLayer(upper)
  const P = getLayer(prevLayer(upper))
  if (!U || !P) return new Decimal(1)
  const gap = U.level.sub(P.level)
  return gap.gte(1) ? gap : new Decimal(1)
}

/**
 * 获取层级在层级链上的存储层数(从层级0沿prevLayer数)
 * 注:这是"链上步数",与高度差不同;需要高度差时用levelGap
 */
export function getStoredChainLength(pos: LayerId): number {
  let length = 0
  let p = pos
  while (!isLayer0(p)) {
    const prev = prevLayer(p)
    if (prev.toString() == p.toString()) break
    p = prev
    length++
  }
  return length
}

/**获取编号最大的形如pos+ω^n*k的活跃层级 */
export function highestActiveLayer(pos: LayerId, n: number = 0): LayerId {
  let k = player.base - 1
  let pos1: LayerId = shiftLayer(pos, n, 0)
  while (k >= 0) {
    pos1 = shiftLayer(pos, n, k)
    if (isActive(pos1)) break
    k--
  }
  return pos1
}

/**所有活跃层级的引用(按高度升序,供资源展示/挑战豁免等共用) */
export function getActiveLayers(): { key: string; pos: LayerId; L: Layer }[] {
  return getOrderedLayers('asc')
    .filter((e) => e.L.active)
    .map((e) => ({ key: e.key, pos: e.pos, L: e.L }))
}

/**当前最高的活跃层级(全局最大,无活跃层返回undefined) */
export function getHighestActiveLayer(): LayerId | undefined {
  const active = getActiveLayers()
  const highest = active[active.length - 1]
  return highest ? highest.pos : undefined
}
