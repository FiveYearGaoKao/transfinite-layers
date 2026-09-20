//软上限的纯函数变换(与存档/效果无关,故置于tools)
//低于阈值不处理;高于阈值时,power>1时使数值变大(用于增加物品价格),power<1时使数值变小(用于减少游戏资源)
//支持"高度":先对价格做h次log10(下到指数塔第h层),在那一层做对数软上限,再还原,用于把软上限推迟到更高层
//log的定义域为x>0:下降(iteratedlog)结果非正/非有限时,将适当增大阈值
import Decimal, { type DecimalSource } from 'break_eternity.js'

/**
 * 应用"高度h的次方软上限"纯函数
 * height=0为“标准软上限”:x=>c*(x/c)^p
 * height=1为价格的超指数软上限:对价格的"对数"做幂次放大(value<=threshold原样返回,否则对数按power次方放大,幂越大越陡)
 * height>1:先把价格与阈值各log10(h)次(降到第h层指数塔),在那一层套用height=0的软上限,再还原h次
 * 边界:log定义域为x>0,将设置最低阈值保证在log的定义域内;非正/非有限的输入原样返回
 */
export function softCapValue(
  value: Decimal,
  threshold: Decimal,
  power: DecimalSource = 2,
  height = 0,
): Decimal {
  if (height < 0) height = 0
  //软上限的最小阈值(小于此阈值对数没有意义)
  threshold = threshold.max(new Decimal(1).layeradd10(height))
  //低于阈值原样返回
  if (value.lte(threshold)) return value
  //先分别取height次对数
  const v1 = value.layeradd10(-height)
  const t1 = threshold.layeradd10(-height)
  return v1.div(t1).pow(power).mul(t1).layeradd10(height)
}
