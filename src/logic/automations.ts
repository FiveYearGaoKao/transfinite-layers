//自动化系统
//自动化类型通过注册表(AUTOMATIONS)定义，每个层级的配置相互独立
//解锁知识升级auto-global-config后启用"全局配置"模板:新创建的层级配置按模板填充,并可一键应用到所有层级(见下方"全局配置"节)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayer, forEachLayer, getOrderedLayers, prevLayer, type LayerEntry } from '@/access'
import {
  defaultAutoBuy,
  defaultAutoReset,
  sanitizeAutoBuy,
  sanitizeAutoReset,
  type AutoBuyConfig,
  type AutoConfig,
  type AutomationDef,
  type AutoResetConfig,
  type LayerAutomation,
  type LayerId,
} from '@/data/types'
import { getLayerOrder, isLayer0, layerKey, nextLayer } from '@/tools/ordinal'
import { hasKnowledge, knowledgeAmount } from '@/compute/knowledge'
import { canBuyUpgrade, getUpgrades, hasUpgrade, upgradeCost } from '@/compute/upgrades'
import { canReset, resetGain } from '@/compute/prestige'
import { getBuyables } from '@/compute/buyables'
import { hasInfinityMilestone } from '@/compute/infinityMilestones'
import { buyBuyable, buyDimension, buyUpgrade } from './purchase'
import { doReset } from './reset'

//------自动化类型id------
//各来源统一引用这里的常量:注册表、配置读写、UI(层级页的逐项开关等)都不再手写类型字符串
/**维度自动化id */
export const AUTO_DIMS_ID = 'dims'
/**可购买自动化id */
export const AUTO_BUYABLES_ID = 'buyables'
/**升级自动化id */
export const AUTO_UPGRADES_ID = 'upgrades'
/**自动重置id(层级) */
export const AUTO_RESET_ID = 'reset'
/**购买型自动化id(带逐项开关的自动化) */
export type AutoBuyTypeId = typeof AUTO_DIMS_ID | typeof AUTO_BUYABLES_ID | typeof AUTO_UPGRADES_ID

//------自动化注册表------
/**所有自动化类型 */
export const AUTOMATIONS: AutomationDef[] = [
  {
    id: AUTO_DIMS_ID,
    name: '维度自动化',
    configKind: 'buy',
    defaultCfg: () => defaultAutoBuy(),
    isUnlocked: (pos) => dimsAutoUnlocked(pos),
    isActive: (cfg) => Object.values((cfg as AutoBuyConfig).perItem).some((v) => v),
    setAll: (pos, cfg, on) => {
      const count = getLayer(pos)?.dimensions.length ?? 0
      for (let i = 0; i < count; i++) (cfg as AutoBuyConfig).perItem[i] = on
    },
    onTick: (pos, cfg) => autoBuyDims(pos, cfg as AutoBuyConfig),
  },
  {
    id: AUTO_BUYABLES_ID,
    name: '可购买自动化',
    configKind: 'buy',
    defaultCfg: () => defaultAutoBuy(2),
    isUnlocked: (pos) => buyablesAutoUnlocked(pos),
    isActive: (cfg) => Object.values((cfg as AutoBuyConfig).perItem).some((v) => v),
    setAll: (pos, cfg, on) => {
      for (const b of getBuyables(getLayerOrder(pos))) {
        ;(cfg as AutoBuyConfig).perItem[b.id] = on
      }
    },
    onTick: (pos, cfg) => autoBuyBuyables(pos, cfg as AutoBuyConfig),
  },
  {
    id: AUTO_RESET_ID,
    name: '自动重置',
    configKind: 'reset',
    defaultCfg: () => defaultAutoReset(),
    isUnlocked: (pos) => resetAutoUnlocked(pos),
    isActive: (cfg) => (cfg as AutoResetConfig).enabled,
    setAll: (_pos, cfg, on) => {
      ;(cfg as AutoResetConfig).enabled = on
    },
    onTick: (pos, cfg) => autoReset(pos, cfg as AutoResetConfig),
  },
  {
    id: AUTO_UPGRADES_ID,
    name: '升级自动化',
    configKind: 'buy',
    //升级为一次性购买,不支持"买最大"
    supportsBatch: false,
    defaultCfg: () => defaultAutoBuy(4),
    isUnlocked: (pos) => autoUpgradeUnlocked(pos),
    isActive: (cfg) => Object.values((cfg as AutoBuyConfig).perItem).some((v) => v),
    setAll: (pos, cfg, on) => {
      for (const u of getUpgrades(getLayerOrder(pos))) {
        ;(cfg as AutoBuyConfig).perItem[u.id] = on
      }
    },
    onTick: (pos, cfg) => autoBuyUpgrades(pos, cfg as AutoBuyConfig),
  },
]

