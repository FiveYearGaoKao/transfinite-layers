//调试用的存档字段读写(仅供开发构建+调试模式下的指令调用)
//只按"点分路径"访问player上已存在的对象;写入按叶子原类型转换,顶层禁止新建字段(避免拼错字段名写出非法状态)
import Decimal from 'break_eternity.js'
import { player } from '@/data/player'

/**禁止访问的顶层字段:存档元数据/时间戳/随机数状态,改动会破坏存档的时间与校验码校验 */
const DENIED_KEYS = [
  'version',
  'checkCode',
  'firstPlay',
  'lastPlay',
  'seed',
  'rngState',
  'pendingQuiz',
]

/**读取值的文字上限(超出截断) */
const MAX_TEXT = 200

/**把点分路径解析为"父对象+键";路径非法、首段被禁用或中间段不存在时返回undefined */
function resolveParent(path: string): { parent: Record<string, unknown>; key: string } | undefined {
  const parts = path.split('.').filter((p) => p.length > 0)
  if (parts.length == 0) return undefined
  if (DENIED_KEYS.includes(parts[0]!)) return undefined
  let cur: unknown = player
  for (const p of parts.slice(0, -1)) {
    if (cur == null || typeof cur != 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  if (cur == null || typeof cur != 'object') return undefined
  return { parent: cur as Record<string, unknown>, key: parts[parts.length - 1]! }
}

/**把一个值转为可读文字(Decimal取精确字符串,对象/数组取JSON摘要) */
function valueText(v: unknown): string {
  if (v instanceof Decimal) return v.toString()
  if (typeof v == 'number' || typeof v == 'string' || typeof v == 'boolean') return String(v)
  if (v == null) return String(v)
  const json = JSON.stringify(v) ?? ''
  return json.length > MAX_TEXT ? json.slice(0, MAX_TEXT) + '...' : json
}

/**读取player上的字段(路径不存在或不可读时返回undefined) */
export function getPlayerValue(path: string): string | undefined {
  const target = resolveParent(path)
  if (!target) return undefined
  if (!(target.key in target.parent)) return undefined
  return valueText(target.parent[target.key])
}

/**新建字段时的类型模板:取同一父对象下第一个基础类型/Decimal的值 */
function siblingTemplate(parent: Record<string, unknown>): unknown {
  for (const k of Object.keys(parent)) {
    const v = parent[k]
    if (v instanceof Decimal || ['number', 'string', 'boolean'].includes(typeof v)) return v
  }
  return undefined
}

/**
 * 写入player上的字段(按叶子原类型转换)
 * 顶层字段必须已存在;容器内允许新建键,类型取同容器已有值的类型(无同类型参考时按Decimal解析)
 */
export function setPlayerValue(path: string, raw: string): { ok: boolean; text: string } {
  const target = resolveParent(path)
  if (!target) return { ok: false, text: `路径不可写:${path}(禁止修改存档元数据字段)` }
  const { parent, key } = target
  const exists = key in parent
  if (!exists && parent === (player as unknown as Record<string, unknown>)) {
    return { ok: false, text: `顶层字段不存在:${path}(不允许新建顶层字段)` }
  }
  const old = exists ? parent[key] : siblingTemplate(parent)
  if (old instanceof Decimal || old === undefined) {
    const d = new Decimal(raw)
    if (Decimal.isNaN(d)) return { ok: false, text: `不是合法的数字:${raw}` }
    parent[key] = d
    return { ok: true, text: `${path} = ${d.toString()}` }
  }
  if (typeof old == 'number') {
    const n = Number(raw)
    if (!isFinite(n)) return { ok: false, text: `不是合法的数字:${raw}` }
    parent[key] = n
    return { ok: true, text: `${path} = ${n}` }
  }
  if (typeof old == 'boolean') {
    if (raw != 'true' && raw != 'false') return { ok: false, text: '布尔字段只能填true或false' }
    parent[key] = raw == 'true'
    return { ok: true, text: `${path} = ${raw}` }
  }
  if (typeof old == 'string') {
    parent[key] = raw
    return { ok: true, text: `${path} = ${raw}` }
  }
  return { ok: false, text: `该字段不支持直接写入:${path}` }
}
