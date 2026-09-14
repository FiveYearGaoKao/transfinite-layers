//无限里程碑(Infinity Milestones)的配置与只读访问
//解锁条件:无限重置次数(player.infinityResets)达到里程碑阈值,只增不减,故解锁态无需存档字段
//纯解锁型里程碑不填effect(如批量完成挑战/自动无限重置);数值型里程碑经effects管道注册,卡片数值自动派生
import Decimal, { type DecimalSource } from 'break_eternity.js'
import { player } from '@/data/player'
import { INFINITY_PASSIVE_RATE } from '@/data/constants'
import { format } from '@/tools/format'
import { effectText, registerEffect, type EffectDef, type RegisteredEffect } from './effects'

/**无限里程碑的配置 */
export interface InfinityMilestoneDef {
  /**id,格式'im'+阈值(如'im1'、'im100') */
  id: string
  /**解锁所需的无限重置次数 */
  resets: DecimalSource
  /**卡片第一行(标题,即解锁条件) */
  name: string
  /**卡片第二行(效果描述) */
  description: string
  /**数值效果(声明式,可省略;纯逻辑/解锁型里程碑不填) */
  effect?: EffectDef
  /**效果数值的文字(卡片第三行;缺省从effect自动生成,无effect时显示"已解锁/未解锁") */
  effectText?(): string
}

/**所有已定义的无限里程碑(按解锁阈值升序) */
export const INFINITY_MILESTONES: InfinityMilestoneDef[] = [
  {
    id: 'im1',
    resets: 1,
    name: '1 次无限重置',
    description: '基于无限重置次数提升所有维度乘数',
    effect: {
      target: 'dimensionMult',
      type: 'mul',
      value: () => player.infinityResets.add(1),
      text: '所有维度乘数 x{value}',
    },
  },
  {
    id: 'im2',
    resets: 2,
    name: '2 次无限重置',
    description: '退出挑战时将结算尽可能多的完成次数',
  },
  {
    id: 'im3',
    resets: 3,
    name: '3 次无限重置',
    description: '进入/退出挑战不再强制清空下层升级',
  },
  {
    id: 'im5',
    resets: 5,
    name: '5 次无限重置',
    description: '基于无限重置次数加成无限点数获取',
    effect: {
      target: 'infinityGain',
      type: 'mul',
      value: () => player.infinityResets.mul(0.1).add(1).sqrt(),
      text: '无限点数获取 x{value}',
    },
  },
  {
    id: 'im8',
    resets: 8,
    name: '8 次无限重置',
    description: '无限重置后已完成的挑战保留1次完成次数',
  },
  {
    id: 'im10',
    resets: 10,
    name: '10 次无限重置',
    description: '解锁自动无限重置(配置在自动化页的"无限"子标签)',
  },
  {
    id: 'im100',
    resets: 100,
    name: '100 次无限重置',
    description: `每秒被动获得无限点数,效果为最佳无限点数/秒的${INFINITY_PASSIVE_RATE * 100}%`,
    effectText() {
      return `每秒 +${format(infinityPassiveRate())} 无限点数`
    },
  },
]

/**获取某无限里程碑的定义 */
export function getInfinityMilestone(id: string): InfinityMilestoneDef | undefined {
  return INFINITY_MILESTONES.find((m) => m.id == id)
}

/**获取所有已定义的无限里程碑 */
export function getInfinityMilestones(): InfinityMilestoneDef[] {
  return INFINITY_MILESTONES.slice()
}

/**某无限里程碑是否已解锁(无限重置次数达到其阈值) */
export function isInfinityMilestoneUnlocked(def: InfinityMilestoneDef): boolean {
  return player.infinityResets.gte(def.resets)
}

/**按id判断某无限里程碑是否已解锁(未定义时返回false) */
export function hasInfinityMilestone(id: string): boolean {
  const def = getInfinityMilestone(id)
  return def ? isInfinityMilestoneUnlocked(def) : false
}

/**被动无限点数速率(每秒):最佳无限点数/秒的INFINITY_PASSIVE_RATE倍(无限里程碑im100) */
export function infinityPassiveRate(): Decimal {
  return player.infinityBestRate.mul(INFINITY_PASSIVE_RATE)
}

//------效果注册------
/**把无限里程碑定义转换为注册效果(解锁后生效) */
function infinityMilestoneEffect(m: InfinityMilestoneDef): RegisteredEffect | undefined {
  if (!m.effect) return undefined
  return {
    ...m.effect,
    id: `im-${m.id}`,
    name: `无限里程碑-${m.name}`,
    isActive: () => hasInfinityMilestone(m.id),
  }
}

//自动注册各无限里程碑的数值效果
for (const m of INFINITY_MILESTONES) {
  const e = infinityMilestoneEffect(m)
  if (e) registerEffect(e)
}

/**某无限里程碑的效果数值文字(卡片第三行;裸值,不含前缀) */
export function infinityMilestoneEffectValue(def: InfinityMilestoneDef): string {
  if (def.effectText) return def.effectText()
  const e = infinityMilestoneEffect(def)
  if (e) return effectText(e, { pos: [0], id: 0 })
  return hasInfinityMilestone(def.id) ? '已解锁' : '未解锁'
}
