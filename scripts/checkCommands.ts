//指令系统验证脚本(对撞式,无测试框架):
//1. 答题储存:冷却溢出的次数按"每过一个冷却存1次"结算,封顶为知识升级"答题储存"的等级;
//   未购买该升级(上限0)时必须与"冷却结束即可答题"完全一致;消耗一次要等一个冷却才补回
//2. 离线时间上限:基准6小时,知识升级"离线延长"每级+1小时;剩余空间=上限-已储存
//3. 新增存档字段(答题储存/冷却时间戳/重置记录)能原样往返
//用法:node scripts/run-ts.mjs scripts/checkCommands.ts
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'
import { freshSave, check, reportChecks } from './helpers'
import { offlineTimeLimit, offlineTimeRoom, quizStoreLimit } from '@/compute/knowledge'
import { quizAvailable, quizCooldown, updateQuizStorage } from '@/logic/commands'
import { exportSaveString, importSaveString } from '@/save/save'

console.log('== 1. 答题储存 ==')
freshSave()
player.knowledgeUpgrades['command-quiz'] = new Decimal(1)
check('未购买"答题储存"时上限为0', quizStoreLimit() == 0)
const cdMs = quizCooldown().mul(1000).toNumber()
player.quizNextAt = Date.now() - cdMs * 2.5
updateQuizStorage()
check('上限为0时不储存(冷却结束即可答题)', player.quizStored == 0 && quizAvailable())

player.knowledgeUpgrades['quiz-store'] = new Decimal(3)
check('上限=已购等级', quizStoreLimit() == 3)
player.quizStored = 0
player.quizNextAt = Date.now() - cdMs * 2.5
updateQuizStorage()
check('过了2.5个冷却存3次(向下取整再封顶)', player.quizStored == 3, String(player.quizStored))
check('存满后计时在冷却中(不是停在就绪)', player.quizNextAt > Date.now())
player.quizStored = 0
player.quizNextAt = Date.now() - cdMs * 10
updateQuizStorage()
check('离线再久也只存到上限', player.quizStored == 3, String(player.quizStored))
check('久离线后计时同样在冷却中', player.quizNextAt > Date.now())
//消耗一次后必须等一个冷却才补回来(不能立刻补满)
player.quizStored = 2
player.quizNextAt = Date.now() - cdMs * 0.5
updateQuizStorage()
check('消耗一次后过一个冷却才补回', player.quizStored == 3, String(player.quizStored))
player.quizStored = 3
player.quizNextAt = Date.now() - cdMs
updateQuizStorage()
check('满仓时不额外累积储存', player.quizStored == 3)
check('满仓时计时被推到一个冷却之后', player.quizNextAt > Date.now() + cdMs * 0.9)
player.quizStored = 2
player.quizNextAt = Date.now() + cdMs
check('有储存时立即可答', quizAvailable())

console.log('== 2. 离线时间上限 ==')
freshSave()
check('初始上限6小时', offlineTimeLimit().eq(21600), offlineTimeLimit().toString())
check('初始剩余空间=上限', offlineTimeRoom().eq(21600))
player.knowledgeUpgrades['time-offline-limit'] = new Decimal(18)
check('满级上限24小时', offlineTimeLimit().eq(86400), offlineTimeLimit().toString())
player.offlineTime = new Decimal(80000)
check('剩余空间=上限-已储存', offlineTimeRoom().eq(6400), offlineTimeRoom().toString())

console.log('== 3. 新增字段往返 ==')
freshSave()
player.quizStored = 2
player.quizNextAt = 123456789
player.infinityResetLog = [{ time: new Decimal(60), gain: new Decimal(3), rate: new Decimal(0.05) }]
const text = exportSaveString()
freshSave()
check('导入成功', importSaveString(text))
check('答题储存往返', player.quizStored == 2, String(player.quizStored))
check('冷却时间戳往返', player.quizNextAt == 123456789, String(player.quizNextAt))
check('重置记录往返(条数)', player.infinityResetLog.length == 1)
const rec = player.infinityResetLog[0]
check(
  '重置记录往返(字段)',
  !!rec && rec.time.eq(60) && rec.gain.eq(3) && rec.rate.eq(0.05),
  rec ? `${rec.time}/${rec.gain}/${rec.rate}` : '缺失',
)

process.exit(reportChecks() ? 0 : 1)
