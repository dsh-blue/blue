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

const TARGETS = ['README.md', 'README.zh.md', 'docs/blue-architecture.md']
const DIAGRAMS = ['blue-layers', 'blue-composition']

const check = process.argv.includes('--check')
let failures = 0

for (const name of DIAGRAMS) {
  const source = `docs/diagrams/${name}.mmd`
  const mermaid = readFileSync(source, 'utf8').replace(/\s+$/, '')
  const fence = '```' + 'mermaid'
  const block =
    `<!-- BEGIN diagram:${name} -->\n` +
    `<!-- single source 单一来源: ${source} — edit the .mmd, then \`pnpm run diagrams:sync\` -->\n` +
    `${fence}\n${mermaid}\n${fence.slice(0, 3)}\n` +
    `<!-- END diagram:${name} -->`

  const begin = `<!-- BEGIN diagram:${name} -->`
  const end = `<!-- END diagram:${name} -->`

  for (const file of TARGETS) {
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
      console.log(`→ ${file}: synced ${name}`)
    }
  }
}

if (failures > 0) {
  process.exitCode = 1
} else if (check) {
  console.log('✓ all diagram embeds match their .mmd sources')
}
