// Shared bootstrap for the smoke scripts (D48): dsh discovery and version
// alignment, the throwaway-profile install chain, and output cleaning.
// Both smoke-happy.mjs (CI, pipe stdio) and smoke-pty.mjs (manual, real
// pseudo-terminal) boot the same real process through these helpers.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('..', import.meta.url))

/** The harness version Blue pins (S34 lesson: the smoke enforces it). */
export const harnessLine = /HARNESS_LINE = '([^']+)'/.exec(
  readFileSync(join(root, 'packages/interaction/src/session-commands.ts'), 'utf8'),
)?.[1]

/** dsh discovery: $DSH_BIN, else PATH, else the workspace devDependency. */
export function resolveDshBin() {
  if (process.env.DSH_BIN !== undefined && process.env.DSH_BIN !== '') return process.env.DSH_BIN
  const which = spawnSync('sh', ['-c', 'command -v dsh'], { encoding: 'utf8' })
  if (which.status === 0 && which.stdout.trim() !== '') return which.stdout.trim()
  const local = join(root, 'node_modules/.bin/dsh')
  if (existsSync(local)) return local
  console.error('FAIL: no dsh on PATH and no local devDependency — set DSH_BIN or pnpm install')
  process.exit(1)
}

/** Refuse to boot against a CLI that drifted off Blue's pinned harness line. */
export function assertDshVersion(dshBin) {
  if (harnessLine === undefined) {
    console.error('FAIL: HARNESS_LINE pin not found in packages/interaction/src/session-commands.ts')
    process.exit(1)
  }
  const version = spawnSync(dshBin, ['--version'], { encoding: 'utf8' })
  const out = `${version.stdout ?? ''}${version.stderr ?? ''}`
  if (!out.includes(harnessLine)) {
    console.error(`FAIL: dsh version mismatch — expected ${harnessLine}, got: ${out.trim() || '(no output)'}`)
    console.error(`      fix: pnpm add -g @deepseek-ai/dsh@${harnessLine} or point DSH_BIN at it`)
    process.exit(1)
  }
}

/**
 * A throwaway home with the Blue profile installed: builds the workspace,
 * link-installs the five packages via install-dev.sh, and isolates the
 * profile tree, the harness home, and pi-tui's log directory (pi-crash.log
 * and blue-overflow.log) under one temp root. The temp-HOME pnpm posture
 * (no purge prompts, no prepare re-builds, no frozen-lockfile refusal
 * against ensure-loader-entries' additions) rides along.
 * @returns the temp home path and an env carrying the isolation.
 */
export function installIntoThrowawayProfile(dshBin, profile) {
  if (!existsSync(join(root, 'packages/bundle/blue/lib/index.js'))) {
    console.error('FAIL: packages/bundle/blue/lib/index.js missing — run pnpm build first')
    process.exit(1)
  }

  const home = mkdtempSync(join(tmpdir(), 'blue-smoke-'))
  const dshHome = join(home, '.dsh')
  const piAgent = join(home, 'pi-agent')
  mkdirSync(join(home, '.config/pnpm'), { recursive: true })
  writeFileSync(join(home, '.config/pnpm/config.yaml'), [
    'confirmModulesPurge: false',
    'ignoreScripts: true',
    '',
  ].join('\n'))
  const envFor = (extra = {}) => ({
    ...process.env,
    HOME: home,
    DSH_HOME: dshHome,
    PI_CODING_AGENT_DIR: piAgent,
    ...extra,
  })

  console.log(`==> Installing Blue into throwaway profile '${profile}'`)
  const install = spawnSync('bash', [join(root, 'script/install-dev.sh')], {
    encoding: 'utf8',
    env: envFor({ DSH_BIN: dshBin, PROFILE: profile, CI: 'true', PROFILE_INSTALL_FLAGS: '--no-frozen-lockfile' }),
    timeout: 300_000,
  })
  if (install.status !== 0) {
    console.error('FAIL: install-dev.sh failed')
    console.error((install.stdout ?? '').slice(-2000))
    console.error((install.stderr ?? '').slice(-2000))
    process.exit(1)
  }

  // install-dev's workspace build ran under the temp HOME; its pnpm
  // auto-check leaves the worktree's deps-status dirty under that config,
  // which makes later local pnpm commands refuse with a no-TTY purge
  // prompt. Refresh the status under the ambient environment.
  spawnSync('pnpm', ['install', '--config.confirmModulesPurge=false'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  })

  return { home, dshHome, piAgent, envFor }
}

/** Drop writer-level control wrappers and ANSI so content asserts read rows. */
export function cleanOutput(value) {
  return value
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\]8;;[^\x07]*\x07/g, '')
    .replace(/\r/g, '')
}

/** Remove the throwaway home; register on process exit so failures clean up too. */
export function registerCleanup(home) {
  process.on('exit', () => {
    rmSync(home, { recursive: true, force: true })
  })
}
