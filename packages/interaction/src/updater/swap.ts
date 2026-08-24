/**
 * The swap executor (D52): snapshot → install → verify → smoke →
 * auto-rollback. One function the `/update` panel drives through
 * progress events; every lesson from the release history is a step
 * here — the snapshot exists because rollback must not trust `^`
 * ranges (the repair recipe), the post-install verify exists because a
 * half-updated tree is the Frankenstein state, and the two-layer smoke
 * exists because D51 proved a green pipeline can still ship a boot
 * crash: layer A imports every patch entry the profile's bundle names
 * plus its declared dsh runtime dependencies (exactly the D51 failure
 * class — missing hash-chunks, an absent bridge dep), layer B boots the
 * real CLI over pipes (the
 * `smoke-happy.mjs` shape — marker, `/quit`, exit 0) with no pty, no
 * credentials, no model call.
 *
 * @module @dsh-blue/blue-interaction/updater/swap
 */

import { join } from 'node:path'
import { cleanOutput, updaterInternals, type InteractiveChild, type SpawnOutcome } from './io.ts'
import { appendUpdateLog, backupDir, readProfileFacts, restoreSnapshot, snapshotProfile } from './profile.ts'
import { repairRecipe } from './preflight.ts'
import { compareVersions, VERSION_FLOOR } from './version.ts'

/** The install budget — 20 min; the calibration install's parity (D55), slow networks measured at 18 min for 455 packages. */
export const INSTALL_TIMEOUT_MS = 1_200_000

/** The import sweep's budget (module loading only). */
const IMPORT_SMOKE_TIMEOUT_MS = 30_000

/** The boot smoke's marker budget, quit budget, and alive-degraded wait. */
const BOOT_MARKER_TIMEOUT_MS = 40_000
const BOOT_QUIT_TIMEOUT_MS = 20_000
const BOOT_ALIVE_DEGRADED_MS = 15_000

/** The poll cadence for marker watching and deadline loops. */
const POLL_MS = 250

/**
 * The package entries the import sweep covers (D52④): every `name:` row
 * of the installed bundle's `cordis.patch.yml` — Blue packages and the
 * inserted dsh runtime rows alike — PLUS the bundle manifest's declared
 * `@deepseek-ai/*` runtime dependencies (they are real installed deps of
 * the profile). This is the set whose missing files the D51 gate must
 * catch.
 * @param root - the profile workspace root.
 * @returns the package specs to import, deduplicated.
 */
export function patchEntrySpecs(root: string): string[] {
  const patchText = updaterInternals.readTextFile(join(root, 'node_modules', '@dsh-blue', 'blue', 'cordis.patch.yml'))
  const specs: string[] = []
  if (patchText !== undefined) {
    for (const match of patchText.matchAll(/name:\s*'([^']+)'/g)) {
      // The regex guarantees the group, so the non-null assertion is safe.
      const spec = match[1]!
      if (specs.includes(spec)) continue
      specs.push(spec)
    }
  }
  for (const dep of declaredRuntimeDeps(root)) {
    if (!specs.includes(dep)) specs.push(dep)
  }
  return specs
}

/**
 * The bundle manifest's declared `@deepseek-ai/*` runtime dependencies —
 * the pinned dsh packages the profile genuinely installs, so the sweep
 * treats their absence as a real failure (undeclared `@deepseek-ai/`
 * targets, provided by the host at boot, stay exempt).
 * @param root - the profile workspace root.
 * @returns the declared dependency names.
 */
export function declaredRuntimeDeps(root: string): string[] {
  const text = updaterInternals.readTextFile(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'))
  if (text === undefined) return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return []
    const deps = (parsed as Record<string, unknown>).dependencies
    if (typeof deps !== 'object' || deps === null) return []
    return Object.keys(deps as Record<string, unknown>).filter(name => name.startsWith('@deepseek-ai/'))
  } catch {
    return []
  }
}

/** The steps the progress panel renders, in execution order. */
export type SwapStep = 'snapshot' | 'install' | 'verify' | 'smoke-imports' | 'smoke-boot' | 'rollback' | 'done'

/** One progress event for the panel. */
export interface SwapProgress {
  readonly step: SwapStep
  readonly state: 'start' | 'ok' | 'fail'
}