//------全局配置------
/**
 * 配置形状对应的读档兜底函数(通用:新增自动化类型时在这里加一行即可)
 * 键是自动化id;不在表里的id按"自动购买"形状兜底
 * 拆成参数而不是先造 def 再取值,是为了避免"自动重置的默认值"在自动购买上多算一份
 */
function sanitizeAutoCfg(id: string, cfg: unknown): AutoConfig {
  return id == AUTO_RESET_ID ? sanitizeAutoReset(cfg) : sanitizeAutoBuy(cfg)
}
/**深拷贝自动化配置:perItem记录必须单独复制(防止模板与各层互相串改);Decimal不可变可安全共享 */
function cloneCfg<T extends AutoConfig>(cfg: T): T {
  if ('perItem' in cfg) {
    const buy = cfg as unknown as AutoBuyConfig
    return { ...cfg, perItem: { ...buy.perItem } } as T
  }
  return { ...cfg }
}
/**
 * 获取全局自动化配置模板(缺失类型按默认补齐,解锁auto-global-config后才有意义)
 * 每种类型的**内部字段**也要靠兜底函数补齐:旧档模板里可能没有后加的字段(如"幂次"),
 * 只补"缺失的类型"会让新层级从模板拷到一份缺字段的配置
 */
export function getGlobalAutomation(): LayerAutomation {
  if (!player.autoGlobal) player.autoGlobal = { cfgs: {} }
  const g = player.autoGlobal
  if (!g.cfgs) g.cfgs = {}
  for (const def of AUTOMATIONS) {
    const stored = g.cfgs[def.id]
    if (!stored) {
      g.cfgs[def.id] = def.defaultCfg()
      continue
    }
    //形状完整(键集合一致)就直接用,避免每帧都重建配置对象
    const full = sanitizeAutoCfg(def.id, stored)
    if (Object.keys(stored).length != Object.keys(full).length) g.cfgs[def.id] = full
  }
  return g
}
/**初始化全局配置模板:解锁后首次打开"全局配置"页时,从指定层复制整套配置(仅执行一次) */
export function initGlobalFromLayer(pos: LayerId) {
  if (!hasKnowledge('auto-global-config')) return
  if (player.autoGlobalInit) return
  const src = getLayerAutomation(pos)
  const g = getGlobalAutomation()
  for (const def of AUTOMATIONS) {
    g.cfgs[def.id] = cloneCfg(src.cfgs[def.id] ?? def.defaultCfg())
  }
  player.autoGlobalInit = true
}
/**将全局配置模板的某类型应用到所有(真实)层级 */
export function applyGlobalAuto(typeId: string) {
  if (!hasKnowledge('auto-global-config')) return
  const tpl = getGlobalAutomation().cfgs[typeId]
  if (!tpl) return
  forEachLayer('asc', (e) => {
    getLayerAutomation(e.pos).cfgs[typeId] = cloneCfg(tpl)
  })
}
/**将全局配置模板的全部类型应用到所有(真实)层级 */
export function applyAllGlobalAuto() {
  for (const def of AUTOMATIONS) applyGlobalAuto(def.id)
}

