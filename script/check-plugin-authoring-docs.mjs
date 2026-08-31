/**
 * P5 drift gate for the author skill, bilingual Website task guide, and the
 * machine catalog emitted by the built published CLI.
 *
 * @module script/check-plugin-authoring-docs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const website = join(root, 'website')
const zhRoot = join(website, 'plugins')
const enRoot = join(website, 'en', 'plugins')
const problems = []
const names = directory => readdirSync(directory).filter(name => name.endsWith('.md')).sort()
const zhNames = names(zhRoot)
const enNames = names(enRoot)
if (JSON.stringify(zhNames) !== JSON.stringify(enNames)) problems.push('Chinese/English plugin guide file sets differ')

const catalog = JSON.parse(execFileSync(process.execPath, [join(root, 'packages/plugin-kit/lib/bin.js'), 'catalog', '--json'], { encoding: 'utf8' }))
for (const relative of ['plugins/index.md', 'en/plugins/index.md']) {
  const source = readFileSync(join(website, relative), 'utf8')
  for (const capability of catalog.capabilities.map(value => value.name)) {
    if (!source.includes(`\`${capability}\``)) problems.push(`${relative} does not name catalog capability ${capability}`)
  }
}

for (const relative of ['plugins/quickstart.md', 'plugins/testing.md', 'plugins/creative-mode.md', 'en/plugins/quickstart.md', 'en/plugins/testing.md', 'en/plugins/creative-mode.md']) {
  const source = readFileSync(join(website, relative), 'utf8')
  for (const command of ['catalog --json', 'create', 'validate', 'conformance']) {
    if (!source.includes(command)) problems.push(`${relative} does not cover author command ${command}`)
  }
  if (/P5 (?:will|才会|尚未|not shipped)|no-clone command belongs to P5|免克隆命令属于 P5/u.test(source)) {
    problems.push(`${relative} still describes P5 authoring as pending`)
  }
}

const skillRoot = join(root, 'packages/bundle/blue/presets/blue-cordis/skills/blue-plugin-development')
const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
const evals = JSON.parse(readFileSync(join(skillRoot, 'evals.json'), 'utf8'))
for (const command of ['catalog --json', 'create', 'validate', 'conformance']) {
  if (!skill.includes(command)) problems.push(`author skill does not use ${command}`)
}
if (!Array.isArray(evals.cases) || evals.cases.length < 4) problems.push('author skill has fewer than four realistic eval cases')
for (const id of ['accepted-new-local-plugin', 'existing-harness-plugin-entry', 'missing-capability', 'accepted-does-not-authorize-publish']) {
  if (!evals.cases?.some(value => value.id === id)) problems.push(`author skill eval is missing ${id}`)
}

for (const page of [...zhNames.map(name => join(zhRoot, name)), ...enNames.map(name => join(enRoot, name))]) {
  const source = readFileSync(page, 'utf8')
  for (const match of source.matchAll(/\]\((\/(?:en\/)?plugins\/[^)#]+)(?:#[^)]+)?\)/g)) {
    const route = match[1]
    const path = join(website, route.replace(/^\//, '') + (route.endsWith('/') ? 'index.md' : '.md'))
    if (!existsSync(path)) problems.push(`${page.slice(root.length + 1)} has dead plugin-guide link ${route}`)
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`author docs: ${problem}`)
  process.exit(1)
}
console.log(`author docs: ${zhNames.length} bilingual pages, ${catalog.capabilities.length} catalog capabilities, ${evals.cases.length} skill evals`)