/** What a swap concluded. */
export interface SwapOutcome {
  /** `success`, or how the failure was handled. */
  readonly kind: 'success' | 'rolled-back' | 'failed-no-rollback' | 'rollback-incomplete'
  readonly fromVersion: string
  readonly toVersion: string
  /** The user-facing summary; the log path rides inside. */
  readonly message: string
  /** Where the full log lives. */
  readonly logPath: string
}

/** Everything the executor needs. */
export interface SwapInput {
  /** The profile workspace root. */
  readonly root: string
  /** The profile name (`dsh plugin --profile <name>`). */
  readonly profile: string
  /** The dsh CLI binary. */
  readonly dshBin: string
  /** The version the profile runs now. */
  readonly fromVersion: string
  /** The version to install. */
  readonly toVersion: string
  /** The target release's lockstep set (see `bundleSetNames`). */
  readonly packageNames: readonly string[]
  /**
   * The FROM release's lockstep set — the rollback reinstall must ask the
   * registry for the old version's own members (the set GROWS across
   * releases: blue-api joined at rc.3, so the target set at the
   * from-version would request packages that never existed → ETARGET).
   * Derived by the caller from `releaseFacts(packument, fromVersion)`;
   * absent falls back to `packageNames` (the pre-hardening behavior).
   */
  readonly rollbackNames?: readonly string[]
  /**
   * The boot marker (the live default model string); absent degrades
   * the boot smoke to an alive-without-crash judgment.
   */
  readonly bootMarker?: string
  /** Progress sink for the panel. */
  readonly onProgress?: (progress: SwapProgress) => void
}

/** Log one line to the profile's update log. */
function logLine(root: string, line: string): void {
  appendUpdateLog(root, line)
}

/** Emit a progress event when the caller listens. */
function progress(input: SwapInput, step: SwapStep, state: 'start' | 'ok' | 'fail'): void {
  input.onProgress?.({ step, state })
}

/** The last few lines of an output blob, for failure classification. */
function tail(text: string): string {
  return text.trim().split('\n').slice(-12).join('\n')
}

/**
 * Translate a failed install's log tail into a user-facing message.
 * The cooldown class exists because pnpm's `minimumReleaseAge` refuses
 * exact-version installs of fresh releases (the R1 finding) — the
 * pre-flight forecasts it, and this catches what slips past.
 * @param logTail - the last lines of the install output.
 * @returns the classified message.
 */
export function classifyInstallFailure(logTail: string): string {
  if (/minimumReleaseAge|minimum-release-age|release age|too recently published/i.test(logTail)) {
    return 'pnpm refused the install: the release is inside the minimumReleaseAge cooldown window — retry after the window passes (the pre-flight prints the ETA)'
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|network/i.test(logTail)) {
    return 'the registry was unreachable — check the network (or the npmrc mirror) and retry'
  }
  if (/ETARGET|404|Not Found/i.test(logTail)) {
    return 'the registry does not serve this version — it may have been unpublished; pick another with /update <version>'
  }
  if (/EACCES|EPERM|permission denied/i.test(logTail)) {
    return 'the profile directory is not writable — fix permissions and retry'
  }
  const lastLine = logTail.trim().split('\n').pop()
  return `the install failed${lastLine === undefined || lastLine === '' ? '' : `: ${lastLine}`}`
}

