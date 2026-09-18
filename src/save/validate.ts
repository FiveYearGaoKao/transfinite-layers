//存档形状工具:数值校验(读写档各调用一次)与字段裁剪(写档时删掉空白档里没有的字段)
//判据由空白存档的形状派生,不维护第二份字段清单:新增字段只要写进initializeSave/initializeLayer就自动被覆盖
//形状规则(空白=initializeSave()的结果,实际=待处理对象):
//- 空白是Decimal → 实际必须是合法Decimal
//- 空白是基础类型(number/string/boolean) → 实际必须同类型
//- 空白是数组 → 实际必须是数组;空白非空时元素按空白首项校验(如dimensions的[Decimal,Decimal]),空数组只要求是数组(如upgrades)
//- 空白是null或undefined(形状不定,如pendingQuiz或动态映射) → 不校验类型,但对实际值递归做Decimal检查
//- 空白是对象 → 只校验空白里出现的键;空白是"按id存的记录表"(键全为非负整数,如层级表)时,
//  空白之外的键(其他层级)按"空白的首个值"当模板校验
//- 其余对象(存档根对象、checkin这类字段名做键的对象)不校验额外键:
//  旧存档里常残留当前代码已删除/改名的字段(如v0.1.2的checkinStreak),把它们当类型错误会挡住正常读档
//  (这类字段的值按"默认丢掉"处理,由pruneToBlankShape在写档时裁掉)
//无论形状如何,任何位置出现的Decimal都会被检查(覆盖动态映射里的值,如challenges.c1、buyables[1])
//缺失字段会被判为问题(如layerDepth:期望number,实际undefined);读档路径先把空白档默认值铺上再校验,故旧档的缺失字段不算问题
//已知不覆盖的情况:字段名做键的动态映射里"该是Decimal却写成了number/string"这类错误(形状未知,无法判定)
import Decimal from 'break_eternity.js'
import { emptySave } from '@/data/player'

/**问题清单上限(坏档一次可能刷出成百上千条,只保留前若干条) */
const MAX_PROBLEMS = 20

/**值的类型名(报错信息用) */
function typeName(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (v instanceof Decimal) return 'Decimal'
  return typeof v
}

/**拼写问题路径 */
function joinPath(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key)
}

/**
 * "按id存的记录表"的元素模板(如层级表的层级对象、可购买表的Decimal)
 * 判据:空白对象非空且键全为非负整数;其余对象返回undefined表示"不校验额外键"
 */
function keyedMapTemplate(blank: Record<string, unknown>): unknown {
  const keys = Object.keys(blank)
  if (keys.length == 0 || !keys.every((k) => /^\d+$/.test(k))) return undefined
  return Object.values(blank)[0]
}

/**加入问题清单(超出上限后忽略) */
function push(problems: string[], text: string) {
  if (problems.length < MAX_PROBLEMS) problems.push(text)
  else if (problems.length == MAX_PROBLEMS) problems.push('...(问题过多,已省略)')
}

/**
 * 单个Decimal是否合法
 * 只查两件事:是否为NaN、layer是否为整数
 * 注:mag不是"尾数大小"而是十进制指数,|值|<1时为负数(如new Decimal(1e-20)的mag=-20),属正常值;
 *    Infinity(layer为Infinity)也是合法值(如infinityBestResetTime初始为dInf),故跳过非有限layer
 */
function decimalProblem(v: Decimal): string | undefined {
  if (v.isNan()) return '值为NaN'
  if (Number.isFinite(v.layer) && !Number.isInteger(v.layer)) return `层数非法(layer=${v.layer})`
  return undefined
}

