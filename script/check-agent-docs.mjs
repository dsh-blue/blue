#!/usr/bin/env node
/** Check durable agent instructions and shipped preset skills for mechanically detectable drift. @module script/check-agent-docs */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILD_PACKAGE_DIRS } from './package-contract.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function walk(root, name) {
  const found = []
  if (!existsSync(root)) return found
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'lib') continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) found.push(...walk(full, name))
    else if (entry.name === name) found.push(full)
  }
  return found
}

function linkTarget(sourceFile, raw) {
  const target = raw.replace(/^<|>$/gu, '').split('#', 1)[0]
  if (target === '' || /^(?:[a-z]+:|\/)/iu.test(target)) return undefined
  return resolve(dirname(sourceFile), decodeURIComponent(target))
}

/** Audit one repository root. Options make the pure checker fixture-friendly. */
export function auditAgentDocs(root, options = {}) {
  const problems = []
  const packageDirs = options.packageDirs ?? BUILD_PACKAGE_DIRS
  const checkPreset = options.checkPreset ?? true
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const scripts = new Set(Object.keys(rootManifest.scripts ?? {}))
  const agentFiles = walk(root, 'AGENTS.md')
  const packageVersions = new Set(packageDirs.map(packageDir => {
    const manifest = JSON.parse(readFileSync(join(root, packageDir, 'package.json'), 'utf8'))
    return manifest.version
  }))
  const protocolFile = join(root, 'packages', 'api', 'src', 'manifest-v1.generated.ts')
  if (existsSync(protocolFile)) {
    const protocolSource = readFileSync(protocolFile, 'utf8')
    const protocolVersion = /BLUE_PLUGIN_PROTOCOL_VERSION = ["']([^"']+)/u.exec(protocolSource)?.[1]
    if (protocolVersion !== undefined) packageVersions.add(protocolVersion)
  }
  const harnessSource = join(root, 'packages', 'interaction', 'src', 'session-commands.ts')
  if (existsSync(harnessSource)) {
    const harnessVersion = /HARNESS_LINE = '([^']+)'/u.exec(readFileSync(harnessSource, 'utf8'))?.[1]
    if (harnessVersion !== undefined) packageVersions.add(harnessVersion)
  }
  for (const version of options.allowedVersions ?? []) packageVersions.add(version)

  const projectSkills = join(root, '.agents', 'skills')
  if (existsSync(projectSkills) && walk(projectSkills, 'SKILL.md').length > 0) {
    problems.push('.agents/skills must stay empty; Blue maintainer guidance belongs in AGENTS.md and deterministic checks')
  }
  if (existsSync(join(root, 'docs', 'skills'))) problems.push('docs/skills is a retired mirror of removed project skills')
  if (existsSync(join(root, 'docs', 'blue-skills-plan.md'))) problems.push('docs/blue-skills-plan.md must live under docs/history after skill consolidation')

  for (const packageDir of packageDirs) {
    if (!existsSync(join(root, packageDir, 'AGENTS.md'))) problems.push(`${packageDir} has no AGENTS.md`)
  }
  for (const file of agentFiles) {
    const source = readFileSync(file, 'utf8')
    if (/^## Verification status$/mu.test(source) || /\bAs of \d{4}-\d{2}-\d{2}\b/u.test(source) || /\b\d+ passed\b/u.test(source)) {
      problems.push(`${file.slice(root.length + 1)} contains an expiring verification snapshot`)
    }
    if (/\b\d+ Blue-owned rows\b/u.test(source)) problems.push(`${file.slice(root.length + 1)} duplicates the bundle row count`)
    if (/current or previous exact line|previous supported Harness line/iu.test(source)) {
      problems.push(`${file.slice(root.length + 1)} describes a retired multi-line Harness gate`)
    }
    for (const version of new Set(source.match(/\b\d+\.\d+\.\d+-(?:alpha|beta|rc)\.\d+\b/gu) ?? [])) {
      if (!packageVersions.has(version)) problems.push(`${file.slice(root.length + 1)} references stale prerelease ${version}`)
    }
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = linkTarget(file, match[1])
      if (target !== undefined && !existsSync(target)) problems.push(`${file.slice(root.length + 1)} has a dead link to ${match[1]}`)
    }
    for (const match of source.matchAll(/\bpnpm run ([a-z0-9:_-]+)/gu)) {
      if (!scripts.has(match[1])) problems.push(`${file.slice(root.length + 1)} references missing script ${match[1]}`)
    }
  }

  const rootAgent = readFileSync(join(root, 'AGENTS.md'), 'utf8')
  for (const command of ['verify:changed', 'verify:full', 'check:agent-docs']) {
    if (!rootAgent.includes(command)) problems.push(`AGENTS.md does not route maintainers to ${command}`)
  }

  if (checkPreset) {
    const presetRoot = join(root, 'packages', 'bundle', 'blue', 'presets', 'blue-cordis')
    const skillRoot = join(presetRoot, 'skills')
    const expected = ['blue-plugin-development', 'cordis-plugin-development', 'editing-cordis-compositions']
    const actual = readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`blue-cordis skills differ: ${actual.join(', ')}`)
    for (const skill of expected) {
      const source = readFileSync(join(skillRoot, skill, 'SKILL.md'), 'utf8')
      if (!new RegExp(`^name: ${skill}$`, 'mu').test(source)) problems.push(`${skill} frontmatter name differs from its directory`)
    }
    const composition = readFileSync(join(presetRoot, 'agent.cordis.yml'), 'utf8')
    if (/blue-plugin-development[^\n]*changing Blue code/iu.test(composition)) {
      problems.push('blue-cordis routes Blue source changes to the external plugin author skill')
    }
    if (!composition.includes('Do not load either plugin-development skill')) {
      problems.push('blue-cordis does not exclude ordinary and Blue-repository work from plugin skills')
    }
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = auditAgentDocs(ROOT)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`agent docs: ${problem}`)
    process.exit(1)
  }
  console.log(`agent docs: ${walk(ROOT, 'AGENTS.md').length} instruction files and Blue preset skills are consistent`)
}
