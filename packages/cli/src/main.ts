/**
 * The launcher's main flow (S37, D50 decision 4): answer `-V` from the
 * shell's own manifests (shell · Blue pin · harness line, one line),
 * resolve the nested host, calibrate the `blue` profile on the boot
 * surface, then exec the host with inherited stdio and propagate the
 * child's exit code. Every failure is one verdict line, an optional
 * bounded output tail, and a manual pointer — the bootstrap contract's
 * failure form (D56 extends D50④) — and a non-zero exit.
 *
 * @module @dsh-blue/blue-cli/main
 */

import { fileURLToPath } from 'node:url'
import { calibrate } from './calibrate.ts'
import type { CalibrationOutcome } from './calibrate.ts'
import { cliInternals } from './internals.ts'
import { nestedDsh } from './nested.ts'
import { translateArgv } from './translate.ts'

/**
 * The marker the shell's children carry: the app's help text and exit
 * epitaph rebrand from `dsh --profile blue` to `blue` when it is `blue`
 * (the S37 seam in blue-app).
 */
const LAUNCHER_ENV: Record<string, string> = { BLUE_LAUNCHER: 'blue' }

/** The failed half of `CalibrationOutcome` — the `manualLine` input shape. */
type FailedOutcome = Extract<CalibrationOutcome, { action: 'failed' }>

/**
 * The manual pointer per failure class (D56): every line must be runnable by
 * the failing audience — a fresh npm-shell user has no global `dsh` on PATH,
 * so the bare plugin command retired from the failure output; the global-dsh
 * form stays as the parenthesized escape hatch on the generic classes.
 * @param outcome - the failed calibration.
 * @param version - the shell's own version (the Blue pin).
 * @returns the one manual line.
 */
function manualLine(outcome: FailedOutcome, version: string): string {
  if (outcome.kind === 'pnpm-missing') return 'npm i -g pnpm (or: corepack enable pnpm), then re-run blue'
  if (outcome.kind === 'timeout') return 're-run blue — downloaded packages are cached and the install resumes'
  return `fix the cause and re-run blue (with a global dsh: dsh plugin --profile blue add @dsh-blue/blue@${version})`
}

/**
 * Run one invocation to process exit.
 * @param argv - the shell's arguments (`process.argv.slice(2)` shape).
 */
export async function main(argv: readonly string[]): Promise<void> {
  const translation = translateArgv(argv)
  const host = nestedDsh()
  if (translation.kind === 'version') {
    const version = shellVersion()
    cliInternals.stdout(`blue ${version} (Blue @dsh-blue/blue@${version} · harness @deepseek-ai/dsh@${host.version ?? 'not installed'})\n`)
    return
  }
  if (host.binJs === undefined) {
    cliInternals.stderr('blue: the pinned @deepseek-ai/dsh host is missing — reinstall @dsh-blue/blue-cli\n')
    cliInternals.exit(1)
    return
  }
  if (translation.kind === 'boot') {
    const version = shellVersion()
    const outcome = await calibrate({ version, dshBinJs: host.binJs })
    if (outcome.action === 'failed') {
      cliInternals.stderr([
        `blue: bootstrap failed — ${outcome.reason}`,
        ...(outcome.detail ?? []).map(line => `  ${line}`),
        `  manual: ${manualLine(outcome, version)}`,
      ].join('\n') + '\n')
      cliInternals.exit(1)
      return
    }
    if (outcome.action === 'installed') {
      cliInternals.stderr(`blue: installed @dsh-blue/blue@${version} into profile 'blue'\n`)
    } else if (outcome.action === 'ahead') {
      // /update (or a manual add) advanced the profile past this shell —
      // boot it as-is; reinstalling the shell is how the pair advances.
      cliInternals.stderr(`blue: profile 'blue' is at @dsh-blue/blue@${outcome.installed}, ahead of this shell (${version}) — reinstall to advance: npm i -g @dsh-blue/blue-cli@rc\n`)
    } else if (outcome.action === 'link-lane') {
      cliInternals.stderr(`blue: profile 'blue' is a dev ${outcome.spec.split(':', 1)[0]} lane — calibration skipped\n`)
    }
  }
  const child = await cliInternals.spawnInherit(cliInternals.execPath, [host.binJs, ...translation.dshArgs], { env: LAUNCHER_ENV })
  cliInternals.exit(child.code ?? 1)
}

/**
 * The shell's own manifest version — the Blue pin, equal by the
 * version.spec lockstep. `'unknown'` only when the manifest is broken
 * (the install's own failure then names it precisely).
 */
export function shellVersion(): string {
  const text = cliInternals.readTextFile(fileURLToPath(new URL('../package.json', import.meta.url)))
  if (text === undefined) return 'unknown'
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === 'string' ? version : 'unknown'
  } catch {
    return 'unknown'
  }
}
