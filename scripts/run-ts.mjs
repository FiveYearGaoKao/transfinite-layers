//脚本运行器:把scripts下的TS脚本(可引用"@/别名")打包后交给node执行
//用法:node scripts/run-ts.mjs scripts/checkPricing.ts
//设计与约定见docs/面向开发者/开发规范.md:scripts不参与构建,复杂机制重构时用它做对撞验证
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = process.argv[2]
if (!entry) {
  console.error('用法:node scripts/run-ts.mjs <entry.ts>')
  process.exit(2)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

let esbuildBin
try {
  esbuildBin = path.join(path.dirname(require.resolve('esbuild/package.json')), 'bin', 'esbuild')
} catch {
  console.error('未找到esbuild(随vite安装);请先执行 npm install')
  process.exit(2)
}

const outDir = mkdtempSync(path.join(tmpdir(), 'tl-script-'))
const outfile = path.join(outDir, 'bundle.mjs')
const build = spawnSync(
  process.execPath,
  [
    esbuildBin,
    entry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--tsconfig=tsconfig.app.json',
    '--define:import.meta.env.DEV=true',
    '--define:import.meta.env.PROD=false',
    `--outfile=${outfile}`,
    '--log-level=warning',
  ],
  { cwd: root, stdio: 'inherit' },
)
if (build.status != 0) {
  rmSync(outDir, { recursive: true, force: true })
  process.exit(build.status ?? 1)
}

const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(3)], {
  cwd: root,
  stdio: 'inherit',
})
rmSync(outDir, { recursive: true, force: true })
process.exit(run.status ?? 1)
