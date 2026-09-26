//数值点声明(统计页据此自动派生加成树)
//新增机制只需在拥有者模块或本文件声明一次,统计页会自动出现对应节点——不需要改 compute/statistics.ts 或 UI
//说明:数值点的读取本身只认字符串id,本文件只提供"展示与公式输入"的元数据,故放在最上层统一声明
import Decimal from 'break_eternity.js'
import { dimensionAmount } from '@/access'
import { isLayer0 } from '@/tools/ordinal'
import { applyTo, defineValuePoint } from './effects'
import { buyableCostBase, getBuyable } from './buyables'
import { dimensionCostBase, productionBase } from './dimensions'
import { resetGainBase } from './prestige'
import './knowledge'
import './infinity'

/**答题冷却的基准值(秒);复用一个常量,避免每次求值都新建 Decimal */
const QUIZ_COOLDOWN_BASE = new Decimal(3600)

//------层级加成(逐维度一棵)------

/**维度产量:公式基准=总量×乘数^指数,再经production管道(含维度生产软上限) */
defineValuePoint({
  id: 'production',
  statRoots: 'dimension',
  label: (ctx) => `维度${ctx.id + 1}产量`,
  base: (ctx) => productionBase(ctx.pos, ctx.id),
  statInputs: (ctx) => [
    { label: '维度总量', value: dimensionAmount(ctx.pos, ctx.id) },
    { label: '维度乘数', sign: 'x', point: 'dimensionMult' },
    { label: '维度指数', sign: '^', point: 'dimensionExponent' },
  ],
})

/**维度价格:当前"下一项"的原始价经dimensionCost管道(价格软上限在这里可见) */
defineValuePoint({
  id: 'dimensionCost',
  statRoots: 'dimension',
  label: (ctx) => `维度${ctx.id + 1}价格`,
  base: (ctx) => dimensionCostBase(ctx.pos, ctx.id),
})

/**可购买价格:当前"下一项"的原始价经buyableCost管道(声明了软上限的可购买才套) */
defineValuePoint({
  id: 'buyableCost',
  statRoots: 'buyable',
  label: (ctx) => `${getBuyable(ctx.id)?.name ?? ctx.id}价格`,
  base: (ctx) => buyableCostBase(ctx.pos, ctx.id),
})

//------层级加成(每层一棵)------

/**点数获取:层0为维度1的产量(已过production管道),其余层为重置收益基础值 */
defineValuePoint({
  id: 'pointsGain',
  statRoots: 'layer',
  sign: '+',
  label: () => '点数获取',
  base: (ctx) =>
    isLayer0(ctx.pos)
      ? applyTo('production', productionBase(ctx.pos, 0), { pos: ctx.pos, id: 0 })
      : resetGainBase(ctx.pos),
})

//------全局加成(与层级无关)------

defineValuePoint({ id: 'psdSpeed', statRoots: 'once', sign: 'x', label: () => '全局速度' })
defineValuePoint({
  id: 'quizCooldown',
  statRoots: 'once',
  label: () => '答题冷却(秒)',
  base: () => QUIZ_COOLDOWN_BASE,
})
defineValuePoint({ id: 'knowledgeGain', statRoots: 'once', sign: 'x', label: () => '知识获取' })
defineValuePoint({ id: 'infinityGain', statRoots: 'once', sign: 'x', label: () => '无限点数获取' })
