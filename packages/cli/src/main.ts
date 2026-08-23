/**
 * The launcher's main flow (S37, D50 decision 4): answer `-V` from the
 * shell's own manifests (shell · Blue pin · harness line, one line),
 * resolve the nested host, calibrate the `blue` profile on the boot
 * surface, then exec the host with inherited stdio and propagate the
 * child's exit code. Every failure is one line plus a pointer — the
 * bootstrap contract — and a non-zero exit.
 *
 * @module @dsh-blue/blue-cli/main
 */

import { fileURLToPath } from 'node:url'
import { calibrate } from './calibrate.ts'
import { cliInternals } from './internals.ts'
import { nestedDsh } from './nested.ts'
import { translateArgv } from './translate.ts'

/**
 * The marker the shell's children carry: the app's help text and exit
 * epitaph rebrand from `dsh --profile blue` to `blue` when it is `blue`
 * (the S37 seam in blue-app).
 */
const LAUNCHER_ENV: Record<string, string> = { BLUE_LAUNCHER: 'blue' }

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
      cliInternals.stderr(`blue: bootstrap failed — ${outcome.reason}\n  manual: dsh plugin --profile blue add @dsh-blue/blue@${version}\n`)
      cliInternals.exit(1)
      return
    }
    if (outcome.action === 'installed') {
      cliInternals.stderr(`blue: installed @dsh-blue/blue@${version} into profile 'blue'\n`)
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
