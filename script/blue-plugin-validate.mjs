import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv.slice(2).find(value => value !== '--') ?? '.')
const packageFile = join(root, 'package.json')
if (!existsSync(packageFile)) { console.error(`package.json not found: ${root}`); process.exit(2) }
const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
const sourceRoot = join(root, 'src')
const files = []
function walk(dir) { if (!existsSync(dir)) return; for (const entry of readdirSync(dir)) { const path = join(dir, entry); const info = statSync(path); if (info.isDirectory()) walk(path); else if (/\.(mjs|cjs|js|ts|tsx)$/.test(entry)) files.push(path) } }
walk(sourceRoot)
const violations = []
if (!/blue|frontend|adapter/i.test(manifest.name ?? '')) violations.push('package name does not identify a Blue adapter')
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (!/core/.test(root) && /@earendil-works\/pi-tui|\bansi\b|rawMode\(|process\.stdin\.setRawMode/.test(text)) violations.push(`renderer boundary import/state: ${file}`)
  if (/from ['"](?:@deepseek-ai\/dsh-(agent|session)|\.\.\/.*(?:agent|session))/.test(text) && !/adapter|harness/i.test(root)) violations.push(`raw Agent/Session dependency: ${file}`)
}
const exports = manifest.exports ?? {}
for (const [key, value] of Object.entries(exports)) {
  const target = typeof value === 'string' ? value : value?.default
  if (typeof target === 'string' && !target.startsWith('http') && !existsSync(join(root, target))) violations.push(`missing export target ${key}: ${target}`)
}
const lifecycle = files.some(file => /ctx\.effect|dispose\(|unload|register\(/.test(readFileSync(file, 'utf8')))
if (!lifecycle) violations.push('no observable Fiber lifecycle/registry ownership marker')
const report = { package: manifest.name ?? root, files: files.length, lifecycle, violations }
console.log(JSON.stringify(report, null, 2))
process.exitCode = violations.length === 0 ? 0 : 1
