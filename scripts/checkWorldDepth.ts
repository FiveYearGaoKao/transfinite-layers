//世界深度(坐标最大长度)与0阶窗口容量边界的验证脚本(对撞式,无测试框架):
//1. 0阶窗口未满:解锁照常(层级n 落在槽位n,高度=n)
//2. 0阶窗口已满且1阶内容未定义(v0.2.0 的终局):世界容不下更多层级 ——
//   解锁**什么都不做**(连下层清空都不做)、结构阶段也不会自己加深世界,临时层预览仍然看得见
//3. 1阶内容已定义时点这个解锁:进位 —— 加深世界并创建 [1,0]=ω(高度=1、绝对高度[1,0]、gap=1),
//   本次收益搬到新层级;自然数层级被这次重置清空但键仍保留(它们留给 ω 的重置去删)
//4. 世界深度≥2 后,0阶窗口满时照常轮转:层级10 出现(高度=10)、层级5 被淘汰,不再进位也不拒绝
//5. 只有0阶窗口会撞上"世界容不下":1阶及以上窗口满且下一阶内容未定义时照常轮转
//用法:node scripts/run-ts.mjs scripts/checkWorldDepth.ts
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { temp } from '@/data/temp'
import { getLayer, getLayerHeight, getLayerName, getPoints, levelGap } from '@/access'
import { isLayer0 } from '@/tools/ordinal'
import { constantCurve } from '@/compute/curves'
import { DIMENSIONS } from '@/compute/dimensions'
import { hasLayerContent } from '@/compute/layerContent'
import { canReset, PRESTIGE } from '@/compute/prestige'
import { isWorldCapacityReached, syncLayerStructure, unlockNextLayer } from '@/logic/layerStructure'
import { doReset } from '@/logic/reset'
import { check, ensureLayer0Order, freshSave, reportChecks } from './helpers'

/**把某层级的绝对高度格式化成断言用的文本 */
function heightText(pos: number[]): string {
  const h = getLayerHeight(pos)
  return h ? h.map((x) => x.toString()).join(',') : '未解锁'
}

console.log('== 1. 0阶窗口未满:解锁照常 ==')
freshSave()
ensureLayer0Order(3)
player.layerDepth = 1
check('槽位号=高度:槽位3的高度是3、名字是层级3', getLayerName([3]) == '层级3', heightText([3]))
check('窗口未满时不算"世界容不下"', !isWorldCapacityReached([-1]))

console.log('== 2. 0阶窗口已满 + 1阶内容未定义:拒绝且什么都不做 ==')
freshSave()
ensureLayer0Order(9)
player.layerDepth = 1
//临时层的解锁条件是"下层(层级9)的点数够",故先把层级9 的点数抬到门槛以上
player.layers['9']!.points = new Decimal('1e300')
//结构阶段(每帧跑):建立临时层预览
syncLayerStructure()
check('1阶内容未定义', !hasLayerContent(1))
check('窗口已满 ⇒ 世界容不下更多层级', isWorldCapacityReached([-1]))
check('临时层本来可解锁(下面测的才是容量守卫)', canReset([-1]))
check('真实层级不会被当成"世界容不下"(重置照常)', !isWorldCapacityReached([5]))
check('临时层预览仍在(层级10 看得见)', temp.tempLayers['-1'] != undefined)
check('结构阶段不会自己加深世界', player.layerDepth == 1)
check('不加深时不会建立ω窗口的临时层', temp.tempLayers['-1,0'] == undefined)
const keysBefore = Object.keys(player.layers).sort().join(',')
const points0Before = getPoints([0]).toString()
const points9Before = getPoints([9]).toString()
check('解锁被拒绝:返回原临时层坐标', unlockNextLayer([-1]).join(',') == '-1')
check('解锁被拒绝:重置不做任何事(连下层清空也不做)', doReset([-1]) == undefined)
check('层级表键没变', Object.keys(player.layers).sort().join(',') == keysBefore)
check('层级0点数没变', getPoints([0]).toString() == points0Before, getPoints([0]).toString())
check('层级9点数没变', getPoints([9]).toString() == points9Before, getPoints([9]).toString())
check('世界深度没变', player.layerDepth == 1)

