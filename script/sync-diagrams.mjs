#!/usr/bin/env node
/**
 * Sync the canonical mermaid diagrams into every markdown embed.
 *
 * The .mmd files under docs/diagrams/ are the single source of truth; the
 * fenced mermaid blocks in the markdown files below are generated, written
 * between BEGIN/END marker comments. Edit the .mmd, never the embed.
 *
 * Usage:
 *   node script/sync-diagrams.mjs          # regenerate every embed
 *   node script/sync-diagrams.mjs --check  # exit 1 when any embed is stale (CI gate)
 */
import { readFileSync, writeFileSync } from 'node:fs'

// 每张图的唯一正典 .mmd 与它嵌入的目标文件（嵌入块一律生成，勿手改）。
// 值为数组时所有目标共享同名 .mmd；值为对象时按目标文件指定 .mmd 源
// （README.md 用英文图，中文文档用中文图）。
const DIAGRAMS = {
  'blue-layers': {
    'README.md': 'blue-layers.en',
    'README.zh.md': 'blue-layers.zh',
    'docs/blue-architecture.md': 'blue-layers.zh',
  },
  'blue-composition': [
    'docs/blue-architecture.md',
    'website/plugins/builtins.md',
    'website/en/plugins/builtins.md',
  ],
}

const check = process.argv.includes('--check')
let failures = 0

for (const [name, mapping] of Object.entries(DIAGRAMS)) {
  const targets = Array.isArray(mapping)
    ? mapping.map(file => [file, name])
    : Object.entries(mapping)
  const begin = `<!-- BEGIN diagram:${name} -->`
  const end = `<!-- END diagram:${name} -->`

  for (const [file, sourceName] of targets) {
    const source = `docs/diagrams/${sourceName}.mmd`
    const mermaid = readFileSync(source, 'utf8').replace(/\s+$/, '')
    const fence = '```' + 'mermaid'
    const block =
      `${begin}\n` +
      `<!-- single source 单一来源: ${source} — edit the .mmd, then \`pnpm run diagrams:sync\` -->\n` +
      `${fence}\n${mermaid}\n${fence.slice(0, 3)}\n` +
      end

    const text = readFileSync(file, 'utf8')
    const i = text.indexOf(begin)
    const j = text.indexOf(end)
    if (i === -1 || j === -1 || j < i) {
      console.error(`✗ ${file}: missing ${begin} … ${end} markers`)
      failures++
      continue
    }
    const updated = text.slice(0, i) + block + text.slice(j + end.length)
    if (updated === text) continue
    if (check) {
      console.error(`✗ ${file}: stale embed for ${name} — run \`pnpm run diagrams:sync\``)
      failures++
    } else {
      writeFileSync(file, updated)
      console.log(`→ ${file}: synced ${name} from ${source}`)
    }
  }
}

if (failures > 0) {
  process.exitCode = 1
} else if (check) {
  console.log('✓ all diagram embeds match their .mmd sources')
}
