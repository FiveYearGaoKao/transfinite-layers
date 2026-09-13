//自动化系统
//自动化类型通过注册表(AUTOMATIONS)定义，每个层级的配置相互独立
//解锁知识升级auto-global-config后启用"全局配置"模板:新创建的层级配置按模板填充,并可一键应用到所有层级(见下方"全局配置"节)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayer, forEachLayer, getOrderedLayers, prevLayer, type LayerEntry } from '@/access'
import {
  defaultAutoBuy,
  defaultAutoReset,
  type AutoBuyConfig,
  type AutoConfig,
  type AutomationDef,
  type AutoResetConfig,
  type LayerAutomation,
  type LayerId,
} from '@/data/types'
import { getLayerOrder, layerKey, nextLayer } from '@/tools/ordinal'
import { hasKnowledge, knowledgeAmount } from '@/compute/knowledge'
import { canBuyUpgrade, getUpgrades, hasUpgrade, upgradeCost } from '@/compute/upgrades'
import { canReset, resetGain } from '@/compute/prestige'
import { getBuyables } from '@/compute/buyables'
import { buyBuyable, buyDimension, buyUpgrade } from './purchase'
import { doReset } from './reset'

//------自动化注册表------
/**所有自动化类型 */
export const AUTOMATIONS: AutomationDef[] = [
  {
    id: 'dims',
    name: '维度自动化',
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
    id: 'buyables',
    name: '可购买自动化',
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
    id: 'reset',
    name: '自动重置',
    defaultCfg: () => defaultAutoReset(),
    isUnlocked: (pos) => resetAutoUnlocked(pos),
    isActive: (cfg) => (cfg as AutoResetConfig).enabled,
    setAll: (_pos, cfg, on) => {
      ;(cfg as AutoResetConfig).enabled = on
    },
    onTick: (pos, cfg) => autoReset(pos, cfg as AutoResetConfig),
  },
  {
    id: 'upgrades',
    name: '升级自动化',
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
/**深拷贝自动化配置:perItem记录必须单独复制(防止模板与各层互相串改);Decimal不可变可安全共享 */
function cloneCfg<T extends AutoConfig>(cfg: T): T {
  if ('perItem' in cfg) {
    const buy = cfg as unknown as AutoBuyConfig
    return { ...cfg, perItem: { ...buy.perItem } } as T
  }
  return { ...cfg }
}
/**获取全局自动化配置模板(缺失类型按默认补齐,解锁auto-global-config后才有意义) */
export function getGlobalAutomation(): LayerAutomation {
  if (!player.autoGlobal) player.autoGlobal = { cfgs: {} }
  const g = player.autoGlobal
  if (!g.cfgs) g.cfgs = {}
  for (const def of AUTOMATIONS) {
    if (!g.cfgs[def.id]) g.cfgs[def.id] = def.defaultCfg()
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
    if (old.dims) auto.cfgs['dims'] = old.dims as AutoConfig
    if (old.buyables) auto.cfgs['buyables'] = old.buyables as AutoConfig
    if (old.reset) auto.cfgs['reset'] = old.reset as AutoConfig
    delete old.dims
    delete old.buyables
    delete old.reset
  }
  //为每个注册的自动化补齐配置:解锁全局配置后,新创建的配置以全局模板为准,否则按默认值
  const useGlobal = hasKnowledge('auto-global-config')
  for (const def of AUTOMATIONS) {
    if (!auto.cfgs[def.id]) {
      auto.cfgs[def.id] = useGlobal
        ? cloneCfg(getGlobalAutomation().cfgs[def.id] ?? def.defaultCfg())
        : def.defaultCfg()
    }
  }
  return auto
}

//------解锁判断------
/**某层维度自动购买是否解锁(0阶来源层nextLayer(pos,0)购买u4) */
export function dimsAutoUnlocked(pos: LayerId): boolean {
  const source = nextLayer(pos, 0)
  return getLayer(source) != undefined && hasUpgrade(source, 4)
}
/**某层可购买自动购买是否解锁(0阶来源层nextLayer(pos,0)购买u5) */
export function buyablesAutoUnlocked(pos: LayerId): boolean {
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
export function isAutoItem(
  pos: LayerId,
  type: 'dims' | 'buyables' | 'upgrades',
  id: number,
): boolean {
  return (getLayerAutomation(pos).cfgs[type] as AutoBuyConfig | undefined)?.perItem[id] === true
}
/**切换某层某维度/可购买/升级项的自动开关 */
export function toggleAutoItem(pos: LayerId, type: 'dims' | 'buyables' | 'upgrades', id: number) {
  const cfg = getLayerAutomation(pos).cfgs[type] as AutoBuyConfig
  cfg.perItem[id] = !cfg.perItem[id]
}
/**某层自动重置开关是否开启 */
export function resetAutoEnabled(pos: LayerId): boolean {
  return (getLayerAutomation(pos).cfgs.reset as AutoResetConfig | undefined)?.enabled ?? false
}
/**切换某层自动重置开关 */
export function toggleResetAuto(pos: LayerId) {
  const cfg = getLayerAutomation(pos).cfgs.reset as AutoResetConfig
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
  const auto = player.automations[layerKey(e.pos)]
  if (!auto) return
  const L = e.L
  if (!L.active) return
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
/**自动重置 */
function autoReset(pos: LayerId, cfg: AutoResetConfig) {
  const L = getLayer(pos)
  if (!L) return
  const gain = resetGain(pos)
  const conditions: boolean[] = []
  //重置该层会清空下层(prevLayer)，因此时间条件以prevLayer的重置计时为准
  if (cfg.useTime) {
    const prevL = getLayer(prevLayer(pos))
    if (prevL) conditions.push(prevL.resetTime.gte(cfg.time))
  }
  if (cfg.usePoint) conditions.push(gain.gte(cfg.point))
  if (cfg.useMult) conditions.push(gain.gte(L.points.mul(cfg.mult).max(1)))
  if (conditions.length == 0) return
  const ok = cfg.combine == 'all' ? conditions.every((c) => c) : conditions.some((c) => c)
  if (ok && canReset(pos)) doReset(pos)
}
