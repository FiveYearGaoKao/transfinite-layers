//层级编号(序数)的纯函数运算，不依赖任何游戏状态
import type { CompareResult } from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { arrayOrder, numComp } from './utils'

//------一些定义------
//本游戏一共有ω^ω个常规层级
//每个层级的编号可由任意长数组表示：[a1,a2,...,an]=ω^{n-1}*a_1+ω^{n-2}*a_2+...+ω*a_{n-1}+a_n
//坐标一律用"规范形式":去掉前导零位,全零写作[0],即坐标本身就是层级的绝对编号
//--例:[5]是序数5、[1,0]是序数ω、[1,5]是序数ω+5、[0]是序数0(层级0)
//--补零写法(如[0,5])不是规范坐标,一律经layerKey/trimLayerPos规范化后再使用
//--因此坐标不随player.layerDepth变化,而layerDepth只表示"世界深度"(选择矩阵可选到哪一位权)
//阶:层级"自己槽位"所在位的权重ω^n,即最低非零位的权重(与坐标长度无关)
//--例:[5]与[1,5]都是0阶(自己的槽位在ω^0位)、[1,0]是1阶、[1,0,0]是2阶
//--窗口:同一祖先层序列 + 同一位权的一组槽位;层级ω^n*A+ω^n的子层级(即它自己窗口内的槽位)是n阶
//子层级:层级ω^n*A+ω^n的子层级定义为ω^n*A+ω^{n-1}*m
//--n阶层级的子层级为n-1阶，0阶层级(后继序数层级)没有子层级
//--受内存限制，每个层级至多存储10个子层级(底部5个和顶部5个)，因子转换会降低这个限制
//路径层级:ω^(n+1)*A+ω^n*B的路径层级递归定义为ω^(n+1)*A和它的路径层级
//绝对高度:层级的绝对高度是一个数组(各路径层级的level),命名与序数比较的依据;
//--为节省空间,其前缀被放在路径层级中,层级对象自身只存末位分量(Layer.level)
//--因此坐标顺序与层级的序数大小一致(坐标长度优先,再按字典序比较)
//--绝对高度同样忽略前导零位,故其位数与规范坐标的位数一致
//临时层:坐标含-1,只是"将要解锁的最高层级"的预览(不生产/不加成/无自动化配置)
//--在概念上位于其窗口顶端之上,但arrayOrder会把-1当作最小值,故比较临时层时必须走专用分支

/**将字符串转化为坐标数组 */
export function posArray(str: string): LayerId {
  return str.split(',').map((x) => parseInt(x))
}
/**
 * 把坐标规范化为"去前导零"的形式(即与player.layerDepth无关的绝对编号写法)
 * 全零(含空数组)一律规范化为[0],即层级0的坐标
 * 规范化不改变坐标所表示的序数
 */
export function trimLayerPos(pos: LayerId): LayerId {
  const i = pos.findIndex((x) => x != 0)
  return i < 0 ? [0] : pos.slice(i)
}
/**
 * 坐标的存档键(层级表与自动化配置的唯一键来源)
 * 接受坐标或已有的键字符串,并保证结果是规范形式,避免同一槽位出现两种写法
 * 注:非法键(空串/非整数/负数)不在此处校验,读档时由save的sanitizeLayers处理
 */
export function layerKey(pos: LayerId | string): string {
  return trimLayerPos(typeof pos == 'string' ? posArray(pos) : pos).toString()
}
/**
 * 对层级编号进行偏移
 * 具体来说，将pos的右边第order位改为value,并将这一位以后设为0
 * @returns 偏移后的层级编号,已规范化为"去前导零"的形式(全零结果即层级0的坐标[0])
 */
export function shiftLayer(pos: LayerId, order: number, value: number): LayerId {
  const l = pos.length
  if (order >= l - 1) {
    const res: LayerId = new Array(order + 1).fill(0)
    if (value != 0) res[0] = value
    return trimLayerPos(res)
  } else {
    const res = pos.slice()
    res[l - order - 1] = value
    for (let i = l - order; i < l; ++i) {
      res[i] = 0
    }
    return trimLayerPos(res)
  }
}
/**
 * 获取一个层级的后继层级
 * @param n 表示层级编号增加ω^n
 * */
export function nextLayer(pos: LayerId, n: number = 0): LayerId {
  const idx = getLayerIndex(pos, n)
  return shiftLayer(pos, n, idx + 1)
}

/**
 * 获取层级从右往左数某一位
 * 注:n超出坐标长度时该位视为0(规范形式里"更高位为0"的位不出现)
 */
export function getLayerIndex(pos: LayerId, n: number): number {
  return pos[pos.length - n - 1] || 0
}
/**
 * 判断是否为层级0
 * 注:空数组也视为层级0(规范形式只写作[0])
 */
export function isLayer0(pos: LayerId): boolean {
  return pos.every((x) => x == 0)
}
/**判断坐标是否为临时层(含-1位) */
export function isTempLayer(pos: LayerId): boolean {
  return pos.includes(-1)
}
/**
 * 获取一个层级的阶:自己槽位所在位的权重ω^n,即最低非零位的权重
 * 注1:-1(临时层)也算非零位,否则前导-1的坐标(如[-1,0])会被误判为0阶
 * 注2:这只与"最低非零位"有关,[1,5]是0阶、[1,0]才是1阶;不能按坐标长度推断
 */
export function getLayerOrder(pos: LayerId): number {
  const i = pos.findLastIndex((x) => x != 0)
  return i < 0 ? 0 : pos.length - i - 1
}
/**比较两个层级编号的大小，按序数大小排序 */
export function compareLayer(a: LayerId, b: LayerId): CompareResult {
  return arrayOrder(a, b, numComp)
}

//------窗口(槽位)规则------
//每个窗口(同一父前缀下)有base个真实槽位(0~base-1)+1个临时槽位(-1)
//底部floor(base/2)个槽位固定不变,顶部ceil(base/2)个槽位在解锁新层级时整体下移一格
/**一个窗口内固定保留的槽位数(底部) */
export function pinnedSlotCount(base: number): number {
  return Math.floor(base / 2)
}
/**一个窗口内参与轮转的槽位数(顶部) */
export function rotatingSlotCount(base: number): number {
  return base - pinnedSlotCount(base)
}
