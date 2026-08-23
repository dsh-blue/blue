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
const entry = files.find(file => /(?:^|\/)plugins?\.(?:mjs|cjs|js|ts)$/.test(file))
  ?? files.find(file => /(?:^|\/)index\.(?:mjs|cjs|js|ts)$/.test(file) && /export\s+(?:const|function)\s+name\b/.test(readFileSync(file, 'utf8')))
if (entry !== undefined && /export\s+(?:const|function)\s+name\b/.test(readFileSync(entry, 'utf8'))) {
  const source = readFileSync(entry, 'utf8')
  if (!/export\s+(?:const|function)\s+name\b/.test(source)) violations.push(`entry does not export stable name: ${entry}`)
  if (!/export\s+(?:async\s+)?(?:const|function)\s+apply\b/.test(source)) violations.push(`entry does not export apply: ${entry}`)
}
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
if (Array.isArray(manifest.files)) {
  for (const target of Object.values(exports)) {
    const value = typeof target === 'string' ? target : target?.default
    if (typeof value === 'string' && !manifest.files.some(pattern => pattern === 'lib/**/*' || value.replace(/^\.\//u, '').startsWith(String(pattern).replace(/^\.\//u, '').replace(/\*.*$/u, '')))) violations.push(`export target is not covered by files: ${value}`)
  }
}
if (existsSync(join(root, 'lib'))) {
  for (const [key, value] of Object.entries(exports)) {
    const target = typeof value === 'string' ? value : value?.default
    if (typeof target === 'string' && !existsSync(join(root, target))) violations.push(`built lib target missing ${key}: ${target}`)
  }
}
const publicTypeFiles = files.filter(file => file.endsWith('.ts') && !file.includes('/tests/'))
for (const file of publicTypeFiles) {
  const source = readFileSync(file, 'utf8')
  if (/(?:@earendil-works\/pi-tui|from ['"][^'"]*(?:ansi|react|dom)[^'"]*['"]|rawMode\(|setRawMode\()/iu.test(source) && !/packages[\\/]core(?:[\\/]|$)/.test(root)) violations.push(`renderer-specific public API: ${file}`)
}
const lifecycle = files.some(file => /ctx\.effect|dispose\(|unload|register\(/.test(readFileSync(file, 'utf8')))
if (!lifecycle) violations.push('no observable Fiber lifecycle/registry ownership marker')
const report = { package: manifest.name ?? root, files: files.length, lifecycle, violations }
console.log(JSON.stringify(report, null, 2))
process.exitCode = violations.length === 0 ? 0 : 1
