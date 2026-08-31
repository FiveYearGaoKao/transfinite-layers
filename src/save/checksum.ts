//存档校验码
//定位:完整性校验(检测存档损坏/被手改),不是反作弊——源码公开,算法必然可被还原
//校验基于"markDecimals 后统一序列化的结果"计算,保存和加载走同一基准
/**引入本套校验机制的版本号,低于它的旧存档跳过校验 */
export const CHECKSUM_VERSION: string = 'v0.0.5'
/**参与校验种子计算的装饰性盐(源码公开,仅提高一看就懂的门槛) */
export const CHECKSUM_SALT: number = 20260801
/**用多项式哈希生成校验码 */
export function checkCode(s: string, x: number): number {
  const M = 257
  const P = 10000019
  let S = 114514
  const l = s.length
  const A: number[] = new Array(M).fill(0)
  let p = 1
  for (let i = 0; i < l; ++i) {
    const c = s.charCodeAt(i) * s.charCodeAt(i >> 1)
    S ^= c
    p = (p + c + i) % M
    A[p] = ((A[p] || 0) + S) % P
  }
  x = x % P
  let res = 0
  for (let i = 0; i < M; ++i) {
    res = (res * x + (A[i] || 0)) % P
  }
  return res
}
