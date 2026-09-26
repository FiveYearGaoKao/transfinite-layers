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
/**层级表:键为坐标字符串,值一律是层级对象(不存在空占位) */
export type LayerList = Record<string, Layer>
/**
 * 层级坐标(槽位路径):规范形式是"去前导零的系数序列",全零即[0](层级0)
 * 每一位是该层路径上某一级窗口的槽位号,最高位是它最早进入的那一级;坐标与player.layerDepth无关
 * 阶 = 自己槽位所在位的权重(例:[5]与[1,5]都是0阶、[1,0]是1阶);存档键为 layerKey(pos)(见tools/ordinal)
 * 只表示相对位置、仅用于寻址;规则详见docs/面向开发者/层级系统.md
 */
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
  /**幂次:重置收益达到"当前点数的 power 次方"时触发(与"倍率"是各自独立的条件) */
  usePower: boolean
  /**幂次条件的次方(power>1 门槛更高=重置更慢;power<1 门槛更低=重置更急) */
  power: Decimal
}
/**某个层级的自动化配置 */
export interface LayerAutomation {
  /**各自动化类型的配置 */
  cfgs: Record<string, AutoConfig>
}
/**自动化配置的形状:决定用哪个配置UI组件与哪套读档兜底 */
export type AutoConfigKind = 'buy' | 'reset'
/**自动化类型定义 */
export interface AutomationDef<T extends AutoConfig = AutoConfig> {
  id: string
  /**显示名称 */
  name?: string
  /**配置形状(自动购买类/自动重置类) */
  configKind: AutoConfigKind
  /**是否支持"买最大"(升级自动化逐项购买,不支持批量) */
  supportsBatch?: boolean
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
/**
 * 元层自动化类型定义(全局唯一实例:配置不按层级存放,每个id一份)
 * 与层级自动化(AutomationDef)的差别:解锁由机制自己判定(成就/知识/里程碑等),每帧各跑一次而非每层一次
 */
export interface MetaAutomationDef<T extends AutoConfig = AutoConfig> {
  id: string
  /**显示名称 */
  name: string
  /**配置形状(决定用哪个配置UI组件) */
  configKind: AutoConfigKind
  /**配置编辑器里隐藏"倍率"与"幂次"两个条件(该上下文里恒成立或恒不成立时用,如临时层点数恒为0) */
  hideMult?: boolean
  /**是否已解锁 */
  isUnlocked(): boolean
  /**创建默认配置 */
  defaultCfg(): T
  /**读档兜底:补齐配置的缺失/非法字段 */
  sanitizeCfg(cfg: unknown): T
  /**配置是否激活(总开关) */
  isActive(cfg: T): boolean
  /**把总开关设为on/off */
  setAll(cfg: T, on: boolean): void
  /**每帧更新 */
  onTick(cfg: T, dt: Decimal): void
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
    usePower: false,
    power: new Decimal(1),
  }
}
/**
 * 补齐自动购买配置的缺失/非法字段(读档、以及从全局模板拷贝时用)
 * 与 sanitizeAutoReset 同思路:只修正"形状",不改玩家的开关注
 * @param cfg 原始配置(可能为undefined或结构不全)
 */
export function sanitizeAutoBuy(cfg: unknown, priority: number = 1): AutoBuyConfig {
  const base = defaultAutoBuy(priority)
  if (cfg == null || typeof cfg != 'object') return base
  const c = cfg as Partial<AutoBuyConfig>
  const num = (v: unknown, d: number): number => (typeof v == 'number' && isFinite(v) ? v : d)
  //perItem:只保留布尔值(损坏档里的非布尔项按未勾选处理)
  const perItem: Record<number, boolean> = {}
  if (c.perItem != null && typeof c.perItem == 'object') {
    for (const [k, v] of Object.entries(c.perItem)) if (typeof v == 'boolean') perItem[Number(k)] = v
  }
  return {
    enabled: typeof c.enabled == 'boolean' ? c.enabled : base.enabled,
    priority: num(c.priority, base.priority),
    order: c.order == 'desc' ? 'desc' : base.order,
    percent: num(c.percent, base.percent),
    buyAmount: c.buyAmount == 'max' ? 'max' : base.buyAmount,
    perItem,
  }
}
/**
 * 补齐自动重置配置的缺失/非法字段(读档时用,兼容旧档与损坏档)
 * @param cfg 原始配置(可能为undefined或结构不全)
 */
export function sanitizeAutoReset(cfg: unknown): AutoResetConfig {
  const base = defaultAutoReset()
  if (cfg == null || typeof cfg != 'object') return base
  const c = cfg as Partial<AutoResetConfig>
  const num = (v: unknown, d: number): number => (typeof v == 'number' && isFinite(v) ? v : d)
  const dec = (v: unknown, d: Decimal): Decimal => (v instanceof Decimal && !v.isNan() ? v : d)
  return {
    enabled: typeof c.enabled == 'boolean' ? c.enabled : base.enabled,
    priority: num(c.priority, base.priority),
    combine: c.combine == 'all' ? 'all' : base.combine,
    useTime: typeof c.useTime == 'boolean' ? c.useTime : base.useTime,
    time: num(c.time, base.time),
    usePoint: typeof c.usePoint == 'boolean' ? c.usePoint : base.usePoint,
    point: dec(c.point, base.point),
    useMult: typeof c.useMult == 'boolean' ? c.useMult : base.useMult,
    mult: dec(c.mult, base.mult),
    usePower: typeof c.usePower == 'boolean' ? c.usePower : base.usePower,
    power: dec(c.power, base.power),
  }
}
/**
 * 按配置形状补齐一份自动化配置的缺失字段
 * 读档兜底(save.ts)与"从全局模板拷贝给新层级"(logic/automations)共用同一个入口,
 * 避免两处各写一套形状判定——模板里缺字段时新层级会跟着缺(见自动化的全局配置)
 * @param kind 配置形状:'buy'按自动购买兜底,'reset'按自动重置兜底
 */
export function sanitizeAutoConfig(kind: 'buy' | 'reset', cfg: unknown): AutoConfig {
  return kind == 'buy' ? sanitizeAutoBuy(cfg) : sanitizeAutoReset(cfg)
}
