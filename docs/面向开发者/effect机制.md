# 加成管道(Effects)机制说明

> 面向开发者。加成管道是游戏所有数值的"中枢":任何加成都必须经管道注册,计算/统计/描述自动派生。

## 一、为什么需要管道

游戏里有大量数值加成来源:升级、可购买、成就、知识升级、挑战惩罚/奖励、能量系统、全局速度等。
如果每个来源都自己往核心公式里塞倍数,公式会迅速失控、互相覆盖、统计无门。

管道的做法:**把每个加成声明成一条"效果",挂到某个"数值点(target)"上,核心公式只负责读取汇总结果。**

## 二、基本概念

### 数值点(target)
一个可以"被加成"的数值的标识。核心公式用 `calculate('target', ctx, base)` 读取最终值。
已定义的数值点(见 `compute/effects.ts`):

| target | 含义 | 被谁读取 |
|---|---|---|
| `dimensionCost` | 维度价格 | `dimensions.dimensionCostAt` |
| `dimensionMult` | 维度乘数 | `dimensions.dimensionMultiplier` |
| `dimensionExponent` | 维度指数 | `dimensions.dimensionExponent` |
| `production` | 维度产量 | `dimensions.productionPerSecond` |
| `pointsGain` | 点数获取(含层0软上限) | `dimensions`(层0维度1产量)/`prestige`(重置收益) |
| `upgradeCost` | 升级价格 | (预留) |
| `psdSpeed` | 全局速度 | `knowledge.getPsdSpeed` |
| `infinityGain` | 无限点数获取 | `infinity.infinityGain`(基础公式经管道后向下取整) |

> 注:`resetGain` 目标已移除,所有加成只作用于 `pointsGain`。层级0维度1的产量软上限(`layer0-softcap`)注册为 `pointsGain` 上的 `custom` 效果——`custom` 优先级最高,天然在所有乘法加成之后生效。

除主数值点外,还有**子目标(槽位)**用于修饰公式参数:
`energy:base`(能量指数)、`u1:base`(点数作用指数)、`b11:base`/`b11:amount`(加速器底数/等级)、
`b12:quad`/`b12:base`/`b12:amount`(加倍器)、`softCap:base`(软上限阈值)、`softCap:power`(软上限对数幂次,默认2,iu52 削弱为 power^(0.99^挑战总数))、
`b12:costBase`(加倍器基础价格指数,默认2,iu22 降为0)、`b13:costMult`(加速器加成价格指数,默认4,iu42 降为3)、
`a41:decay`(成就"逆流而上"的衰减速度,默认1,iu21 降为0.1)、
`iu33:base`(无限升级IU33的维度乘数指数,默认0.3,iu43 提升)。

### 效果(Effect)
一条加成的声明,注册时自动补充 `id`/`name`。

```ts
interface EffectDef {
  target: string        // 主目标或子目标(如 'b11:base')
  type: 'add'|'mul'|'exp'|'custom'
  value?(ctx, base?, amount?, current?)  // 加成数值
  base?: EffectSlot     // 可调参数槽位(底数/指数/等级)
  amount?: EffectSlot   // 等级槽位(仅维度/可购买)
  text?: string         // 描述模板
  order?: number        // 覆盖默认优先级
  isActive?(ctx): boolean // 生效条件
}
```

- `type` 语义:`add`→值+value、`mul`→值×value、`exp`→值^value、`custom`→替换为 value。
- `value` 缺省时自动生成:`mul→base^amount`、`add→base×amount`(需声明 base+amount 槽位)。
- `EffectContext = { pos: LayerId, id: number }`:当前作用的位置与编号(维度 id / 可购买 id)。

### 槽位(Slot)
效果公式里可被其他效果"进一步修饰"的参数。组合后参与主效果计算,并可被统计页展开查看构成。

```ts
interface EffectSlot {
  target: string        // 子目标标识,其他效果可对其实施修饰
  init(ctx): DecimalSource // 初始值
}
```