/** The import-sweep child script: resolve and import every spec. */
export function importSweepScript(specs: readonly string[], declared: readonly string[]): string {
  return [
    "const { createRequire } = await import('node:module');",
    "const { realpathSync } = await import('node:fs');",
    "const { join } = await import('node:path');",
    // Windows-safe: the ESM loader rejects a bare `C:\...` specifier.
    "const { pathToFileURL } = await import('node:url');",
    // Resolution anchors on the BUNDLE's manifest, realpathed: pnpm's
    // isolated linker puts the sibling libraries beside the bundle in the
    // virtual store (invisible from the profile root), and createRequire
    // does not follow the top-level symlink on its own.
    "const manifest = realpathSync(join(process.cwd(), 'node_modules', '@dsh-blue', 'blue', 'package.json'));",
    'const req = createRequire(manifest);',
    `const specs = ${JSON.stringify(specs)};`,
    `const declared = ${JSON.stringify(declared)};`,
    'for (const spec of specs) {',
    '  await import(pathToFileURL(req.resolve(spec)).href).catch(error => {',
    // A DECLARED dsh runtime dep is installed by the profile — its absence
    // is a packaging defect and stays fatal. Only an UNDECLARED
    // @deepseek-ai/ target (a peer the running dsh host provides at boot,
    // like cordis) is exempt: a bare import misses those in hoisted
    // layouts and that is not a packaging defect. Everything else — a
    // @dsh-blue package, a hashed chunk file — is exactly the D51 class
    // this sweep exists to catch, and stays fatal.
    "    const message = String(error?.message ?? '');",
    "    const missing = error?.code === 'ERR_MODULE_NOT_FOUND' || message.includes('Cannot find');",
    "    const target = /'([^']+)'/.exec(message)?.[1] ?? '';",
    "    if (missing && target.startsWith('@deepseek-ai/') && !declared.some(dep => target === dep || target.startsWith(dep + '/'))) return;",
    '    throw error;',
    '  });',
    '}',
    '',
  ].join('\n')
}

/**
 * Smoke layer A — the import sweep: resolve and import every patch entry
 * from inside the profile workspace in a fresh Node. Catches exactly the
 * D51 class (missing tsdown hash-chunks, an absent bridge dependency)
 * with no terminal, no credentials, ~2s.
 * @param root - the profile workspace root.
 * @returns `true` when every entry resolved and imported.
 */
export async function importSweepSmoke(root: string): Promise<boolean> {
  const outcome = await updaterInternals.spawnOnce(
    process.execPath,
    ['--input-type=module', '-e', importSweepScript(patchEntrySpecs(root), declaredRuntimeDeps(root))],
    { cwd: root, timeoutMs: IMPORT_SMOKE_TIMEOUT_MS },
  )
  if (outcome.code === 0) return true
  logLine(root, `import sweep failed:\n${outcome.stderr}${outcome.stdout}`)
  return false
}

/**
 * Send the quit ladder — `/quit`, then a double Ctrl-C — and await the
 * child's exit within the budget.
 * @param child - the booted CLI child.
 * @param exited - its exit promise.
 * @returns the exit outcome, or `undefined` when it never exited.
 */
async function quitLadder(child: InteractiveChild, exited: Promise<SpawnOutcome>): Promise<SpawnOutcome | undefined> {
  child.write('/quit\r')
  const firstDeadline = updaterInternals.now() + BOOT_QUIT_TIMEOUT_MS
  while (updaterInternals.now() < firstDeadline) {
    const settled = await Promise.race([exited, updaterInternals.sleep(POLL_MS)])
    if (settled !== undefined) return settled
  }
  child.write('\x03')
  await updaterInternals.sleep(POLL_MS)
  child.write('\x03')
  const finalDeadline = updaterInternals.now() + BOOT_QUIT_TIMEOUT_MS
  while (updaterInternals.now() < finalDeadline) {
    const settled = await Promise.race([exited, updaterInternals.sleep(POLL_MS)])
    if (settled !== undefined) return settled
  }
  return undefined
}

/**
 * Smoke layer B — the pipe-stdio boot: launch the real CLI, wait for the
 * boot marker (the default model string the statusline carries — the
 * `smoke-happy.mjs` technique), then `/quit` and require exit 0. With no
 * marker the judgment degrades to alive-without-crash for the degraded
 * window. Every path ends with the child dead: the `finally` runs the
 * kill ladder even on success (a no-op on an exited child).
 * @param input - the swap input (dsh binary, profile, root).
 * @returns `true` when the boot passed its judgment.
 */
