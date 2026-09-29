//世界深度(坐标最大长度)提升的验证脚本(对撞式,无测试框架):
//1. 坐标≠高度:0阶窗口进位后槽位9的高度是10,名字是"层级10"
//2. 下一阶内容未定义时:即使达到进位高度也不提升,且不建立ω窗口的临时层(不会出现点了没反应的死层级)
//3. 内容已定义时(用占位公式行打开门):提升一次,本帧结构阶段建立ω窗口的临时层,重置它能解锁 [1,0];
//   [1,0] 的高度/命名/间距符合"坐标≠高度"的语义(level=a ⇒ 绝对高度[a,0]、序数ω·a、gap=1)
//用法:node scripts/run-ts.mjs scripts/checkWorldDepth.ts
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { temp } from '@/data/temp'
import { getLayer, getLayerHeight, getLayerName, levelGap } from '@/access'
import { isLayer0 } from '@/tools/ordinal'
import { constantCurve } from '@/compute/curves'
import { DIMENSIONS } from '@/compute/dimensions'
import { hasLayerContent } from '@/compute/layerContent'
import { PRESTIGE } from '@/compute/prestige'
import { promoteWorldDepth, syncLayerStructure } from '@/logic/layerStructure'
import { doReset } from '@/logic/reset'
import { check, ensureLayer0Order, freshSave, reportChecks } from './helpers'

/**把某层级的绝对高度格式化成断言用的文本 */
function heightText(pos: number[]): string {
  const h = getLayerHeight(pos)
  return h ? h.map((x) => x.toString()).join(',') : '未解锁'
}

console.log('== 1. 坐标≠高度:0阶窗口进位 ==')
freshSave()
ensureLayer0Order(9)
//0阶窗口的坐标长度只有1(helper把layerDepth设成"槽位+1"是给它自己的用例用的)
player.layerDepth = 1
player.layers['9']!.level = new Decimal(9)
check('未到进位高度时不加深世界', !promoteWorldDepth() && player.layerDepth == 1)
player.layers['9']!.level = new Decimal(player.base)
check('槽位9的高度=10 ⇒ 名字是层级10', getLayerName([9]) == '层级10', heightText([9]))
check('1阶内容未定义', !hasLayerContent(1))
check('达到进位高度也不加深(下一阶内容未定义)', !promoteWorldDepth() && player.layerDepth == 1)
syncLayerStructure()
check('不加深时不会建立ω窗口的临时层', temp.tempLayers['-1,0'] == undefined)

console.log('== 2. 定义1阶内容后:加深世界并解锁 [1,0] ==')
//占位公式行只用来把"1阶内容已定义"打开(1阶数值内容实装前 promoteWorldDepth 是空转的)
PRESTIGE.push({
  resetGain: (layer) => (isLayer0(layer) ? new Decimal(0) : new Decimal(1)),
})
DIMENSIONS.push({ curve: constantCurve(1) })
check('1阶内容已定义', hasLayerContent(1))
check('达到进位高度且内容已定义 ⇒ 加深一次', promoteWorldDepth() && player.layerDepth == 2)
syncLayerStructure()
check('ω窗口的临时层已建立', temp.tempLayers['-1,0'] != undefined)
const newPos = doReset([-1, 0])
check(
  '重置临时层解锁出[1,0]',
  !!newPos && newPos.join(',') == '1,0' && !!getLayer([1, 0]),
  String(newPos),
)
check('新层级高度=基准层高度+1(=1)', getLayer([1, 0])!.level.eq(1))
check('绝对高度=[1,0](坐标≠高度)', heightText([1, 0]) == '1,0', heightText([1, 0]))
check('名字=层级1,0', getLayerName([1, 0]) == '层级1,0', getLayerName([1, 0]))
check('与层级0的间距gap=1', levelGap([1, 0]).eq(1), levelGap([1, 0]).toString())
check('最深阶已有层级 ⇒ 不再重复加深', !promoteWorldDepth() && player.layerDepth == 2)
syncLayerStructure()
check('内容齐备后该阶子窗口的临时层随之建立([1,-1])', temp.tempLayers['1,-1'] != undefined)

process.exit(reportChecks() ? 0 : 1)
