//重置收益的计算(只读)
//门槛与收益指数随跨层间距gap变化(见 compute/crossLayer.ts):
//  门槛 = K^k   收益指数 = E/k   其中 k = penalty^(gap-1)
//含义:原来的重置需求是 x,现在要 x^k 才能换到同样多的本层点数;
//      等价于"先把下层点数开 k 次方,再套用原公式"(两者代数上完全相同)
//gap=1(同窗口相邻层)时 k=1,精确退化为"无跨层"的原公式
import Decimal from 'break_eternity.js'
import type { LayerId } from '@/data/types'
import { getPoints, levelGap, prevLayer } from '@/access'
import { getLayerOrder, isLayer0 } from '@/tools/ordinal'
import {
  PRESTIGE_EXPONENT,
  PRESTIGE_EXPONENT_LAYER0,
  PRESTIGE_THRESHOLD,
  PRESTIGE_THRESHOLD_LAYER0,
} from '@/data/constants'
import { calculate } from './effects'
import { crossLayerExponent, crossLayerThreshold } from './crossLayer'

interface prestigeFormula {
  resetGain(layer: LayerId): Decimal
}

/**不同阶的重置公式 */
export const PRESTIGE: prestigeFormula[] = [
  {
    resetGain(layer: LayerId): Decimal {
      if (isLayer0(layer)) return new Decimal(0)
      const prestigeResource = getPoints(prevLayer(layer))
      const gain = prestigeResource
        .div(resetThreshold(layer))
        .pow(resetExponent(layer))
      return gain.gte(1) ? gain : new Decimal(0)
    },
  },
]

/**某层重置的下层门槛基准值(gap=1时的门槛,供展示与统计) */
export function resetThresholdBase(layer: LayerId): Decimal {
  return new Decimal(isLayer0(prevLayer(layer)) ? PRESTIGE_THRESHOLD_LAYER0 : PRESTIGE_THRESHOLD)
}
/**某层重置的收益指数基准值(gap=1时的指数) */
export function resetExponentBase(layer: LayerId): Decimal {
  return new Decimal(isLayer0(prevLayer(layer)) ? PRESTIGE_EXPONENT_LAYER0 : PRESTIGE_EXPONENT)
}
/**某层重置的实际门槛(含跨层间距影响) */
export function resetThreshold(layer: LayerId): Decimal {
  return crossLayerThreshold(resetThresholdBase(layer), levelGap(layer))
}
/**某层重置的实际收益指数(含跨层间距影响) */
export function resetExponent(layer: LayerId): Decimal {
  return crossLayerExponent(resetExponentBase(layer), levelGap(layer))
}
/**重置收益的基础公式值(不含点数获取加成),统计页"点数获取"树的初始值用 */
export function resetGainBase(layer: LayerId): Decimal {
  //按阶精确取公式行:阶未定义时不静默兜底(见层级系统.md"注册表缺失即拒绝解锁")
  const formula = PRESTIGE[getLayerOrder(layer)]
  return formula ? formula.resetGain(layer) : new Decimal(0)
}
/**重置资源的获取量 */
export function resetGain(layer: LayerId): Decimal {
  let value = resetGainBase(layer)
  //非层级0的层的重置收益即点数获取，应用点数获取类的加成
  if (!isLayer0(layer)) value = calculate('pointsGain', { pos: layer, id: 0 }, value)
  return value.floor()
}
/**判断层级能否重置 */
export function canReset(layer: LayerId): boolean {
  return resetGain(layer).gt(0) && !isLayer0(layer)
}
