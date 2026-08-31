#!/usr/bin/env node
/**
 * Sync the component-shot SVG gallery into website/public/shots/.
 *
 * manifest.mjs 的 19 个场景是唯一数据源（单一来源）；生成的 SVG 一律由本
 * 脚本写入，勿手改。改动场景或渲染器后运行 `pnpm shots:sync` 重新生成。
 *
 * Usage:
 *   node script/shots/sync.mjs          # regenerate every shot
 *   node script/shots/sync.mjs --check  # exit 1 when any shot is stale (CI gate)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SCENARIOS } from './manifest.mjs'
import { renderScenario } from './render.mjs'
import { paintTerminalSvg } from './svg.mjs'

const uiLibUrl = new URL('../../packages/ui/lib/index.js', import.meta.url)
if (!existsSync(fileURLToPath(uiLibUrl))) {
  throw new Error('packages/ui/lib is missing — run `pnpm build` before the shots pipeline')
}
const { ui, defineBlueComponent } = await import(uiLibUrl.href)

const check = process.argv.includes('--check')
const outDir = new URL('../../website/public/shots/', import.meta.url)
mkdirSync(outDir, { recursive: true })

let failures = 0
for (const scenario of SCENARIOS) {
  const { term, cols, rows } = await renderScenario(scenario, ui, defineBlueComponent)
  const svg = paintTerminalSvg(term, { cols, rows })
  const file = new URL(`${scenario.id}.svg`, outDir)
  const label = `website/public/shots/${scenario.id}.svg`

  let current = null
  try {
    current = readFileSync(file, 'utf8')
  } catch {
    // 尚未生成：sync 写入，check 直接判 stale。
  }
  if (current === svg) continue
  if (check) {
    console.error(`✗ ${scenario.id}: stale — run \`pnpm shots:sync\``)
    failures++
  } else {
    writeFileSync(file, svg)
    console.log(`→ ${label} (${cols}×${rows}, ${svg.length} bytes)`)
  }
}

if (failures > 0) {
  process.exitCode = 1
} else if (check) {
  console.log(`✓ all ${SCENARIOS.length} component shots are current`)
}