//------配置访问------
/**获取某层的自动化配置，不存在或结构缺失则创建默认 */
export function getLayerAutomation(pos: LayerId): LayerAutomation {
  const key = layerKey(pos)
  if (!player.automations) player.automations = {}
  let auto = player.automations[key]
  if (!auto) {
    auto = { cfgs: {} }
    player.automations[key] = auto
  }
  //旧结构(dims/buyables/reset直接字段)迁移到cfgs
  if (!auto.cfgs) {
    const old = auto as unknown as Record<string, unknown>
    auto.cfgs = {}
    if (old.dims) auto.cfgs[AUTO_DIMS_ID] = old.dims as AutoConfig
    if (old.buyables) auto.cfgs[AUTO_BUYABLES_ID] = old.buyables as AutoConfig
    if (old.reset) auto.cfgs[AUTO_RESET_ID] = old.reset as AutoConfig
    delete old.dims
    delete old.buyables
    delete old.reset
  }
  //为每个注册的自动化补齐配置:解锁全局配置后,新创建的配置以全局模板为准,否则按默认值
  //全局模板那条路径要过兜底函数:模板里可能缺后加的字段(如"幂次"),否则新层级会拷到缺字段的配置
  const useGlobal = hasKnowledge('auto-global-config')
  for (const def of AUTOMATIONS) {
    if (!auto.cfgs[def.id]) {
      const src = useGlobal ? getGlobalAutomation().cfgs[def.id] : undefined
      const full = src ? sanitizeAutoCfg(def.id, src) : def.defaultCfg()
      auto.cfgs[def.id] = cloneCfg(full)
    }
  }
  return auto
}

/**
 * 无限重置时的自动化配置处理:清空各层配置(无限重置是"一切从头开始"),
 * 但拥有无限里程碑im6时保留层级0那一份(该里程碑让层级0的自动化跨无限重置存续)
 */
export function resetAutomationsForInfinityReset() {
  const layer0Key = layerKey([0])
  if (!player.automations) player.automations = {}
  const keep = hasInfinityMilestone('im6') ? player.automations[layer0Key] : undefined
  player.automations = {}
  if (keep) player.automations[layer0Key] = keep
}

//------解锁判断------
/**某层维度自动购买是否解锁(0阶来源层nextLayer(pos,0)购买u4;无限里程碑im6让层级0不再依赖它) */
export function dimsAutoUnlocked(pos: LayerId): boolean {
  if (isLayer0(pos) && hasInfinityMilestone('im6')) return true
  const source = nextLayer(pos, 0)
  return getLayer(source) != undefined && hasUpgrade(source, 4)
}
/**某层可购买自动购买是否解锁(0阶来源层nextLayer(pos,0)购买u5;无限里程碑im6让层级0不再依赖它) */
export function buyablesAutoUnlocked(pos: LayerId): boolean {
  if (isLayer0(pos) && hasInfinityMilestone('im6')) return true
  const source = nextLayer(pos, 0)
  return getLayer(source) != undefined && hasUpgrade(source, 5)
}
/**某层自动重置是否解锁(本层购买u6) */
export function resetAutoUnlocked(pos: LayerId): boolean {
  return hasUpgrade(pos, 6)
}
/**某层升级自动化是否解锁(知识升级auto-upgrade,层级0也有u2/u3故不做isLayer0限制) */
export function autoUpgradeUnlocked(pos: LayerId): boolean {
  return hasKnowledge('auto-upgrade') && getUpgrades(getLayerOrder(pos)).length > 0
}

