# 加成管道(Effects)机制说明

> 面向开发者。加成管道是游戏所有数值的"中枢":任何加成都必须经管道注册,计算/统计/描述自动派生。
> 本文是**契约文档**:文中标注"必须/禁止"的条目在开发构建里都有对应的自检或断言,违反即报错或报警告。

## 一、为什么需要管道

游戏里有大量数值加成来源:升级、可购买、成就、知识升级、挑战惩罚/奖励、能量系统、全局速度等。
如果每个来源都自己往核心公式里塞倍数,公式会迅速失控、互相覆盖、统计无门。

管道的做法:**把每个加成声明成一条"效果",挂到某个"数值点"上,核心公式只负责读取汇总结果。**

## 二、基本概念

### 数值点(ValuePoint)

一个可以"被加成"的数值的标识。**数值点的 `id` 就是它的修饰目标**,一一对应;不存在"两个数值共用一个 target"的写法
(需要联动时用效果的 `targets: [...]`,见 §六)。

按初始值来源分两类:

| 类型 | 初始值 | 例子 |
| ---- | ------ | ---- |
| 声明型(槽位) | 在数值点注册处声明(`init`) | `b12:base`、`energy:base`、`priceCap:power`、`crossLayer:reward` |
| 调用型(主数值点) | 由核心公式在读取时传入(`base` 参数) | `dimensionCost`、`production`、`pointsGain`、`infinityGain` |

读取 API:

- 声明型:`slotValue('b12:base', ctx?)`
- 调用型:`applyTo('pointsGain', base, ctx?)`

两者走**同一条管道**,只是初始值来源不同。

已定义的数值点见 §十一。

### 效果(Effect)

一条加成的声明,注册时自动补充 `id`/`name`。

```ts
interface EffectDef {
  target: string | string[] // 数值点id(数组形式见§六"联动")
  type: 'add' | 'mul' | 'exp' | 'custom' | 'cap'
  value?(ctx, base?, amount?, current?): Decimal // 加成数值
  base?: EffectSlot | string // 可调参数槽位(底数/指数/等级)
  amount?: EffectSlot | string // 等级槽位(仅维度/可购买)
  threshold?: EffectSlot | string // 仅cap:软上限阈值
  power?: EffectSlot | string // 仅cap:软上限幂次
  height?: number // 仅cap:软上限高度(常量)
  text?: string // 描述模板
  order?: number // 覆盖默认优先级
  isActive?(ctx): boolean // 生效条件
}
```

- `type` 语义:`add`→值+value、`mul`→值×value、`exp`→值^value、`custom`→替换为value、`cap`→对值套软上限(见§五)。
- `value` 缺省时自动生成:`mul→base^amount`、`add→base×amount`(需声明 base+amount 槽位)。
- **所有数值回调一律返回 `Decimal`**(不接受 `DecimalSource`);参数侧仍可用 `DecimalSource` 字面量,即"输入宽松、输出严格"。
  这条是为了省掉读取路径上每次求值的 `new Decimal(...)` 归一化(生产链路每帧数百次)。

### 上下文(EffectContext)

```ts
type EffectContextInput = LayerId | { pos?: LayerId; id?: number }
```

**所有公开 API 的 `ctx` 都可以省略**,缺省补 `pos=[0], id=0`;也可以只给层级(直接传 `LayerId`)。
读取路径内部只解析一次上下文(`resolveCtx`),禁止在调用点手写 `{ pos: [0], id: 0 }`。

### 槽位(Slot)

效果公式里可被其他效果"进一步修饰"的参数,通过 `defineSlot` **具名注册**,模块级唯一。

```ts
const SLOT_B12_BASE = defineSlot('b12:base', () => new Decimal(2))
```

**约定**:

- 槽位必须模块级注册且 **id 全局唯一**;重复 id 在注册时抛错。
- 槽位按 **id**(而不是对象身份、也不是别的键)做帧内缓存,因此调用点**禁止**临时构造槽位对象。
- `scope:'global'` 的槽位(初始值不依赖层级)缓存键只有 id,命中率更高;声明为 global 的槽位由开发构建用两个不同 ctx 求值校验,依赖 ctx 就报错。缺省 `scope:'layer'`(安全)。
- 同一个语义只有一个 id:**不同语义即使数学形式相同也必须分开注册**(曾经的 `softCap:power` 被价格与维度生产软上限共用,导致 iu52 误伤后者,已拆成 `priceCap:power` / `dimCap:power`)。

