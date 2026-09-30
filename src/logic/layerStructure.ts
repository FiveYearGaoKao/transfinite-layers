//层级结构变更的唯一入口(写状态)
//规则(详见 docs/面向开发者/层级系统.md):
//- 只有本模块可以增删 player.layers 的键;层级平移只能作为重置过程的副产物出现
//- 键一律经 layerKey(规范化坐标)生成,保证同一槽位只有一种写法
//- 临时层(-1)只是"将要解锁的最高层级"的预览:不参与生产、不提供加成、没有自动化配置
//- 每帧的结构阶段先于生产阶段执行,保证一帧内层级结构稳定
//- 世界加深(进位)不由结构阶段触发,而是"解锁最高阶窗口的下一个层级"这一步的结果(见 unlockNextLayer)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { temp } from '@/data/temp'
import { initializeLayer, type Layer, type LayerId } from '@/data/types'
import {
  getLayer,
  getOrderedLayers,
  highestActiveLayer,
  invalidateLayerOrder,
  isActive,
  prevLayer,
} from '@/access'
import { hasLayerContent } from '@/compute/layerContent'
import { dimensionCount } from '@/compute/metaDimension'
import { addLog } from '@/data/log'
import {
  compareLayer,
  getLayerIndex,
  getLayerOrder,
  isLayer0,
  isTempLayer,
  layerKey,
  nextLayer,
  pinnedSlotCount,
  shiftLayer,
} from '@/tools/ordinal'

//------结构阶段------
/**
 * 一帧的结构阶段:同步全部临时层
 * 临时层只更新高度(窗口内最高真实层级高度+1)或按需创建,不参与生产/加成/自动化
 */
export function syncLayerStructure() {
  syncTempLayers([0], player.layerDepth - 1)
}

/**递归同步各阶窗口的临时层 */
function syncTempLayers(pos: LayerId, n: number) {
  if (n > 0) {
    for (let i = 0; i < player.base; i++) {
      const pos1 = shiftLayer(pos, n, i)
      if (isActive(pos1)) syncTempLayers(pos1, n - 1)
    }
  }
  const posh = highestActiveLayer(pos, n)
  syncTempLayer(posh, n)
}
/**
 * 同步单个窗口的临时层:更新其高度,不存在则创建
 * 临时层坐标 = 该窗口的槽位-1(基础窗口的[-1]、[1,·]窗口的[1,-1]、ω窗口的[-1,0])
 */
function syncTempLayer(pos: LayerId, n: number = 0) {
  const L = getLayer(pos)
  if (!L) return
  const pos1 = shiftLayer(pos, n, -1)
  const newLevel = L.level.add(1)
  const tempL = getLayer(pos1)
  if (!tempL) {
    temp.tempLayers[layerKey(pos1)] = initializeLayer(newLevel, false, dimensionCount())
  } else {
    tempL.level = newLevel
  }
}

//------删层(重置作用域)------
/**
 * 重置一个层级时的删层范围:删除开区间(prevLayer(layer), layer)内的全部层级
 * 返回下层目标(调用方随后对其执行清空与级联重置)
 * 注:0阶层级的下层就是相邻槽位,区间为空,故只清空不删层
 */
export function wipeLayerScope(layer: LayerId): LayerId {
  const prev = prevLayer(layer)
  const doomed = getOrderedLayers('asc').filter(
    (e) => compareLayer(e.pos, prev) > 0 && compareLayer(e.pos, layer) < 0,
  )
  for (const e of doomed) delete player.layers[e.key]
  if (doomed.length > 0) invalidateLayerOrder()
  return prev
}
/**
 * 删除所有满足条件的层级(无限重置/因子转换用),返回删除数量
 * 作用域必须由调用方按阶显式声明:无限重置只删0阶层级,因子转换删所有非零层级
 */
export function wipeLayersWhere(pred: (pos: LayerId, L: Layer) => boolean): number {
  let count = 0
  for (const e of getOrderedLayers('asc')) {
    if (pred(e.pos, e.L)) {
      delete player.layers[e.key]
      count++
    }
  }
  if (count > 0) invalidateLayerOrder()
  return count
}

