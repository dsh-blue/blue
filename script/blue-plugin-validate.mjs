#!/usr/bin/env node
/**
 * Static package boundary validator for Blue frontend plugins. The report is
 * always one JSON document so CI and repository skills consume the same shape
 * on success and failure.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const argument = process.argv.slice(2).find(value => value !== '--') ?? '.'
const root = resolve(argument)
const reproduceTarget = relative(repositoryRoot, root)
const reproduce = `node script/blue-plugin-validate.mjs ${reproduceTarget === '' ? '.' : reproduceTarget.startsWith(`..${sep}`) ? root : reproduceTarget}`
const packageFile = resolve(root, 'package.json')

/** Emit a load failure using the normal report contract. */
if (!existsSync(packageFile)) {
  const report = {
    package: root,
    root,
    valid: false,
    files: 0,
    lifecycle: false,
    groups: { package: 1, architecture: 0, lifecycle: 0 },
    violations: [{ package: root, group: 'package', code: 'PACKAGE_MANIFEST_MISSING', message: `package.json not found: ${root}`, reproduce }],
  }
  console.log(JSON.stringify(report, null, 2))
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(packageFile, 'utf8'))
const packageName = typeof manifest.name === 'string' ? manifest.name : root
const sourceRoot = resolve(root, 'src')
const distributionManifestPath = resolve(root, 'blue.plugin.json')
const files = []

/** Collect executable source files without following symlinks. */
function walk(dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) walk(path)
    else if (/\.(?:mjs|cjs|js|ts|tsx)$/u.test(entry)) files.push(path)
  }
}
walk(sourceRoot)

const violations = []
/** Add one stable, machine-readable violation. */
function violate(group, code, message) {
  violations.push({ package: packageName, group, code, message, reproduce })
}

if (!/blue|frontend|adapter/iu.test(packageName)) violate('package', 'PACKAGE_NAME_INVALID', 'package name does not identify a Blue frontend package or adapter')
if (files.length === 0 && !existsSync(distributionManifestPath)) violate('package', 'PACKAGE_SOURCE_MISSING', 'src contains no executable source files and blue.plugin.json is missing')

/** Validate the distribution manifest without executing plugin code. */
if (existsSync(distributionManifestPath)) {
  let distribution
  try {
    distribution = JSON.parse(readFileSync(distributionManifestPath, 'utf8'))
  } catch {
    violate('package', 'PLUGIN_MANIFEST_INVALID_JSON', 'blue.plugin.json is not valid JSON')
  }
  if (distribution !== undefined) {
    const required = ['schemaVersion', 'id', 'entry', 'api', 'capabilities']
    for (const field of required) if (!(field in distribution)) violate('package', 'PLUGIN_MANIFEST_FIELD_MISSING', `blue.plugin.json is missing ${field}`)
    if (distribution.id !== packageName) violate('package', 'PLUGIN_ID_PACKAGE_MISMATCH', `manifest id ${String(distribution.id)} does not match package name ${packageName}`)
    const entry = typeof distribution.entry === 'string' ? distribution.entry : undefined
    if (entry === undefined || !entry.startsWith('./')) violate('package', 'PLUGIN_ENTRY_INVALID', 'manifest entry must be a relative path')
    else {
      const entryPath = resolve(root, entry)
      if (!existsSync(entryPath)) violate('package', 'PLUGIN_ENTRY_MISSING', `manifest entry is missing: ${entry}`)
      const entrySource = existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : ''
      if (!/export\s+const\s+name\s*=\s*['"][^'"]+['"]/u.test(entrySource)) violate('package', 'PLUGIN_NAME_UNSTABLE', 'manifest entry must export a literal name')
      if (!/export\s+(?:(?:async\s+)?function\s+apply\b|const\s+apply\s*=)/u.test(entrySource)) violate('package', 'PLUGIN_APPLY_MISSING', 'manifest entry must export apply')
      const entryName = /export\s+const\s+name\s*=\s*['"]([^'"]+)['"]/u.exec(entrySource)?.[1]
      if (entryName !== undefined && entryName !== packageName) violate('package', 'PLUGIN_NAME_PACKAGE_MISMATCH', `entry name ${entryName} does not match package name ${packageName}`)
      if (Array.isArray(manifest.files) && !manifest.files.some(pattern => filesEntryMatches(String(pattern), entry))) violate('package', 'PLUGIN_ENTRY_NOT_SHIPPED', `manifest entry is not covered by files: ${entry}`)
    }
  }
}

const sourceEntries = files
  .filter(file => !/(?:^|[\\/])invariant\.(?:mjs|cjs|js|ts)$/u.test(file))
  .map(file => ({ file, source: readFileSync(file, 'utf8') }))
