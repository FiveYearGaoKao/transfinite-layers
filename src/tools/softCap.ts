//软上限的纯函数变换(与存档/效果无关,故置于tools)
//低于阈值不处理;高于阈值时对价格的"对数"做幂次放大,使价格呈超指数增长
//支持"高度":先对价格做h-1次log10(下到指数塔第h层),在那一层做对数软上限,再还原,用于把软上限推迟到更高层
import Decimal from 'break_eternity.js'

/**
 * 应用"高度h的次方软上限"纯函数
 * height=1为现状:对价格的"对数"做幂次放大(value<=threshold原样返回,否则对数按power次方放大,幂越大越陡)
 * height>1:先把价格与阈值各log10(h-1)次(降到第h层指数塔),在那一层套用height=1的软上限,再还原(h-1)次
 */
export function softCapValue(value: Decimal, threshold: Decimal, power = 2, height = 1): Decimal {
  if (height < 1) height = 1
  if (height > 1) {
    //降到第h层:把价格与阈值各log10(h-1)次
    let y = value
    let t = threshold
    for (let i = 1; i < height; i++) {
      y = y.log10()
      t = t.log10()
    }
    //在第h层套用height=1的软上限(未触发时返回y不变),再还原h-1次即得原值
    let res = softCapValue(y, t, power, 1)
    for (let i = 1; i < height; i++) {
      res = Decimal.pow(10, res)
    }
    return res
  }
  if (value.lte(threshold)) return value
  const L = threshold.log10()
  const v = value.log10().div(L).pow(power).mul(L)
  return Decimal.pow(10, v)
}