//------开关操作------
/**某层某维度/可购买/升级项是否自动 */
export function isAutoItem(pos: LayerId, type: AutoBuyTypeId, id: number): boolean {
  return (getLayerAutomation(pos).cfgs[type] as AutoBuyConfig | undefined)?.perItem[id] === true
}
/**切换某层某维度/可购买/升级项的自动开关 */
export function toggleAutoItem(pos: LayerId, type: AutoBuyTypeId, id: number) {
  const cfg = getLayerAutomation(pos).cfgs[type] as AutoBuyConfig
  cfg.perItem[id] = !cfg.perItem[id]
}
/**某层自动重置开关是否开启 */
export function resetAutoEnabled(pos: LayerId): boolean {
  const cfg = getLayerAutomation(pos).cfgs[AUTO_RESET_ID] as AutoResetConfig | undefined
  return cfg?.enabled ?? false
}
/**切换某层自动重置开关 */
export function toggleResetAuto(pos: LayerId) {
  const cfg = getLayerAutomation(pos).cfgs[AUTO_RESET_ID] as AutoResetConfig
  cfg.enabled = !cfg.enabled
}
/**某层是否有自动化处于激活状态 */
export function isLayerAutoActive(pos: LayerId): boolean {
  const auto = player.automations[layerKey(pos)]
  if (!auto) return false
  return AUTOMATIONS.some((def) => {
    const cfg = auto.cfgs[def.id]
    return cfg ? def.isActive(cfg) : false
  })
}
/**全部层级是否有自动化处于激活状态 */
export function isAllAutoActive(): boolean {
  return getOrderedLayers('asc').some((e) => isLayerAutoActive(e.pos))
}
/**本层全部自动化一键开关(至少一个开→全关，全关→全开) */
export function toggleLayerAuto(pos: LayerId) {
  const auto = getLayerAutomation(pos)
  const anyOn = AUTOMATIONS.some((def) => {
    const cfg = auto.cfgs[def.id]
    return cfg ? def.isActive(cfg) : false
  })
  for (const def of AUTOMATIONS) {
    const cfg = auto.cfgs[def.id]
    if (cfg) def.setAll(pos, cfg, !anyOn)
  }
}
/**全部层级自动化一键开关 */
export function toggleAllAuto() {
  const anyOn = isAllAutoActive()
  forEachLayer('asc', (e) => {
    const auto = getLayerAutomation(e.pos)
    for (const def of AUTOMATIONS) {
      const cfg = auto.cfgs[def.id]
      if (cfg) def.setAll(e.pos, cfg, !anyOn)
    }
  })
}

//------执行逻辑------
/**
 * 更新自动化系统，dt以秒为单位
 * 顺序:从低到高(第0层先处理),且每层的收益/条件在轮到它时才计算(不做快照),
 * 这样一帧之内可以连续向上晋升多层(单趟正序即可,无需多趟)
 */
export function updateAutomations(_dt: Decimal) {
  forEachLayer('asc', updateLayerAutomation)
}
/**更新单个层级的自动化 */
function updateLayerAutomation(e: LayerEntry) {
  const L = e.L
  if (!L.active) return
  //配置缺失时按全局模板(无模板则默认)补齐:自动化不再依赖"玩家打开过该层页面"
  const auto = getLayerAutomation(e.pos)
  //收集已开启且已解锁的项，按优先级排序
  const items = AUTOMATIONS.filter((def) => {
    if (!def.isUnlocked(e.pos)) return false
    const cfg = auto.cfgs[def.id]
    if (!cfg) return false
    return def.isActive(cfg)
  }).sort((a, b) => (auto.cfgs[a.id]?.priority ?? 0) - (auto.cfgs[b.id]?.priority ?? 0))
  for (const def of items) {
    const cfg = auto.cfgs[def.id]
    if (cfg) def.onTick(e.pos, cfg)
  }
}
/**实际购买数量模式:"买最大"需解锁知识升级auto-batch */
function effectiveBuyAmount(cfg: AutoBuyConfig): 'one' | 'max' {
  return cfg.buyAmount == 'max' && hasKnowledge('auto-batch') ? 'max' : 'one'
}
/**自动批量:每帧至多购买2^等级个 */
function batchAmount(): Decimal {
  return new Decimal(2).pow(knowledgeAmount('auto-batch'))
}

