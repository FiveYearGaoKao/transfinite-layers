//能量加成系统
//每层维度1生产的能量随时间累积,给低层所有维度一个随时间递增加成
//0阶内容的加成来源:nextLayer(pos,0)(同窗口的下一槽位);来源不存在则不生效
//跨层时该来源的能量加成被强化为 value^reward^(gap-1),即指数×reward^(gap-1)(见 compute/crossLayer.ts)
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { getEnergy, getLayer, isChallengeActive, levelGap, prevLayer } from '@/access'
import { nextLayer } from '@/tools/ordinal'
import { ENERGY_BONUS_EXPONENT } from '@/data/constants'
import { defineSlot, registerEffect, slotValue } from './effects'
import { crossLayerExponentBonus } from './crossLayer'

/**能量加成指数槽位(默认0.2;被iu13/iu32/挑战奖励等修饰) */
const SLOT_ENERGY_BASE = defineSlot(
  'energy:base',
  () => new Decimal(ENERGY_BONUS_EXPONENT),
  'global',
)

/**单层能量给低层维度的加成数值:能量指数由 energy:base 槽位决定 */
function energyFactor(energy: Decimal, exponent: Decimal): Decimal {
  //挑战C3激活时能量效果被严重削弱:改为 1+ln(E+1)
  if (isChallengeActive('c3')) return energy.add(1).ln().add(1)
  return energy.add(1).pow(exponent)
}

//将高层的能量加成注册到维度产量管道
//层k的能量 ×(1+E)^base 作用于层k-1的所有维度,base为可被升级/挑战修改的参数
registerEffect({
  id: 'energy',
  name: '能量加成',
  target: 'dimensionMult',
  type: 'mul',
  base: 'energy:base',
  value(ctx, base) {
    const source = nextLayer(ctx.pos, 0)
    const S = getLayer(source)
    if (!S) return Decimal.dOne
    const exponent = crossLayerExponentBonus(base ?? Decimal.dOne, levelGap(source))
    return energyFactor(getEnergy(source), exponent)
  },
})

/**某层能量给其低层所有维度的加成数值(只计本层贡献,含跨层强化) */
export function energyBonus(layer: LayerId): Decimal {
  const exponent = crossLayerExponentBonus(
    slotValue(SLOT_ENERGY_BASE, { pos: prevLayer(layer) }),
    levelGap(layer),
  )
  return energyFactor(getEnergy(layer), exponent)
}
