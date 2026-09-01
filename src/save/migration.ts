//存档迁移机制
//职责:对旧存档做"数据转换"(如重命名、重算字段),而不是补默认字段
//补字段由 initializeSave + Object.assign 负责,迁移只处理需要变换的数据
//注意:迁移函数运行在无默认值的原始存档对象上,必须自包含,不能假设字段已存在
import Decimal from 'break_eternity.js'
import type { Player } from '@/data/player'
import { versionComp } from '@/tools/utils'

/**一次迁移，将存档从from版本升级到to版本 */
export interface Migration {
  from: string
  to: string
  apply(save: Player): void
}
/**所有已注册的迁移，按注册顺序应用 */
export const migrations: Migration[] = []
/**应用所有比当前版本更新的迁移 */
export function migrate(save: Player): void {
  for (const m of migrations) {
    if (versionComp(save.version, m.from) >= 0 && versionComp(save.version, m.to) < 0) {
      m.apply(save)
      save.version = m.to
    }
  }
}

//------ v0.1.0 → v0.1.1 ------
/**隐藏成就触发标记到成就id的映射 */
const SECRET_FLAG_ACHIEVEMENTS: Record<string, string> = {
  rickroll: 's11',
  'quiz-fail': 's14',
  cheater: 's15',
  'theme-spam': 's16',
}

/**普通挑战互斥:多激活时只保留编号最大的一个(如c5);非"c+数字"的id(如未来的元层挑战)原样保留 */
function keepLargestNormalChallenge(active: string[]): string[] {
  const normals = active.filter((id) => /^c\d+$/.test(id))
  if (normals.length <= 1) return active
  const rest = active.filter((id) => !/^c\d+$/.test(id))
  let best = normals[0] ?? ''
  for (const id of normals) {
    if (parseInt(id.slice(1)) > parseInt(best.slice(1))) best = id
  }
  return [...rest, best]
}

migrations.push({
  from: 'v0.1.0',
  to: 'v0.1.1',
  apply(save) {
    //隐藏成就标记迁移:有secretFlag即视为达成(每帧成就检查至多1/30s时差),直接解锁对应成就(奖励固定1知识),并清除该字段
    const flags = (save as unknown as { secretFlags?: string[] }).secretFlags
    if (Array.isArray(flags)) {
      for (const f of flags) {
        const id = SECRET_FLAG_ACHIEVEMENTS[f]
        if (id && !save.achievements.includes(id)) {
          save.achievements.push(id)
          save.knowledge = (save.knowledge ?? new Decimal(0)).add(1)
        }
      }
      delete (save as unknown as { secretFlags?: string[] }).secretFlags
    }
    //普通挑战互斥:多激活时只保留编号最大的一个
    if (Array.isArray(save.activeChallenges)) {
      save.activeChallenges = keepLargestNormalChallenge(save.activeChallenges)
    }
  },
})

//------ v0.1.1 → v0.1.2 ------
migrations.push({
  from: 'v0.1.1',
  to: 'v0.1.2',
  apply(save) {
    //v0.1.2新增"本次无限经历的时间":旧档没有该字段时设为总游戏时间,使其从存档时刻起累计
    //注:通过可选字段类型访问,避免TS对'in'操作符的收窄把分支类型推成never
    const s = save as { infinityRunTime?: Decimal; totalTime: Decimal }
    if (s.infinityRunTime === undefined) s.infinityRunTime = s.totalTime
  },
})