const pluginEntries = sourceEntries.filter(entry => /export\s+(?:const|function)\s+name\b/u.test(entry.source) || /export\s+(?:async\s+)?function\s+apply\b/u.test(entry.source))
for (const entry of pluginEntries) {
  if (!/export\s+const\s+name\s*=\s*['"][^'"]+['"]/u.test(entry.source)) violate('package', 'PLUGIN_NAME_UNSTABLE', `plugin entry does not export a literal const name: ${relative(root, entry.file)}`)
  if (!/export\s+(?:(?:async\s+)?function\s+apply\b|const\s+apply\s*=)/u.test(entry.source)) violate('package', 'PLUGIN_APPLY_MISSING', `plugin entry does not export apply: ${relative(root, entry.file)}`)
  const inject = /export\s+const\s+inject\s*=\s*([^\n]+)/u.exec(entry.source)?.[1]
  if (inject !== undefined && !/^\s*(?:\[|Object\.freeze\(\[)/u.test(inject)) violate('package', 'PLUGIN_INJECT_INVALID', `plugin inject must be a stable array: ${relative(root, entry.file)}`)
}

const exportsMap = manifest.exports
if (exportsMap === undefined || exportsMap === null || typeof exportsMap !== 'object') {
  violate('package', 'PACKAGE_EXPORTS_MISSING', 'package exports map is missing')
}
if (!Array.isArray(manifest.files)) violate('package', 'PACKAGE_FILES_MISSING', 'package files whitelist is missing')

/** Return the runtime target from one exports entry. */
function exportTarget(value) {
  if (typeof value === 'string') return value
  return value !== null && typeof value === 'object' && typeof value.default === 'string' ? value.default : undefined
}

/** Match the simple package files patterns used throughout this workspace. */
function filesEntryMatches(entry, target) {
  const normalized = target.replace(/^\.\//u, '')
  if (!entry.includes('*')) return normalized === entry || normalized.startsWith(`${entry}/`)
  let pattern = ''
  for (let index = 0; index < entry.length;) {
    if (entry.startsWith('**/', index)) { pattern += '(?:.*/)?'; index += 3; continue }
    if (entry.startsWith('**', index)) { pattern += '.*'; index += 2; continue }
    if (entry[index] === '*') { pattern += '[^/]*'; index += 1; continue }
    pattern += entry[index].replace(/[.+^${}()|[\]\\]/gu, String.raw`\$&`)
    index += 1
  }
  return new RegExp(`^${pattern}$`, 'u').test(normalized)
}

for (const [key, value] of Object.entries(exportsMap ?? {})) {
  if (key.includes('*')) continue
  const target = exportTarget(value)
  if (target === undefined || target.startsWith('http')) continue
  const targetPath = resolve(root, target)
  if (!existsSync(targetPath)) violate('package', 'PACKAGE_EXPORT_TARGET_MISSING', `missing export target ${key}: ${target}`)
  if (target.replace(/^\.\//u, '').startsWith('lib/') && Array.isArray(manifest.files) && !manifest.files.some(pattern => filesEntryMatches(String(pattern), target))) {
    violate('package', 'PACKAGE_EXPORT_NOT_SHIPPED', `export target is not covered by files ${key}: ${target}`)
  }
}

const isCore = /packages[\\/]core(?:[\\/]|$)/u.test(root)
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const label = relative(root, file)
  if (!isCore && /@earendil-works\/pi-tui|process\.stdin\.setRawMode|\.setRawMode\(|\brawMode\(/u.test(source)) {
    violate('architecture', 'ARCH_RENDERER_BOUNDARY', `renderer or raw-terminal dependency outside core: ${label}`)
  }
  if (!isCore && /(?:from|import\s*\()\s*['"][^'"]*(?:react(?:-dom)?|\bdom\b|\bansi\b)[^'"]*['"]/iu.test(source)) {
    violate('architecture', 'ARCH_RENDERER_PUBLIC_API', `renderer-specific dependency in frontend package: ${label}`)
  }
  const targetRuntime = /(?:frontend|adapter|context|remote|openpencil|lark)/iu.test(root)
  if (targetRuntime && /from\s+['"]@deepseek-ai\/dsh-(?:agent|session)(?:\/[^'"]*)?['"]/u.test(source)) {
    violate('architecture', 'ARCH_DOMAIN_OBJECT_IMPORT', `Agent or Session package imported across the renderer-neutral boundary: ${label}`)
  }
  if (targetRuntime && /(?:session\.events|foldSessionEvents|applySessionEvent)/u.test(source)) {
    violate('architecture', 'ARCH_SESSION_EVENT_FOLDING', `frontend package appears to fold Harness session events: ${label}`)
  }
}

const lifecycle = files.some(file => /ctx\.effect|\.dispose\(|\bunload\b|\.register\(|\.subscribe\(/u.test(readFileSync(file, 'utf8')))
if (pluginEntries.length > 0 && !lifecycle) violate('lifecycle', 'LIFECYCLE_OWNERSHIP_MISSING', 'plugin entry has no observable Fiber lifecycle or registry ownership marker')

const groups = { package: 0, architecture: 0, lifecycle: 0 }
for (const violation of violations) groups[violation.group] += 1
const report = { package: packageName, root, valid: violations.length === 0, files: files.length, lifecycle, groups, violations }
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.valid ? 0 : 1