/**按空白形状递归校验一个值 */
function checkValue(blank: unknown, actual: unknown, path: string, problems: string[]) {
  //与形状无关的检查:任何位置出现的Decimal都必须合法
  if (actual instanceof Decimal) {
    const p = decimalProblem(actual)
    if (p) push(problems, `${path}:${p}`)
  }
  if (blank instanceof Decimal) {
    if (!(actual instanceof Decimal)) push(problems, `${path}:期望Decimal,实际${typeName(actual)}`)
    return
  }
  //空白形状不定(null/undefined):不校验类型,但对实际值继续深入(如动态映射里的NaN)
  if (blank == null) {
    if (Array.isArray(actual)) {
      actual.forEach((v, i) => checkValue(undefined, v, joinPath(path, i), problems))
      return
    }
    if (actual != null && typeof actual == 'object') {
      const a = actual as Record<string, unknown>
      for (const key of Object.keys(a)) checkValue(undefined, a[key], joinPath(path, key), problems)
    }
    return
  }
  if (Array.isArray(blank)) {
    if (!Array.isArray(actual)) {
      push(problems, `${path}:期望数组,实际${typeName(actual)}`)
      return
    }
    const template = blank[0]
    if (template === undefined) {
      //空数组模板(如upgrades):只要求是数组,元素类型无从推断
      actual.forEach((v, i) => checkValue(undefined, v, joinPath(path, i), problems))
      return
    }
    actual.forEach((v, i) => checkValue(template, v, joinPath(path, i), problems))
    return
  }
  if (typeof blank == 'object') {
    if (actual == null || typeof actual != 'object' || Array.isArray(actual)) {
      push(problems, `${path}:期望对象,实际${typeName(actual)}`)
      return
    }
    const b = blank as Record<string, unknown>
    const a = actual as Record<string, unknown>
    for (const key of Object.keys(b)) checkValue(b[key], a[key], joinPath(path, key), problems)
    //按id存的记录表(如层级表):空白之外的键按模板校验;其余对象的额外键只做"Decimal必须合法"的深入检查(见文件头注释)
    const template = keyedMapTemplate(b)
    for (const key of Object.keys(a)) {
      if (key in b) continue
      checkValue(template, a[key], joinPath(path, key), problems)
    }
    return
  }
  if (typeof actual != typeof blank) {
    push(problems, `${path}:期望${typeof blank},实际${typeName(actual)}`)
  }
}

/**
 * 检测一份存档状对象中的NaN与非法Decimal
 * @param target 待校验对象(通常是player或刚解析出的存档对象)
 * @returns 问题描述列表(路径:原因);无问题时为空数组
 */
export function findInvalidValues(target: unknown): string[] {
  const problems: string[] = []
  checkValue(emptySave, target, '', problems)
  return problems
}

/**
 * 按空白存档的形状裁剪字段:删掉空白里没有的字段(如旧存档残留的checkinStreak、层级对象上的多余字段)
 * 动态映射(层级表、挑战表、自动化配置等)的键全部保留,只裁它们内部多出来的字段
 * @param target 待裁剪对象(写档前用序列化后的对象调用,不修改入参)
 * @returns 裁剪后的新对象
 */
export function pruneToBlankShape(target: unknown): unknown {
  return pruneValue(emptySave, target)
}

/**按空白形状递归裁剪一个值 */
function pruneValue(blank: unknown, actual: unknown): unknown {
  //叶子与形状不定的位置(Decimal/基础类型/null/undefined)原样返回
  if (blank == null || !(typeof blank == 'object') || blank instanceof Decimal) return actual
  if (Array.isArray(blank)) {
    if (!Array.isArray(actual)) return actual
    const template = blank[0]
    //空数组模板(如upgrades/achievements):元素类型无从推断,原样保留
    //非空数组模板:逐个元素裁剪,但**不按空白长度截断**——维度矩阵这类数组的长度会随机制增长(如元维度提升加维度)
    if (template === undefined) return actual.slice()
    return actual.map((v) => pruneValue(template, v))
  }
  if (actual == null || typeof actual != 'object' || Array.isArray(actual)) return actual
  const b = blank as Record<string, unknown>
  const a = actual as Record<string, unknown>
  const res: Record<string, unknown> = {}
  const template = keyedMapTemplate(b)
  //按id存的记录表(如层级表):键全部保留,值按模板裁剪
  if (template !== undefined) {
    for (const key of Object.keys(a)) res[key] = pruneValue(template, a[key])
    return res
  }
  //空的对象模板(如挑战表/自动化配置表):键无从推断,全部保留
  if (Object.keys(b).length == 0) {
    for (const key of Object.keys(a)) res[key] = a[key]
    return res
  }
  //普通对象:只保留空白里出现过的键
  for (const key of Object.keys(b)) {
    if (key in a) res[key] = pruneValue(b[key], a[key])
  }
  return res
}