export async function bootSmoke(input: SwapInput): Promise<boolean> {
  const child = updaterInternals.spawnInteractive(
    input.dshBin,
    ['--profile', input.profile],
    { cwd: input.root, env: { NO_COLOR: '1', COLUMNS: '100', LINES: '30' } },
  )
  const exited = child.exited
  try {
    const startedAt = updaterInternals.now()
    // Wait phase: the marker, or the degraded alive window.
    for (;;) {
      const settled = await Promise.race([exited, updaterInternals.sleep(POLL_MS)])
      if (settled !== undefined) {
        logLine(input.root, `boot exited early (code ${settled.code ?? 'null'} signal ${settled.signal ?? 'null'}):\n${settled.stdout}${settled.stderr}`)
        return false
      }
      if (input.bootMarker !== undefined) {
        if (cleanOutput(child.output()).includes(input.bootMarker)) break
        if (updaterInternals.now() - startedAt >= BOOT_MARKER_TIMEOUT_MS) {
          logLine(input.root, 'boot marker never appeared within the budget')
          return false
        }
      } else if (updaterInternals.now() - startedAt >= BOOT_ALIVE_DEGRADED_MS) {
        logLine(input.root, 'no boot marker — degraded judgment: alive past the window')
        break
      }
    }
    const quit = await quitLadder(child, exited)
    if (quit === undefined) {
      logLine(input.root, 'boot never exited after the quit ladder')
      return false
    }
    if (quit.code === 0) return true
    logLine(input.root, `boot quit with code ${quit.code} signal ${quit.signal}`)
    return false
  } finally {
    child.kill()
    await exited
  }
}

/**
 * Perform the swap: snapshot, install the target as one exact-version
 * transaction (a DOWNGRADE installs the target release's full set — a
 * bundle-only spec would leave newer siblings behind, the D52 follow-up),
 * verify the set, run both smoke layers, and on any failure restore the
 * snapshot and reinstall the old full set by exact version (never below
 * the D51 floor — a user on rc.1 gets the manual repair recipe instead of
 * a rollback onto broken tarballs). A `pending.json` marker in the backup
 * dir brackets the swap: written after the snapshot, removed when the
 * swap settles (success or completed rollback); a process kill leaves it
 * for the boot check's interrupted-update warning.
 * @param input - the swap parameters.
 * @returns the outcome for the panel and notices.
 */
export async function performSwap(input: SwapInput): Promise<SwapOutcome> {
  const logPath = join(backupDir(input.root), 'update.log')
  const pendingPath = join(backupDir(input.root), 'pending.json')
  logLine(input.root, `=== update ${input.fromVersion} -> ${input.toVersion} (${new Date(updaterInternals.now()).toISOString()}) ===`)

  progress(input, 'snapshot', 'start')
  snapshotProfile(input.root, {
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    createdAt: updaterInternals.now(),
    files: [],
  })
  progress(input, 'snapshot', 'ok')
  updaterInternals.writeTextFile(pendingPath, `${JSON.stringify({
    from: input.fromVersion,
    to: input.toVersion,
    startedAt: updaterInternals.now(),
  }, null, 2)}\n`)

  progress(input, 'install', 'start')
  // A downgrade must pin every member of the target set: the bundle spec
  // alone never pulls the newer siblings back down.
  const installSpecs = compareVersions(input.toVersion, input.fromVersion) < 0
    ? input.packageNames.map(name => `${name}@${input.toVersion}`)
    : [`@dsh-blue/blue@${input.toVersion}`]
  const install = await updaterInternals.spawnOnce(
    input.dshBin,
    ['plugin', '--profile', input.profile, 'add', ...installSpecs],
    { cwd: input.root, timeoutMs: INSTALL_TIMEOUT_MS },
  )
  logLine(input.root, `$ dsh plugin --profile ${input.profile} add ${installSpecs.join(' ')}\n${install.stdout}${install.stderr}`)
  if (install.code !== 0) {
    progress(input, 'install', 'fail')
    const reason = classifyInstallFailure(tail(`${install.stdout}${install.stderr}`))
    logLine(input.root, `install failed: ${reason}`)
    return rollback(input, `install failed — ${reason}`, logPath, pendingPath)
  }
  progress(input, 'install', 'ok')

  progress(input, 'verify', 'start')
  if (!setIsOneVersion(input.root, input.packageNames, input.toVersion)) {
    progress(input, 'verify', 'fail')
    logLine(input.root, `post-install set check failed: ${JSON.stringify(readProfileFacts(input.root).installed)}`)
    return rollback(input, 'post-install set check failed — the tree is not one version', logPath, pendingPath)
  }
  progress(input, 'verify', 'ok')

  progress(input, 'smoke-imports', 'start')
  if (!await importSweepSmoke(input.root)) {
    progress(input, 'smoke-imports', 'fail')
    return rollback(input, 'import smoke failed — a patch entry does not load (the D51 class)', logPath, pendingPath)
  }
  progress(input, 'smoke-imports', 'ok')

  progress(input, 'smoke-boot', 'start')
  if (!await bootSmoke(input)) {
    progress(input, 'smoke-boot', 'fail')
    return rollback(input, 'boot smoke failed — the updated tree does not boot cleanly', logPath, pendingPath)
  }
  progress(input, 'smoke-boot', 'ok')

  progress(input, 'done', 'ok')
  updaterInternals.removeFile(pendingPath)
  logLine(input.root, `=== success: now at ${input.toVersion} (restart to apply) ===`)
  return {
    kind: 'success',
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    message: `updated ${input.fromVersion} → ${input.toVersion} · smoke passed · restart dsh to apply — this session keeps running ${input.fromVersion}`,
    logPath,
  }
}

