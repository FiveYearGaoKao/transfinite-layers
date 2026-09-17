//元层自动化注册表(全局唯一实例的自动化)
//与层级自动化(logic/automations.ts)的差别:配置不按层级存放(存于player.metaAutomations[id]),每个id只跑一次;
//解锁由机制自己判定(成就/知识/里程碑等),因此不一定由里程碑解锁
//每帧由app/core.ts的updateMetaAutomations统一驱动(位置在元层onTick之后、层级自动化之前)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { getLayer, prevLayer } from '@/access'
import {
  defaultAutoReset,
  sanitizeAutoReset,
  type AutoConfig,
  type AutoResetConfig,
  type LayerId,
  type MetaAutomationDef,
} from '@/data/types'
import { canInfinityReset, infinityGain } from '@/compute/infinity'
import { resetGain } from '@/compute/prestige'
import { hasInfinityMilestone } from '@/compute/infinityMilestones'
import { autoResetConditionsMet } from './automations'
import { autoUnlockTempLayer, findUnlockableTempLayer } from './reset'
import { doInfinityReset } from './infinity'

/**自动无限重置的id(无限页的快捷开关也用它) */
export const META_AUTO_INFINITY = 'infinity'
/**自动解锁新层级的id */
export const META_AUTO_UNLOCK = 'unlock'

/**所有元层自动化(数组顺序即每帧执行顺序) */
export const META_AUTOMATIONS: MetaAutomationDef[] = [
  {
    id: META_AUTO_INFINITY,
    name: '自动无限重置',
    configKind: 'reset',
    //无限里程碑im15解锁
    isUnlocked: () => hasInfinityMilestone('im15'),
    defaultCfg: () => defaultAutoReset(),
    sanitizeCfg: (cfg) => sanitizeAutoReset(cfg),
    isActive: (cfg) => (cfg as AutoResetConfig).enabled,
    setAll: (cfg, on) => {
      ;(cfg as AutoResetConfig).enabled = on
    },
    //条件判定与层级自动重置同义:时间=本次无限经历秒数,点数=本次可获得IP,倍率=收益≥当前IP×倍率
    onTick: (cfg) => {
      const c = cfg as AutoResetConfig
      if (!canInfinityReset()) return
      const met = autoResetConditionsMet(c, {
        gain: infinityGain(),
        resource: player.infinityPoints,
        elapsed: player.infinityRunTime,
      })
      if (met) doInfinityReset()
    },
  },
  {
    //排在自动无限重置之后:同一帧内两者都满足时先无限重置(否则自动解锁会把层级0点数清回1,使本次无限重置被跳过)
    id: META_AUTO_UNLOCK,
    name: '自动解锁新层级',
    configKind: 'reset',
    //无限里程碑im10解锁
    isUnlocked: () => hasInfinityMilestone('im10'),
    //临时层点数恒为0,"倍率"条件退化成"收益≥1"(等于恒满足),故不显示该行
    hideMult: true,
    //默认开启并预置点数条件:解锁即可用(等价于"能解锁就解锁"),玩家可再调整或关闭
    defaultCfg: () => ({
      ...defaultAutoReset(),
      enabled: true,
      usePoint: true,
      point: new Decimal(1),
    }),
    //读档兜底同上:强制关闭倍率条件(字段保留,与层级自动重置共用同一套配置形状)
    sanitizeCfg: (cfg) => ({ ...sanitizeAutoReset(cfg), useMult: false }),
    isActive: (cfg) => (cfg as AutoResetConfig).enabled,
    setAll: (cfg, on) => {
      ;(cfg as AutoResetConfig).enabled = on
    },
    onTick: (cfg) => {
      const target = findUnlockableTempLayer()
      if (!target || !unlockConditionsMet(cfg as AutoResetConfig, target)) return
      autoUnlockTempLayer(target)
    },
  },
]

/**某临时层的解锁条件是否满足(点数=本次解锁可得的点数,时间=下层重置计时;倍率对临时层恒成立故不参与) */
function unlockConditionsMet(cfg: AutoResetConfig, tempPos: LayerId): boolean {
  return autoResetConditionsMet(
    { ...cfg, useMult: false },
    {
      gain: resetGain(tempPos),
      resource: getLayer(tempPos)?.points ?? new Decimal(0),
      elapsed: getLayer(prevLayer(tempPos))?.resetTime,
    },
  )
}

/**注册一个元层自动化 */
export function registerMetaAutomation(def: MetaAutomationDef) {
  META_AUTOMATIONS.push(def)
}

/**获取所有已注册的元层自动化 */
export function getMetaAutomations(): MetaAutomationDef[] {
  return META_AUTOMATIONS.slice()
}

/**按id获取元层自动化定义 */
export function getMetaAutomation(id: string): MetaAutomationDef | undefined {
  return META_AUTOMATIONS.find((d) => d.id == id)
}

/**某元层自动化是否已解锁(未定义时返回false) */
export function isMetaAutoUnlocked(id: string): boolean {
  return getMetaAutomation(id)?.isUnlocked() ?? false
}

/**
 * 获取某元层自动化的配置(不存在时按该定义的默认值创建)
 * 泛型参数用于取回具体形状(如getMetaAutoCfg<AutoResetConfig>('infinity'))
 */
export function getMetaAutoCfg<T extends AutoConfig = AutoConfig>(id: string): T {
  if (!player.metaAutomations) player.metaAutomations = {}
  let cfg = player.metaAutomations[id]
  if (!cfg) {
    cfg = getMetaAutomation(id)?.defaultCfg() ?? defaultAutoReset()
    player.metaAutomations[id] = cfg
  }
  return cfg as T
}

/**切换某元层自动化的总开关(未解锁时不生效) */
export function toggleMetaAuto(id: string) {
  const def = getMetaAutomation(id)
  if (!def || !def.isUnlocked()) return
  const cfg = getMetaAutoCfg(id)
  def.setAll(cfg, !def.isActive(cfg))
}

/**读档兜底:按各元层自动化的配置形状补齐player.metaAutomations(未知id按自动重置形状兜底) */
export function sanitizeMetaAutomations(rec: unknown): Record<string, AutoConfig> {
  const res: Record<string, AutoConfig> = {}
  if (rec == null || typeof rec != 'object') return res
  const src = rec as Record<string, unknown>
  for (const id of Object.keys(src)) {
    const def = getMetaAutomation(id)
    res[id] = def ? def.sanitizeCfg(src[id]) : sanitizeAutoReset(src[id])
  }
  return res
}

/**每帧更新所有已解锁且已开启的元层自动化 */
export function updateMetaAutomations(dt: Decimal) {
  for (const def of META_AUTOMATIONS) {
    if (!def.isUnlocked()) continue
    const cfg = getMetaAutoCfg(def.id)
    if (!def.isActive(cfg)) continue
    def.onTick(cfg, dt)
  }
}