## 三、两阶段管道

1. **组合槽位**:对每个效果的 `base`/`amount` 槽位,从 `init` 初始值开始,依序应用所有注册到该子目标的效果 → 得到槽位组合值 `slotValue`。
2. **合并主效果**:对该 `target` 上的所有效果,从基准值开始,按优先级依序 `applyEffect`。

**优先级**:`add → mul → exp → custom`(`order` 可覆盖)。

## 四、注册与查询

- **注册**:`registerEffect(e)` 把 `RegisteredEffect` 按 target 分组并缓存;`id` 全局唯一(重复即抛错)。
- **查询**:
  - `calculate(target, ctx, base)` — 最终值;
  - `effectById(id)` / `effectValueById(id, ctx)` — 按 id 引用某条加成的当前数值(未注册返回 1),如能量系统内部即 `effectValueById('energy', ...)`;
  - `effectBreakdown(target, ctx, base)` / `slotBreakdown(slot, ctx)` — 统计明细(总效果+各生效来源),供统计页;
  - `effectText(e, ctx)` / `renderText(template, e, ctx)` — 描述模板(`{value}{base}{basePercent}{amount}`)。

### 统计页的加成树

- 构建逻辑在 `compute/statistics.ts`(只读),渲染组件为 `components/features/statTree.vue`(props: nodes, 内部管理展开)。
- **层级加成**:每维度一棵"产量树"——根为 `productionPerSecond`,子节点依次为`初始值(维度总数)`→`维度乘数`→`维度指数`→`最终加成`(各 production 效果,用效果名);另有一棵统一的**"点数获取"树**(`+` 开头):初始值(层0=维度1原始产量、层1+=`resetGainBase`)+ 各 pointsGain 效果 + 软上限实际缩减比例。
- **全局加成**:`psdSpeed`、`quizCooldown`;初始值非 1 的目标统一显示"初始值"子节点(如答题冷却 3600)。

## 五、自动注册(注册表模式)

升级/可购买/成就/知识升级的定义数组里直接写 `effect` 字段,模块加载时循环注册:

```ts
// compute/upgrades.ts
for (const u of UPGRADES) {
  const e = upgradeEffect(u)  // 自动补 id(`upgrade-${u.id}`)/name/isActive
  if (e) registerEffect(e)
}
```

各系统自动注册时的 id 前缀:
| 来源 | id 前缀 | 生效条件 |
|---|---|---|
| 升级 | `upgrade-{id}` | 本层已购买(可自定义,如 u1 作用于上层) |
| 可购买 | `buyable-{id}` | 始终(等级槽位含免费等级) |
| 成就 | `achievement-{id}` | 已解锁 |
| 知识升级 | `knowledge-{id}` | 已购买至少1次 |
| 挑战惩罚/奖励 | `challenge-{id}-penalty-{n}` / `-reward-{n}` | 激活中 / 完成次数>0 |
| 无限升级 | `iu-{id}` | 已购买(可叠加自定义条件,如 iu32 仅挑战中、iu51 仅层级0) |

## 六、效果禁用与挑战

`registerEffectDisabler(effectId, fn)` 注册禁用器:fn 返回 true 时该效果被跳过。
挑战 c1/c2 用它禁用 b11/b12(`buyable-11`/`buyable-12`)。
`effectValue`/`applyEffect`/`activeEffects` 均跳过被禁用效果(统计页也不显示)。

## 七、新增系统的正确姿势

1. 在 `EffectTarget` 或新增字符串 target 上定义数值点;
2. 定义数组里写 `effect` 字段(或直接 `registerEffect`);
3. 核心公式里用 `calculate('target', ctx, base)` 读取,不要手写任何加成;
4. 统计页如需展示,在 `options.vue` 的 `statDefs` 里加一行即可。

**铁律:任何数值加成都必须经管道注册,禁止把加成烘焙进核心公式。**
