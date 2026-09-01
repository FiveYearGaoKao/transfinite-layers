//能量加成系统
//每层维度1生产的能量随时间累积,给低层所有维度一个随时间递增加成
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { getEnergy, higherLayer, isChallengeActive, prevLayer } from '@/access'
import { ENERGY_BONUS_EXPONENT } from '@/data/constants'
import { effectValueById, registerEffect } from './effects'

//将高层的能量加成注册到维度产量管道
//层k的能量 ×(1+E)^base 作用于层k-1的所有维度,base为可被升级/挑战修改的参数
//挑战C3激活时能量效果被严重削弱:改为 1+ln(E+1)
registerEffect({
  id: 'energy',
  name: '能量加成',
  target: 'dimensionMult',
  type: 'mul',
  base: { target: 'energy:base', init: () => ENERGY_BONUS_EXPONENT },
  value(ctx, base) {
    const higher = higherLayer(ctx.pos)
    if (!higher) return 1
    const E = getEnergy(higher)
    if (isChallengeActive('c3')) return E.add(1).ln().add(1)
    return E.add(1).pow(base ?? new Decimal(1))
  },
})

// registerEffect({
//   id: 'energy-softcap',
//   name: '能量指数软上限',
//   target: 'energy:base',
//   type: 'mul',
//   value(ctx) {
//     const higher = higherLayer(ctx.pos)
//     if (!higher) return 1
//     return getEnergy(higher).log10().log10().sub(1).recip()
//   },
//   isActive(ctx) {
//     const higher = higherLayer(ctx.pos)
//     if (!higher) return false
//     return getEnergy(higher).gte(1e100)
//   },
// })

/**某层能量给其低层所有维度的加成数值 */
export function energyBonus(layer: LayerId): Decimal {
  return effectValueById('energy', { pos: prevLayer(layer), id: 0 })
}