/**自动购买维度 */
function autoBuyDims(pos: LayerId, cfg: AutoBuyConfig) {
  const L = getLayer(pos)
  if (!L) return
  if (L.points.lt(1)) return
  let remaining = L.points.mul(cfg.percent).div(100).max(1)
  const ids: number[] = []
  for (let i = 0; i < L.dimensions.length; i++) {
    if (cfg.perItem[i] === true) ids.push(i)
  }
  if (cfg.order == 'desc') ids.reverse()
  for (const id of ids) {
    if (remaining.lt(1)) break
    const amount = effectiveBuyAmount(cfg) == 'max' ? batchAmount() : new Decimal(1)
    const spent = buyDimension(pos, id, amount, remaining)
    //买不起时继续尝试下一个(价格可能不同)
    remaining = remaining.sub(spent)
  }
}
/**自动购买可购买 */
function autoBuyBuyables(pos: LayerId, cfg: AutoBuyConfig) {
  const L = getLayer(pos)
  if (!L) return
  if (L.points.lt(1)) return
  let remaining = L.points.mul(cfg.percent).div(100).max(1)
  const ids = getBuyables(getLayerOrder(pos))
    .filter((b) => cfg.perItem[b.id] === true)
    .map((b) => b.id)
  if (cfg.order == 'desc') ids.reverse()
  for (const id of ids) {
    if (remaining.lt(1)) break
    const amount = effectiveBuyAmount(cfg) == 'max' ? batchAmount() : new Decimal(1)
    const spent = buyBuyable(pos, id, amount, remaining)
    //买不起时继续尝试下一个(价格可能不同)
    remaining = remaining.sub(spent)
  }
}
/**自动购买升级(一次性,已购自动跳过) */
function autoBuyUpgrades(pos: LayerId, cfg: AutoBuyConfig) {
  const L = getLayer(pos)
  if (!L) return
  if (L.points.lt(1)) return
  let remaining = L.points.mul(cfg.percent).div(100).max(1)
  const ids = getUpgrades(getLayerOrder(pos))
    .filter((u) => cfg.perItem[u.id] === true && !hasUpgrade(pos, u.id))
    .map((u) => u.id)
  if (cfg.order == 'desc') ids.reverse()
  for (const id of ids) {
    if (remaining.lt(1)) break
    if (!canBuyUpgrade(pos, id)) continue
    const cost = upgradeCost(pos, id)
    if (cost.gt(remaining)) continue
    buyUpgrade(pos, id)
    remaining = remaining.sub(cost)
  }
}
/**
 * 自动重置(含自动无限重置)的条件判定:把配置里的时间/点数/倍率/幂次条件按combine合并
 * @param cfg 自动重置配置
 * @param values gain为本次重置收益,resource为当前资源量,elapsed为"时间"条件的计时
 * 说明:elapsed缺省时不参与判定(与层级自动重置一致,取不到下层计时就只看收益条件)
 * @returns 是否满足触发条件(未启用任何条件时恒为false)
 */
export function autoResetConditionsMet(
  cfg: AutoResetConfig,
  values: { gain: Decimal; resource: Decimal; elapsed?: Decimal },
): boolean {
  //四个条件各自独立,按combine合并:
  //- 倍率:收益 ≥ 点数×倍率
  //- 幂次:收益 ≥ 点数^幂次(幂次只在有限且>0时参与,避免NaN/∞或≤0把条件锁死/恒真)
  const conditions: boolean[] = []
  if (cfg.useTime && values.elapsed) conditions.push(values.elapsed.gte(cfg.time))
  if (cfg.usePoint) conditions.push(values.gain.gte(cfg.point))
  if (cfg.useMult) conditions.push(values.gain.gte(values.resource.mul(cfg.mult).max(1)))
  if (cfg.usePower && cfg.power.isFinite() && cfg.power.gt(0))
    conditions.push(values.gain.gte(values.resource.pow(cfg.power)))
  if (conditions.length == 0) return false
  return cfg.combine == 'all' ? conditions.every((c) => c) : conditions.some((c) => c)
}

/**自动重置 */
function autoReset(pos: LayerId, cfg: AutoResetConfig) {
  const L = getLayer(pos)
  if (!L) return
  //重置该层会清空下层(prevLayer)，因此时间条件以prevLayer的重置计时为准
  const prevL = getLayer(prevLayer(pos))
  const met = autoResetConditionsMet(cfg, {
    gain: resetGain(pos),
    resource: L.points,
    elapsed: prevL?.resetTime,
  })
  if (met && canReset(pos)) doReset(pos)
}