## 三、两阶段管道

1. **组合槽位**:对每个效果的 `base`/`amount`/`threshold`/`power` 槽位,从 `init` 初始值开始,依序应用所有注册到该槽位的效果 → 得到槽位组合值。
2. **合并主效果**:对该数值点上的所有效果,从基准值开始,按优先级依序 `applyEffect`。

**优先级**:`add(0) → mul(1) → exp(2) → custom(3) → cap(4)`,`order` 可覆盖。
`cap` 永远最后生效(软上限作用于"所有加成之后的值")。

## 四、注册与查询

- **注册**:`registerEffect(e)` 按 target 分组并缓存;`id` 全局唯一(重复即抛错)。
- **查询**:
  - `applyTo(target, base, ctx?)` / `slotValue(pointId, ctx?)` — 读最终值;
  - `effectById(id)` / `effectValueById(id, ctx?)` — 按 id 引用某条加成的当前数值(未注册返回 1);
  - `effectBreakdown(target, ctx?, base?)` / `slotBreakdown(slotOrId, ctx?)` — 统计明细(总效果+各生效来源);
  - `invertAt(pointId, out, ctx?)` — 通用求逆(见 §五);
  - `effectText(e, ctx?)` / `renderText(template, e, ctx?)` — 描述模板(`{value}{base}{basePercent}{amount}`)。

## 五、软上限(cap)与可逆性

### cap 是一等效果类型

软上限不再写成 `custom`、也不再在公式里直接调 `softCapValue`,而是声明成 `cap`:

```ts
defineEffect('production', {
  type: 'cap',
  name: '维度生产软上限',
  threshold: 'dimCap:base', // 槽位(可被挑战/升级修饰)
  power: 'dimCap:power', // 槽位
  height: 0, // 常量
})
```

收益:参数自动进统计页、自动可求逆、自动可被别的效果修饰,并且**阈值/幂次/高度不再是散在函数体里的魔法数字**。

- `height` 是每个 cap 自己的常量:价格软上限 `height=1`、维度生产软上限 `height=0`、挑战目标软上限 `height=0`。
- 数学实现仍在 `tools/softCap.ts`(纯函数),`cap` 步骤只是它的注册式入口。

### 通用求逆 `invertAt`

计划本身就是**有序步骤**,所以求逆就是**逆序折叠**:

| 步骤 | 逆 |
| ---- | -- |
| `add` | `out - v` |
| `mul` | `out / v` |
| `exp` | `out^(1/v)`(要求 v>0) |
| `cap` | `softCapValue(out, m, 1/p, h)`(要求 p>0) |
| `custom` | **不可逆** → 返回 `undefined` |

- 参数全部来自槽位,因此 iu52/ic4/c4 等对参数的修改**自动反映到求逆**,调用方不再手传幂次。
- **可逆性是数值点的可推导属性**:点上只要出现任何 `custom` 步骤,`invertAt` 就返回 `undefined`,调用方退回通用搜索
  (契约不变:**锚点只影响迭代次数,不影响正确性**,见 `tools/bisect.ts`)。
- 因此:**价格类数值点(`dimensionCost`/`buyableCost`)的管道禁止 `custom`**;
  但**槽位**上的 `custom` 是允许的(如 iu22 把 `b12:costBase` 降为 0),它由物品自己的价格公式与反解负责。

## 六、多条效果作用于多个数值点(联动)

`target` 写成数组时,**同一条效果会挂到多个数值点列表里(同一个对象引用,id 仍然唯一)**:

```ts
defineEffect(['priceCap:power', 'dimCap:power'], { type: 'exp', value: () => new Decimal(2) })
```

- 单一 id ⇒ 描述、禁用器、统计来源都只有一份;统计页会在两个数值点下都显示它,这正是"耦合点"的可见化。
- **约束**:`targets` 长度>1 的效果,其数值**必须与 ctx 无关**(开发构建用两个不同 ctx 求值校验,不等即报错)。
- **禁止**用"共用一个 target"实现联动(那是历史 bug 的来源)。