/**把层级0重建为全新初始状态(元层重置用) */
export function recreateLayer0() {
  player.layers['0'] = initializeLayer(0, true, dimensionCount())
}

//------解锁新层级------
/**把自动化配置随层级对象一起从fromKey搬到toKey(无配置则跳过) */
function moveAutomation(fromKey: string, toKey: string) {
  const cfg = player.automations[fromKey]
  if (cfg) player.automations[toKey] = cfg
  delete player.automations[fromKey]
}

/**窗口是否已满(0~base-1 号槽位都有真实层级):满则再解锁下一个层级要么进位、要么轮转 */
function isWindowFull(pos: LayerId, n: number): boolean {
  return getLayerIndex(highestActiveLayer(pos, n), n) >= player.base - 1
}

/**
 * 该临时层是否被"世界容不下更多层级"挡住(0阶窗口已满、且1阶内容未定义;1阶内容未定义只可能出现在 layerDepth=1)
 * 只对临时层成立(真实层级的重置与容量无关):命中时解锁**不做任何事**(连它引起的下层清空也不做),
 * 提示与成就在调用处(app/uiActions 的点击路径),logic 侧由 logic/reset.ts 的守卫兜住
 * 之所以拒绝而不是照常轮转:轮转会造出高度 ≥ base 的0阶层级(如 base=10 时的层级10),
 * 而那个高度在序数里已经没有自己的位置(它本该由进位变成 ω),见 docs/面向开发者/层级系统.md §六
 * 注:更高阶窗口(1阶及以上)满且下一阶内容未定义时**不**拒绝,照常轮转(那时玩家已经见过进位)
 */
export function isWorldCapacityReached(tempPos: LayerId): boolean {
  if (!isTempLayer(tempPos) || getLayerOrder(tempPos) != 0 || hasLayerContent(1)) return false
  return isWindowFull(tempPos, 0)
}

/**
 * 解锁下一个层级:把临时层转为真实层级并重建临时层
 * 窗口未满:新层级直接占用下一个槽位
 * 窗口已满:底部pinnedSlotCount个槽位固定,顶部槽位整体下移一格(最低的那个被淘汰);
 *   **若这是最高阶窗口且下一阶内容已定义,轮转之后立刻进位**(`layerDepth += 1` + 开出新阶窗口的基础层级,
 *   0 阶窗口满 ⇒ 先得到层级10、再开出 [1,0]=ω);新阶层级的第一次重置由 logic/reset.ts 紧接着做
 * 0阶窗口已满且1阶内容未定义:世界容不下更多层级,不做任何变化(见 isWorldCapacityReached)
 * 自动化配置跟随层级对象搬移(临时层的配置转给新层级;新临时层按全局配置重建)
 * 阶内容未定义时拒绝解锁,避免高阶层级静默套用低阶公式
 * 注:本模块只负责结构变更,**不改视角**;需要跟随到新层级时由调用方(如手动重置)拿返回值自行切换
 * @param tempPos 临时层坐标
 * @returns 新层级坐标(进位时是新阶窗口的基础层级);未解锁时返回原临时层坐标
 */