/** Whether the discovered install of `names` is exactly one version. */
function setIsOneVersion(root: string, names: readonly string[], version: string): boolean {
  const facts = readProfileFacts(root)
  const versions = new Set(names.map(name => facts.installed[name]))
  return versions.size === 1 && versions.has(version)
}

/** The failure path: restore, reinstall the old set, re-verify, re-smoke, report. */
async function rollback(input: SwapInput, reason: string, logPath: string, pendingPath: string): Promise<SwapOutcome> {
  const names = input.rollbackNames ?? input.packageNames
  if (compareVersions(input.fromVersion, VERSION_FLOOR) < 0) {
    logLine(input.root, `rollback refused: ${input.fromVersion} predates the D51 floor ${VERSION_FLOOR}`)
    return {
      kind: 'failed-no-rollback',
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      message: `${reason}; rollback refused (${input.fromVersion} predates ${VERSION_FLOOR}) — ${repairRecipe(names, VERSION_FLOOR)}`,
      logPath,
    }
  }
  progress(input, 'rollback', 'start')
  logLine(input.root, `rolling back to ${input.fromVersion}: ${reason}`)
  restoreSnapshot(input.root)
  const specs = names.map(name => `${name}@${input.fromVersion}`)
  const reinstall = await updaterInternals.spawnOnce(
    input.dshBin,
    ['plugin', '--profile', input.profile, 'add', ...specs],
    { cwd: input.root, timeoutMs: INSTALL_TIMEOUT_MS },
  )
  logLine(input.root, `$ dsh plugin --profile ${input.profile} add ${specs.join(' ')}\n${reinstall.stdout}${reinstall.stderr}`)
  if (reinstall.code !== 0) {
    progress(input, 'rollback', 'fail')
    return {
      kind: 'rollback-incomplete',
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      message: `${reason}; rollback reinstall failed — ${classifyInstallFailure(tail(`${reinstall.stdout}${reinstall.stderr}`))}; manual repair:\n${repairRecipe(names, input.fromVersion)}`,
      logPath,
    }
  }
  // The reinstall can land a mixed tree exactly like the forward install
  // (the D52 follow-up class) — re-run the set check before the sweep.
  if (!setIsOneVersion(input.root, names, input.fromVersion)) {
    progress(input, 'rollback', 'fail')
    logLine(input.root, `post-rollback set check failed: ${JSON.stringify(readProfileFacts(input.root).installed)}`)
    return {
      kind: 'rollback-incomplete',
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      message: `${reason}; rolled back but the tree is not one version — manual repair:\n${repairRecipe(names, input.fromVersion)}`,
      logPath,
    }
  }
  if (!await importSweepSmoke(input.root)) {
    progress(input, 'rollback', 'fail')
    return {
      kind: 'rollback-incomplete',
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      message: `${reason}; rolled back but the import smoke still fails — manual repair:\n${repairRecipe(names, input.fromVersion)}`,
      logPath,
    }
  }
  progress(input, 'rollback', 'ok')
  updaterInternals.removeFile(pendingPath)
  logLine(input.root, `=== rolled back to ${input.fromVersion} ===`)
  return {
    kind: 'rolled-back',
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    message: `${reason}; rolled back to ${input.fromVersion} · smoke passed · log: ${logPath}`,
    logPath,
  }
}
