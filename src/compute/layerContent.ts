//层级内容的阶覆盖检查
//各阶的公式表必须显式覆盖,缺失即禁止解锁该阶的层级(见 docs/面向开发者/层级系统.md)
//这样避免出现"高阶层级悄悄套用0阶公式"这类静默错误
import { PRESTIGE } from './prestige'
import { DIMENSIONS } from './dimensions'

/**某阶是否已定义层级内容(重置公式与维度公式都必须存在) */
export function hasLayerContent(order: number): boolean {
  return order >= 0 && order < PRESTIGE.length && order < DIMENSIONS.length
}