## 七、曲线(Curve):指数型公式族的正逆同源

价格与挑战目标都形如"以次数为自变量的递增函数",需要**正向公式与反解来自同一份声明**,否则就会出现
"`dimensionSumEstimate` 重新推导一遍 `base`/`increment`"这种双份维护。

```ts
interface Curve {
  at(n: Decimal, ctx?): Decimal
  inverse(v: Decimal, ctx?): Decimal | undefined // 不可逆/越界 → undefined
  ratio?(ctx?): Decimal | undefined // 公比(仅几何级数),用于"总预算→末项预算"折算
}
```

- 数学原语在 `tools/curves.ts`(纯函数,参数已解析),三方法**全部返回 `Decimal`**;
- 绑定参数来源的糖在 `compute/curves.ts`(`expLinear`/`powerQuadratic`/`powerDoubleExp`,以及把正向取整的 `floored`),
  底数缺省取 `priceBase()`——那是**全仓库唯一读 `getBase()` 的地方**(升级价格由 `upgradeCost` 传入 `base`);
- "预算→数量"的估算骨架在 `compute/estimate.ts` 的 `estimateCount`(维度与可购买共用同一份);
- 曲线是**可选加速声明**:没有解析逆的公式不声明 `curve`,退回 `maxSatisfying` 通用搜索;
- 公比不是常数的形状**不要声明 `ratio`**(硬套公比只会让锚点更差);
- 开发构建自检:`inverse(at(n)) ≈ n` 往返一致,正逆不再同源会当场报错。

**底数(báse)约束**:

- **价格底数长期等于序数进制**,即"进制缩减 ⇒ 价格与挑战目标同步下降"。
- 全仓库只有 `compute/curves.ts`(曲线缺省 base)与 `compute/upgrades.ts`(`upgradeCost`)可以读 `getBase()`;物品/目标声明禁止直接调用。
- **序数进制只取 2~10 的整数**。曲线在 `base ≤ 1` 时 `inverse` 必须返回 `undefined`(函数递减,不可逆),开发构建断言 `getBase() > 1` 且为 2~10 的整数。

## 八、自动注册(注册表模式)

升级/可购买/成就/知识升级的定义数组里直接写 `effect` 字段,模块加载时循环注册:

```ts
for (const u of UPGRADES) {
  const e = upgradeEffect(u) // 自动补 id(`upgrade-${u.id}`)/name/isActive
  if (e) registerEffect(e)
}
```

各系统自动注册时的 id 前缀:

| 来源          | id 前缀                                      | 生效条件                                                |
| ------------- | -------------------------------------------- | ------------------------------------------------------- |
| 升级          | `upgrade-{id}`                               | 本层已购买(可自定义,如 u1 作用于上层)                   |
| 可购买        | `buyable-{id}`                               | 始终(等级槽位含免费等级)                                |
| 成就          | `achievement-{id}`                           | 已解锁                                                  |
| 知识升级      | `knowledge-{id}`                             | 已购买至少1次                                           |
| 挑战惩罚/奖励 | `challenge-{id}-penalty-{n}` / `-reward-{n}` | 激活中 / 完成次数>0                                     |
| 无限挑战      | 同上(`challenge-ic{n}-…`)                    | 同上(无限挑战也是挑战,共用同一套注册与结算)             |
| 无限升级      | `iu-{id}`                                    | 已购买(可叠加自定义条件,如 iu32 仅挑战中、iu51 仅层级0) |
| 无限里程碑    | `im-{id}`                                    | 已解锁(无限重置次数达到该里程碑阈值)                    |

## 九、效果禁用与挑战

`registerEffectDisabler(effectId, fn)` 注册禁用器:fn 返回 true 时该效果被跳过。
挑战 c1/c2 用它禁用 b11/b12(`buyable-11`/`buyable-12`)。
`applyValue`/`applyEffect`/`isEffective` 均跳过被禁用效果(统计页也不显示)。

