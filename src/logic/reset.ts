//进行重置
//规则(详见 docs/面向开发者/层级系统.md):
//- 重置的唯一入口是doReset;先算收益(含重置瞬间成就判定)再写状态
//- 三类重置:晋升(forced=false,拿收益并重置自身进度)、强制级联(forced=true,无收益不动自身)、重开本轮(清零本层)
//- 删层范围与解锁新层级由logic/layerStructure负责
import Decimal from 'break_eternity.js'
import { initializeDimensions, type LayerId } from '@/data/types'
import {
  getLayer,
  getLayerName,
  getOrderedTempLayers,
  getUnlockedNormalAchievementCount,
  hasAchievement,
} from '@/access'
import { getLayerOrder, isLayer0, isTempLayer } from '@/tools/ordinal'
import { canReset, resetGain } from '@/compute/prestige'
import { hasUpgrade } from '@/compute/upgrades'
import { hasInfinityUpgrade } from '@/compute/infinity'
import { hasLayerContent } from '@/compute/layerContent'
import { dimensionCount } from '@/compute/metaDimension'
import { addLog } from '@/data/log'
import { checkResetAchievements } from './achievements'
import { isWorldCapacityReached, unlockNextLayer, wipeLayerScope } from './layerStructure'
import { clearFrameCache } from '@/compute/frameCache'

/**重置选项 */
interface ResetOptions {
  /**保留本层能量和维度数量(升级u7) */
  keepProgress?: boolean
  /**保留下层升级(升级u8) */
  keepUpgrades?: boolean
}

/**某升级是否被无限升级保护(不会被普通层级重置;无限重置自身清空一切,不受此保护) */
function upgradeProtectedByInfinity(id: number): boolean {
  return (
    (id == 4 && hasInfinityUpgrade('iu14')) ||
    (id == 5 && hasInfinityUpgrade('iu24')) ||
    (id == 6 && hasInfinityUpgrade('iu34')) ||
    (id == 7 && hasInfinityUpgrade('iu44')) ||
    (id == 8 && hasInfinityUpgrade('iu54'))
  )
}

/**重置一个层级的数据(清除维度/升级/可购买等) */
export function resetData(layer: LayerId, opts: ResetOptions = {}) {
  resetDataInner(layer, opts)
  //清空维度和可购买会改变加成:帧内缓存失效
  clearFrameCache()
}

/**resetData的实现体 */
function resetDataInner(layer: LayerId, opts: ResetOptions) {
  const L = getLayer(layer)
  if (L) {
    const keepUpgrades = opts.keepUpgrades ?? false
    //层级0永远至少保留1点,如果解锁了a24(速通高手)其他层也能保留1点.
    const minPoints = isLayer0(layer) || hasAchievement('a24') ? new Decimal(1) : new Decimal(0)
    let maxPoints = minPoints
    //无限升级iu31:普通层级重置后保留至多(当前解锁普通成就总量)的点数
    if (hasInfinityUpgrade('iu31'))
      maxPoints = Decimal.max(maxPoints, getUnlockedNormalAchievementCount())
    //iu31只能提供上限而不是直接赋值:否则则"进入c4后在最高层重开本轮"会把该层点数凭空刷到N(几乎无损白拿N点)
    //而下限1点是不破坏平衡的,因为你解锁了这个层就代表你曾经至少拥有过1点数
    L.points = L.points.clamp(minPoints, maxPoints)
    L.totalPoints = new Decimal(0)
    L.bestPoints = new Decimal(0)
    L.resetCount = new Decimal(0)
    L.energy = new Decimal(0)
    L.resetTime = new Decimal(0)
    L.buyables = {}
    //未保留下层升级时,仅保留被无限升级保护的升级(u4~u8),其余全部清空
    if (!keepUpgrades) L.upgrades = L.upgrades.filter((u) => upgradeProtectedByInfinity(u))
    //维度数量按当前的元维度提升次数取(不能写死4个,否则元维度提升解锁的维度会被重置吃掉)
    initializeDimensions(L, dimensionCount())
  }
}

/**晋升时重置本层自身进度:维度总量重置为已购数量,能量清零;购买u7(能量保留)则保留 */
function resetProgress(layer: LayerId) {
  const L = getLayer(layer)
  if (!L || hasUpgrade(layer, 7)) return
  L.energy = new Decimal(0)
  for (const dim of L.dimensions) dim[0] = new Decimal(dim[1])
}