export function unlockNextLayer(tempPos: LayerId): LayerId {
  const L = getLayer(tempPos)
  if (!L) return tempPos
  const n = getLayerOrder(tempPos)
  if (!hasLayerContent(n)) {
    addLog('warning', `层级阶${n}的内容尚未定义,已阻止解锁新层级`)
    return tempPos
  }
  const tempKey = layerKey(tempPos)
  const posh = highestActiveLayer(tempPos, n)
  const idx = getLayerIndex(posh, n)
  let realPos: LayerId
  /**本次解锁是否要连带进位 */
  let carry = false
  if (idx < player.base - 1) {
    //窗口未满:新层级接在同一窗口的下一个槽位(同阶,故用nextLayer(posh, n))
    realPos = nextLayer(posh, n)
    player.layers[layerKey(realPos)] = L
    moveAutomation(tempKey, layerKey(realPos))
  } else if (isWorldCapacityReached(tempPos)) {
    //世界容不下更多层级:结构不做任何变化
    return tempPos
  } else {
    //窗口已满:顶部槽位整体下移一格,新层级进入最高槽位
    for (let i = pinnedSlotCount(player.base); i < player.base - 1; i++) {
      const pos1 = shiftLayer(tempPos, n, i)
      const pos2 = shiftLayer(tempPos, n, i + 1)
      const moved = getLayer(pos2)
      //源槽位在满窗口下必然存在;缺失时删除目标键,层级表不保留空占位
      if (moved) player.layers[layerKey(pos1)] = moved
      else delete player.layers[layerKey(pos1)]
      //自低向高搬移,避免覆盖尚未搬走的配置
      moveAutomation(layerKey(pos2), layerKey(pos1))
    }
    realPos = posh.slice()
    player.layers[layerKey(realPos)] = L
    moveAutomation(tempKey, layerKey(realPos))
    //最高阶窗口满且下一阶内容已定义 ⇒ 轮转之后进位
    carry = n == player.layerDepth - 1 && hasLayerContent(n + 1)
  }
  //重建临时层(预览下一层):其高度为新顶层高度+1,无需等下一次结构阶段校正
  temp.tempLayers[tempKey] = initializeLayer(L.level.add(1), false, dimensionCount())
  invalidateLayerOrder()
  if (carry) {
    //进位:加深世界(新阶窗口随之出现),再开出新阶窗口的基础层级(0阶窗口满 ⇒ 先得到层级10、再开出 [1,0]=ω)
    //新阶层级的第一次重置由 logic/reset.ts 紧接着做(见那里的说明)
    player.layerDepth += 1
    syncLayerStructure()
    realPos = unlockNextLayer(shiftLayer(tempPos, n + 1, -1))
    invalidateLayerOrder()
  }
  return realPos
}

//------不变量自检(调试模式)------
/**上次报告的结构不变量问题(避免每帧刷屏) */
let lastInvariantReport = ''
/**
 * 检查结构不变量,返回问题列表(无问题时为空)
 * I1 键必须是规范坐标(去前导零,全零即'0'),且长度不超过layerDepth(否则选择矩阵显示不到它)
 * I2 同一窗口(同祖先层序列 + 同槽位位权)内槽位的高度严格递增
 * I3 除层级0外每个层级都存在前驱(不指向自身)
 * I4 player.layers中不含临时层坐标
 * 注:只在报告内容变化时输出,便于调试模式下每帧调用
 */
export function checkLayerInvariants(): string[] {
  const errors: string[] = []
  const list = getOrderedLayers('asc')
  for (const e of list) {
    const canonical = layerKey(e.pos)
    if (canonical != e.key) errors.push(`I1 键${e.key}不是规范坐标(应为${canonical})`)
    if (e.pos.length > player.layerDepth)
      errors.push(`I1 坐标${e.key}长度${e.pos.length}>世界深度${player.layerDepth}`)
    if (e.pos.includes(-1)) errors.push(`I4 临时层坐标${e.key}出现在player.layers中`)
    if (!isLayer0(e.pos) && prevLayer(e.pos).toString() == e.pos.toString())
      errors.push(`I3 层级${e.key}的前驱指向自身`)
  }
  //按窗口分组检查高度递增。窗口 = (祖先层序列, 自己槽位所在的位权),
  //两者都要进键:规范坐标长度不固定,光看祖先序列会把"基础窗口"与"ω窗口"混为一组
  const windows = new Map<string, { pos: LayerId; level: Decimal }[]>()
  for (const e of list) {
    const prefix = e.pos.slice(0, e.pos.length - e.order - 1)
    const group = windows.get(`${e.order}|${prefix.toString()}`) || []
    group.push({ pos: e.pos, level: e.L.level })
    windows.set(`${e.order}|${prefix.toString()}`, group)
  }
  for (const [windowKey, group] of windows) {
    group.sort((a, b) => compareLayer(a.pos, b.pos))
    for (let i = 1; i < group.length; ++i) {
      const lo = group[i - 1]
      const hi = group[i]
      if (lo && hi && !hi.level.gt(lo.level))
        errors.push(
          `I2 窗口[${windowKey}]内高度未严格递增:${lo.pos}(${lo.level})→${hi.pos}(${hi.level})`,
        )
    }
  }
  const report = errors.join('\n')
  if (report == lastInvariantReport) return []
  lastInvariantReport = report
  return errors
}