> 禁用器目前只在**挑战进出**时才会改变判定结果,因此 `enterChallenge`/`exitChallenge`/`lockInvalidChallenges`
> 都会调用 `clearFrameCache()`。若将来出现"每帧内会自己变化的禁用条件",必须一并处理(见 [性能.md](./性能.md) 的缓存契约)。

### 无限挑战与"强制视为进入"

无限挑战(`ChallengeDef.layer == 'infinity'`,购买无限升级 iu15 解锁)与普通挑战**共用注册表、完成次数表
(`player.challenges`)、激活列表(`player.activeChallenges`)、入口函数(`enterChallenge`/`exitChallenge`)
与卡片组件**,差别只有三点:解锁条件、进出时强制无限重置(不获得资源)、目标资源恒为层级0点数。

其中"强制视为进入"是**零额外效果注册**的关键:例如 IC1 要让 C1+C2 的惩罚始终生效,
只需在 `access/challengeState.ts` 的 `FORCED_ACTIVE` 里声明 `ic1: ['c1', 'c2']`,
`isChallengeActive` 便会在这两个 id 上恒返回 true,于是 C1 的加速器禁用、C2 的加倍器禁用与点数减半
自动生效,无需再注册一份惩罚效果。IC2 同理强制 C3+C4(仅额外注册一条 `b11:base` 惩罚)。

- `FORCED_ACTIVE` 登记在 `access` 层(被 `access`/`compute`/`logic` 共同读取,放 `logic` 会造成循环依赖);
- `logic/challenges.ts` 注册完挑战后有一条**仅开发构建执行**的交叉校验,防止该表与注册表失配;
- 被强制激活的挑战不可进入/退出/完成:卡片只显示"强制生效中",`exitChallenge` 内也有 `isForcedActive` 守卫。

### 挑战目标与软上限

所有挑战的目标都写成**带进制的指数型**,并统一经过 `challengeGoalIndex` 的 `cap`:

```ts
{ id: 'c1', goalShape: { a: 5, b: 2 } } // 目标 = base^(a + b·i),i = 过完cap管道的完成次数指数
{ id: 'x', goalFormula: (i) => ... } // 非指数型的逃生口:i 已经是cap后的指数
```

- `goalShape` / `goalFormula` 由 `registerChallenge` 生成 `def.goal(k)`,调用方(`challengeGoal`/`maxSatisfying`)不变;
- **软上限不可能漏写**:公式只拿得到"已过 cap 的指数";真需要"无软上限"的挑战,必须显式开自己的指数数值点;
- 批量完成用 `invertAt('challengeGoalIndex', …)` 提供 estimate:既把求值次数压下来,
  也越过"不带估算时倍增搜索最多探到 `2^64`"的上限(见 [性能.md](./性能.md) 的 P1)。

## 十、帧内缓存、效果计划与 static

帧内缓存的正确性约束见 [性能.md](./性能.md)(唯一权威)。

- **效果模板**:一个数值点的效果按优先级排序后切成若干"段"(`EffectGroup`),相邻的同类静态效果合成一段,
  `cap`/`custom` 恒独立成段。整理只取决于注册顺序,与层级/物品/挑战状态无关,故**注册表变化时整理一次**
  (`registerVersion` 作废整表),不再每帧重算。
- **效果计划**:帧内把模板**物化**一次(`数值点id|层级键|物品id` 缓存):判定生效、把 fold 段的生效成员合成一个数值、
  解析 `cap` 的阈值/幂次、留下动态效果待读取时现算。读取只做算术,不再重解管线。
- **静态折叠**:`static: true` 的效果进 fold 段(add求和/mul求积/exp幂次求积);
  段内成员可被单独禁用,合成时只累计生效成员(同类型可交换可结合,故这样合成是精确的)。
  于是 `dimensionMult` 的十来条乘法加成会合成 1 步,只有真正的动态效果仍逐步求值。
- **正向、求逆、统计同源**:`invertAt` 逆序折叠**同一份**计划步骤,`effectTrace` 则按 `active` 逐条展示
  (统计页要逐条明细,故不合并)。