/**
 * 重置一个层级
 * "是否获得资源"与"是否强制重置"绑定:非强制=晋升(拿收益并重置自身进度),强制=级联重置下层(不拿收益、不动自身)——
 * 因此只用一个forced参数表达;强制重置同时跳过canReset判定
 * @param forced 是否为强制重置(级联重置下层时用:不获得资源、不重置本层自身进度、不判定重置成就,且不检查canReset)
 * @param forceClearUpgrades 是否无视升级u8强制清空下层升级(进入/退出挑战时用)
 * @returns 本次重置解锁出的新层级坐标(仅重置临时层时有值;视角切换由调用方负责,见app/uiActions)
 */
export function doReset(
  layer: LayerId,
  forced: boolean = false,
  forceClearUpgrades: boolean = false,
): LayerId | undefined {
  const newPos = doResetInner(layer, forced, forceClearUpgrades)
  //只要走到这里就可能改过点数/维度/可购买(无论是否解锁出新层级):帧内缓存失效(见compute/frameCache)
  clearFrameCache()
  return newPos
}

/**doReset的实现体:把"写状态"与"缓存失效"分开,保证任何提前返回也统一失效 */
function doResetInner(
  layer: LayerId,
  forced: boolean,
  forceClearUpgrades: boolean,
): LayerId | undefined {
  if (!forced && !canReset(layer)) return undefined
  //世界容不下更多层级:解锁这个临时层不做任何事(连它引起的下层清空也不做);提示与成就在 app/uiActions 的点击路径里
  if (isTempLayer(layer) && isWorldCapacityReached(layer)) return undefined
  if (isLayer0(layer)) return undefined
  const L = getLayer(layer)
  //是否结算收益(强制级联只负责清空下层)
  const gainEnabled = !forced && L?.active == true
  //先算收益并判定重置瞬间成就(须在清空能量/重置下层之前,且不计级联强制重置)
  const gain = gainEnabled ? resetGain(layer) : new Decimal(0)
  if (gainEnabled) checkResetAchievements({ layer, gain })
  //晋升:重置本层自身进度(强制级联不动自身)
  if (!forced) resetProgress(layer)
  //获得本层级资源
  if (gainEnabled && L) {
    L.points = L.points.add(gain)
    L.totalPoints = L.totalPoints.add(gain)
    L.resetCount = L.resetCount.add(1)
    L.bestPoints = L.bestPoints.max(gain)
  }
  //重置下层:先删除开区间(prevLayer(layer), layer)内的层级,再清空并级联重置下层目标
  //(0阶层级的下层就是相邻槽位,区间为空,等价于"只清空不删层")
  const prev = wipeLayerScope(layer)
  resetData(prev, {
    keepUpgrades: !forceClearUpgrades && hasUpgrade(layer, 8),
  })
  doReset(prev, true, forceClearUpgrades)
  //临时层:转为真实层级(解锁下一个层级);视角是否切到新层级由调用方决定
  if (!isTempLayer(layer)) return undefined
  const newPos = unlockNextLayer(layer)
  //进位(返回的层级阶更高)时立刻结算一次它的重置:设计口径是"点击那一下 = 解锁层级10 + 一次 [1,0] 重置",
  //于是新阶层级到手就有第一个点数(由该阶公式按自然数顶层高度给出),整条自然数梯子也由这次重置清掉
  if (getLayerOrder(newPos) > getLayerOrder(layer)) doReset(newPos)
  return newPos
}

/**
 * 找出当前可自动解锁的临时层(该阶内容已定义且满足解锁条件,即canReset)
 * 升序遍历:基础窗口的[-1]优先,再轮到更高阶窗口的临时层
 */
export function findUnlockableTempLayer(): LayerId | undefined {
  return getOrderedTempLayers().find((e) => hasLayerContent(e.order) && canReset(e.pos))?.pos
}

/**
 * 自动解锁指定临时层(元层自动化"自动解锁新层级"):与手动点击临时层重置等价(新层级带上本次收益),
 * 但不抢视角、不弹二次确认
 * @returns 新层级坐标;未解锁时返回undefined
 */
export function autoUnlockTempLayer(tempPos: LayerId): LayerId | undefined {
  const newPos = doReset(tempPos)
  if (newPos) addLog('automator', `自动解锁了${getLayerName(newPos)}`)
  return newPos
}

/**
 * 不获得资源的强制重置(挑战4"后悔"按钮)
 * 直接resetData本层(点数清零、清除维度/可购买,使C4价格偏移恢复),再级联重置下层;保留本层升级
 * 临时层(含-1)禁止调用:在临时层重置会无条件解锁新层级
 */
export function resetRunWithoutGain(pos: LayerId) {
  if (isTempLayer(pos)) return
  const L = getLayer(pos)
  if (!L || !L.active) return
  resetData(pos, { keepUpgrades: true })
  doReset(pos, true, false)
}
