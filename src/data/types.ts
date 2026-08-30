//------类型声明------
import Decimal, { type DecimalSource } from 'break_eternity.js'

export interface Layer {
  active: boolean
  level: Decimal
  points: Decimal
  energy: Decimal
  /**已获得的总点数 */
  totalPoints: Decimal
  /**通过重置获得的最高点数 */
  bestPoints: Decimal
  /**自被更高级重置以来经过的时间(单位:秒) */
  resetTime: Decimal
  /**自被更高级重置以来点击重置按钮的次数 */
  resetCount: Decimal
  upgrades: number[]
  buyables: Record<number, Decimal>
  /**第一项为总数，第二项为购买数量*/
  dimensions: [Decimal, Decimal][]
}
export type LayerList = Record<string, Layer | null>
export type LayerId = number[]
/**层级的引用:层级坐标或层级对象;需要接受undefined的调用处显式写"LayerRef | undefined" */
export type LayerRef = LayerId | Layer
/**初始化一个层级的维度*/
export function initializeDimensions(layer: Layer) {
  layer.dimensions = []
  for (let i = 0; i < 4; ++i) layer.dimensions.push([new Decimal(0), new Decimal(0)])
}
/**
 * 创建一个空白层级
 * @param isLayer0 层级0初始有1点数，其他层级为0
 */
export function initializeLayer(level: DecimalSource, isLayer0: boolean = false): Layer {
  const layer: Layer = {
    active: true,
    level: new Decimal(level),
    points: isLayer0 ? new Decimal(1) : new Decimal(0),
    energy: new Decimal(0),
    totalPoints: new Decimal(0),
    bestPoints: new Decimal(0),
    resetTime: new Decimal(0),
    resetCount: new Decimal(0),
    upgrades: [],
    buyables: {},
    dimensions: [],
  }
  initializeDimensions(layer)
  return layer
}
/**一个空层级，防止getLayer返回undefined */
export const nullLayer = initializeLayer(0)
nullLayer.active = false

//------自动化类型------
/**所有自动化的公共配置 */
export interface AutoConfig {
  enabled: boolean
  /**同层三类自动化之间的优先级，越小越先执行 */
  priority: number
}
/**维度/可购买的自动购买配置 */
export interface AutoBuyConfig extends AutoConfig {
  /**购买顺序:asc从低到高，desc从高到低 */
  order: 'asc' | 'desc'
  /**至多消耗当前点数的百分比(0~100) */
  percent: number
  /**购买1个还是尽可能多买 */
  buyAmount: 'one' | 'max'
  /**每个购买项是否自动(仅显式为true的项会被购买) */
  perItem: Record<number, boolean>
}
/**自动重置配置 */
export interface AutoResetConfig extends AutoConfig {
  /**多个条件为任一满足还是全部满足 */
  combine: 'any' | 'all'
  useTime: boolean
  time: number
  usePoint: boolean
  /**可获得点数达到该值时触发 */
  point: Decimal
  useMult: boolean
  /**重置收益达到当前点数该倍率时触发 */
  mult: Decimal
}
/**某个层级的自动化配置 */
export interface LayerAutomation {
  /**各自动化类型的配置 */
  cfgs: Record<string, AutoConfig>
}
/**自动化类型定义 */
export interface AutomationDef<T extends AutoConfig = AutoConfig> {
  id: string
  /**显示名称 */
  name?: string
  /**创建默认配置 */
  defaultCfg(): T
  /**该层是否解锁此自动化 */
  isUnlocked(pos: LayerId): boolean
  /**配置是否激活(是否有小开关开着) */
  isActive(cfg: T): boolean
  /**将该类型所有小开关设为on/off */
  setAll(pos: LayerId, cfg: T, on: boolean): void
  /**每帧更新 */
  onTick(pos: LayerId, cfg: T): void
}
/**创建默认的自动购买配置 */
export function defaultAutoBuy(priority: number = 1): AutoBuyConfig {
  return { enabled: false, priority, order: 'asc', percent: 50, buyAmount: 'one', perItem: {} }
}
/**创建默认的自动重置配置 */
export function defaultAutoReset(): AutoResetConfig {
  return {
    enabled: false,
    priority: 3,
    combine: 'any',
    useTime: false,
    time: 10,
    usePoint: false,
    point: new Decimal(1),
    useMult: false,
    mult: new Decimal(2),
  }
}
