// Harness drift detector: watches the npm `next` dist-tags of every
// @deepseek-ai/dsh-* package this tree pins and classifies the tree's
// harness line against the registry.
//
// Division of labour: packages/transcript/tests/version.spec.ts owns
// INTERNAL consistency (every pin in this repo agrees with HARNESS_LINE);
// this script owns EXTERNAL freshness (that line vs the registry `next`
// tag — the rc line rides `next`; `latest` lags on old public lines and is
// reported for information only). The spec cannot see the registry; this
// script never edits a file. The bump itself is performed by the headless
// agent (script/harness-drift-task.mjs) and gated deterministically by the
// harness-drift workflow.
//
// Exit codes are the workflow contract:
//    0  SYNC        every watched package's next == the pinned line
//   10  BUMP_READY  every next == V, same major.minor, V > pinned -> auto bump
//   20  MINOR_JUMP  every next == V but crossing minor/major, or rolled back
//                  (R1 ruling: never chase jumps past the minor) -> issue
//   30  PARTIAL     next values disagree with each other -> wait, never mix
//                  (version.spec forbids a split tree, so a bump ships only
//                  when the whole watched set moves together)
//    1  ERROR       registry lookups failed after retries — the monitor is
//                  dead and must be red, not silently green.
//
// Run: node script/harness-drift.mjs   (check-only; there is no apply mode
// here — rewriting is the agent's job)

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessLine } from './smoke-lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Every workspace manifest whose dsh dependency names join the watched set. */
function manifests() {
  const found = ['package.json']
  const visit = (directory, prefix, depth) => {
    if (depth > 2) return
    const packageFile = join(directory, 'package.json')
    if (existsSync(packageFile)) {
      found.push(join(prefix, 'package.json'))
      return
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') visit(join(directory, entry.name), join(prefix, entry.name), depth + 1)
    }
  }
  visit(join(root, 'packages'), 'packages', 0)
  return found
}

/** Every @deepseek-ai/dsh-* package name the tree references anywhere. */
export function watchedPackages() {
  const names = new Set()
  for (const rel of manifests()) {
    const pkg = JSON.parse(readFileSync(join(root, rel), 'utf8'))
    for (const table of [pkg.dependencies, pkg.peerDependencies, pkg.devDependencies]) {
      for (const name of Object.keys(table ?? {})) {
        if (name.startsWith('@deepseek-ai/dsh-')) names.add(name)
      }
    }
  }
  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  for (const match of workspace.matchAll(/'(@deepseek-ai\/dsh-[a-z-]+)@[^']+'/g)) {
    names.add(match[1])
  }
  names.add('@deepseek-ai/dsh') // the CLI itself (watched for its own next tag)
  return [...names].sort()
}

/** Parse `MAJOR.MINOR.PATCH[-prerelease]`; undefined on a foreign shape. */
export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value)
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Semver ordering: core fields numerically, then release > prerelease. */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === undefined || right === undefined) return a === b ? 0 : a < b ? -1 : 1
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i += 1) {
    const l = left.prerelease[i]
    const r = right.prerelease[i]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = /^\d+$/.test(l) ? Number(l) : undefined
    const rn = /^\d+$/.test(r) ? Number(r) : undefined
    if (ln !== undefined && rn !== undefined) {
      if (ln !== rn) return ln < rn ? -1 : 1
    } else if (ln !== undefined) {
      return -1
    } else if (rn !== undefined) {
      return 1
    } else if (l !== r) {
      return l < r ? -1 : 1
    }
  }
  return 0
}

/**
 * The state machine over the observed tags. Pure: the workflow maps the
 * exit code, local checks can feed fixtures directly.
 */
export function classify(current, tags) {
  if (tags.some(tag => tag.next === undefined)) return { state: 'PARTIAL' }
  const values = new Set(tags.map(tag => tag.next))
  if (values.size > 1) return { state: 'PARTIAL' }
  const target = [...values][0]
  if (target === current) return { state: 'SYNC' }
  const sameLine = parseVersion(target)?.major === parseVersion(current)?.major
    && parseVersion(target)?.minor === parseVersion(current)?.minor
  const forward = compareVersions(target, current) > 0
  if (sameLine && forward) return { state: 'BUMP_READY', target }
  return { state: 'MINOR_JUMP', target }
}

/** npm view with bounded retry; rejects when the registry stays silent. */
async function viewTags(name) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 1500 : 4000))
    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile('npm', ['view', name, 'dist-tags', '--json'], { timeout: 15_000 }, (error, out) => {
          if (error !== null) reject(error)
          else resolve(out)
        })
      })
      const tags = JSON.parse(stdout)
      return { name, next: tags.next, latest: tags.latest }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`registry lookup failed for ${name}`)
}

/** Bounded-concurrency map over the watched set. */
async function queryAll(names) {
  const results = []
  let cursor = 0
  async function worker() {
    while (cursor < names.length) {
      const name = names[cursor]
      cursor += 1
      results.push(await viewTags(name))
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, names.length) }, worker))
  return results.sort((a, b) => a.name.localeCompare(b.name))
}

const EXIT_CODES = { SYNC: 0, BUMP_READY: 10, MINOR_JUMP: 20, PARTIAL: 30 }

async function main() {
  if (harnessLine === undefined) {
    console.error('harness-drift: HARNESS_LINE constant not found in packages/interaction/src/session-commands.ts')
    process.exit(1)
  }
  const names = watchedPackages()
  console.log(`harness-drift: pinned line ${harnessLine}, watching ${names.length} packages' next tags`)
  let tags
  try {
    tags = await queryAll(names)
  } catch (error) {
    console.error(`harness-drift: ERROR — ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  const { state, target } = classify(harnessLine, tags)
  const lagging = tags.filter(tag => tag.next !== harnessLine)
  const summary = [
    `### harness-drift: ${state}`,
    '',
    `- pinned line: \`${harnessLine}\``,
    target === undefined ? '' : `- registry next: \`${target}\``,
    `- watched: ${tags.length} packages (${lagging.length} off-line)`,
    '',
    '| package | next | latest |',
    '|---|---|---|',
    ...tags.map(tag => `| \`${tag.name}\` | \`${tag.next ?? '—'}\` | \`${tag.latest ?? '—'}\` |`),
  ].join('\n')
  console.log(summary)
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath !== undefined) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(summaryPath, `${summary}\n`)
  }
  if (target !== undefined) console.log(`DRIFT_TARGET=${target}`)
  console.log(`DRIFT_CURRENT=${harnessLine}`)
  process.exit(EXIT_CODES[state])
}

// CLI entry only when executed directly (the classify/parse exports stay
// importable for fixtures without side effects).
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