console.log('== 3. 1阶内容已定义:解锁这一步轮转出层级10,随后进位成 [1,0]=ω 并立刻重置一次 ==')
//占位公式行只用来把"1阶内容已定义"打开(1阶数值内容实装前不会走到进位分支)
//(1阶真公式的口径见层级系统.md §十一.2:按"当前编号最大的自然数层级的高度"给 [1,0] 点数,level=10 ⇒ 1 点)
PRESTIGE.push({ resetGain: (layer) => (isLayer0(layer) ? new Decimal(0) : new Decimal(1)) })
DIMENSIONS.push({ curve: constantCurve(1) })
check('1阶内容已定义', hasLayerContent(1))
check('内容已定义后不再算"世界容不下"', !isWorldCapacityReached([-1]))
const newPos = doReset([-1])
check('进位后世界深度=2', player.layerDepth == 2)
check('解锁出[1,0]', !!newPos && newPos.join(',') == '1,0', String(newPos))
check('[1,0]的高度=1(系数,不是刚解锁的层级10)', getLayer([1, 0])!.level.eq(1))
check('绝对高度=[1,0](坐标≠高度)', heightText([1, 0]) == '1,0', heightText([1, 0]))
check('名字=层级1,0', getLayerName([1, 0]) == '层级1,0', getLayerName([1, 0]))
check('与层级0的间距gap=1', levelGap([1, 0]).eq(1), levelGap([1, 0]).toString())
check('新阶层级到手就有第一个点数(由它自己的重置给出)', getLayer([1, 0])!.points.eq(1))
check('整条自然数梯子被这次重置删掉(ω 的重置作用域)', !getLayer([9]) && !getLayer([1]))
check(
  '剩下的只有层级0与[1,0]',
  Object.keys(player.layers).sort().join(',') == '0,1,0',
  Object.keys(player.layers).sort().join(','),
)
check('层级0被这次重置抬回1点数(下限)', getPoints([0]).eq(1))
syncLayerStructure()
check('ω窗口的临时层随之建立', temp.tempLayers['-1,0'] != undefined)
check('[1,0]之下的子窗口临时层随之建立([1,-1])', temp.tempLayers['1,-1'] != undefined)
check('最深阶已有层级 ⇒ 不再算"世界容不下"', !isWorldCapacityReached([-1]))

console.log('== 4. 世界深度≥2 后:0阶窗口满时只轮转(层级10 出现、层级5 被淘汰、不再进位) ==')
ensureLayer0Order(9)
player.layerDepth = 2
player.layers['9']!.points = new Decimal('1e300')
syncLayerStructure()
const rotatePos = doReset([-1])
check('再次解锁不再进位(返回槽位9)', !!rotatePos && rotatePos.join(',') == '9', String(rotatePos))
check('槽位9的高度=10 ⇒ 名字是层级10', getLayerName([9]) == '层级10', heightText([9]))
check('槽位5已被层级6顶替(淘汰高度5)', getLayer([5])!.level.eq(6), getLayer([5])!.level.toString())
check('世界深度仍是2(没有再次进位)', player.layerDepth == 2)
check('没有把层级10 当成ω:[1,0] 还在且高度为1', getLayer([1, 0])!.level.eq(1))

console.log('== 5. 只有0阶窗口会撞上"世界容不下" ==')
check('2阶内容未定义', !hasLayerContent(2))
check('ω块内的0阶子窗口([1,-1]):1阶内容已定义,不受限', !isWorldCapacityReached([1, -1]))
check('1阶窗口的临时层([-1,0])不受0阶的容量限制', !isWorldCapacityReached([-1, 0]))

process.exit(reportChecks() ? 0 : 1)