- **默认 dynamic**(不缓存数值)。标 `static` 是承诺"该数值只依赖购买/解锁/层级结构",
  且**不得读取 `current`**(fold 段在物化时就把值算好,拿不到运行时值);
  读**点数/维度数量(产出)/能量/时间/`bestPoints`/`resetTime`** 的效果**必须保持 dynamic**。
  默认关闭的取向:漏标只是变慢,**不会算错**。
- 任何会改变被缓存值的写操作之后必须调用 `clearFrameCache()`(它同时丢弃 static 自检的采样)。
- 开发构建在"生产阶段后"与"帧末"自动跑 `runStaticSelfCheck`:绕过缓存重算已记录的 static 数值并比对,
  不等就直接点名效果id——**标错 static 会在运行中当场暴露**,不用等玩家发现数值变味。
- 开发构建可用 `/perf` 指令看每类缓存的命中/未命中与搜索求值次数(判定"缓存有没有用"只看计数)。

## 十一、统计页的加成树

统计树**完全由数值点声明派生**(`compute/valuePoints.ts` + `compute/statistics.ts` 的通用构建器),
`statistics.ts` 里没有任何按 target 手写的分支。

数值点声明(`defineValuePoint`)包含:

| 字段 | 作用 |
| ---- | ---- |
| `label` | 节点标题(可按上下文变化,如 `维度${id+1}产量`) |
| `sign` | 总值前的符号(`x`/`+`/`^`/空) |
| `base(ctx)` | 调用型数值点的"初始值"节点(如产量的 `总量×乘数^指数`、答题冷却的 3600) |
| `statRoots` | 根的分组:`dimension` 每维度一棵、`buyable` 每可购买一棵、`layer` 每层一棵、`once` 全局一棵 |
| `statInputs(ctx)` | 公式输入节点(只有真公式需要,如产量的 总量/乘数/指数;`point` 字段会展开该数值点的效果明细) |

节点渲染:

- 每个效果节点用 `effectTrace` 的**前值/后值**展示(`计划本身是有序步骤`);
- `cap` 节点只写 **名称 + `原值 → 新值`**,说明是 **`高度h`**
  (如 `价格软上限 1.000e10000 → 4.387e724631 (高度1)`)。行内文本由 `StatNode.text` 覆盖(不再显示 `sign`+`value`);
  **阈值与幂次不在行内**,展开该节点才看到 `阈值`/`幂次` 两个槽位各自的初始值与修饰来源
  (如 `无限升级-软上限削弱 ^0.99`);
  **没咬住的软上限(前后值相同)不显示**——否则每个维度都会挂一条;
- `custom` 节点同样附 `原值 → 新值`(它无法用单一系数表达);
- 效果的参数槽位(`底数`/`数量`/`阈值`/`幂次`)统一由参数槽位列表展开,新增参数类型只需在
  `statistics.ts` 的 `effectParams` 里加一行。

## 十二、新增系统的正确姿势

1. 用 `defineValuePoint` 注册数值点(一处声明 id/label/sign/base/statRoots/statInputs)——统计页自动出节点;
2. 用 `defineSlot` 注册需要的槽位(具名、模块级);
3. 定义数组里写 `effect` 字段(或直接 `registerEffect`);软上限写 `cap`;
4. 核心公式里用 `applyTo('target', base, ctx)` 读取,不手写任何加成;
5. 需要"预算→数量"的闭式锚点时,声明 `curve`(正逆同源);
6. 数值只依赖购买/解锁/层级结构的加成顺手标 `static: true`(见 §十)。

### 铁律

1. **任何数值加成都必须经管道注册,禁止把加成烘焙进核心公式。**
2. **禁止绕过管道直接调 `softCap`/`softCapValue`** 处理玩法数值(它们只作为 `cap` 步骤的实现被调用)。
3. **禁止在调用点临时构造槽位对象**或手写 `{ pos: [0], id: 0 }`。
4. **禁止在物品/目标公式里直接读 `getBase()`**(唯一入口见 §七)。
5. **禁止用"共用一个 target"实现多数值联动**(用 `targets: [...]`,且数值必须与 ctx 无关)。
6. 数值回调**必须返回 `Decimal`**;读取路径禁止再包 `new Decimal(...)`。
7. **禁止手改统计树结构**;展示不出来的数值点说明它的 `label`/`base`/`statRoots` 没声明。
