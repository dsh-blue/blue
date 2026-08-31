/**
 * Testable command dispatcher for the published Blue plugin author CLI.
 *
 * @module @dsh-blue/blue-plugin-kit/cli
 */

import { BLUE_CAPABILITY_CATALOG_V1 } from '@dsh-blue/blue-api/capabilities/v1'
import { BLUE_API_VERSION, BLUE_VERSION } from '@dsh-blue/blue-api'
import { valid } from 'semver'
import { createPluginPackage } from './create.ts'
import { BLUE_PLUGIN_HARNESS_LINE, BLUE_PLUGIN_SUPPORTED_HARNESS_LINES } from './index.ts'

/** Runtime programs shipped beside the compiled CLI entry. */
export type AuthorRuntime = 'validate' | 'conformance'

/** Process-independent effects used by {@link runBluePluginCli}. */
export interface BluePluginCliIo {
  readonly stdout: (value: string) => void
  readonly stderr: (value: string) => void
  readonly runRuntime: (name: AuthorRuntime, args: readonly string[]) => number
}

/** Canonical command help. */
export const BLUE_PLUGIN_USAGE = `Usage:
  blue-plugin create <directory> --name <npm-package-name>
  blue-plugin validate <package-directory>
  blue-plugin conformance <package-directory> [--harness-line <exact-version>]
  blue-plugin catalog --json
`

interface ParsedCreate {
  readonly directory?: string
  readonly packageName?: string
  readonly invalid: boolean
}

function parseCreate(args: readonly string[]): ParsedCreate {
  let directory: string | undefined
  let packageName: string | undefined
  let invalid = false
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!
    if (value === '--name') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('-')) invalid = true
      else { packageName = next; index += 1 }
    } else if (value.startsWith('--name=')) {
      packageName = value.slice('--name='.length)
      if (packageName.length === 0) invalid = true
    } else if (value.startsWith('-') || directory !== undefined) invalid = true
    else directory = value
  }
  return { ...(directory === undefined ? {} : { directory }), ...(packageName === undefined ? {} : { packageName }), invalid }
}

interface ParsedConformance {
  readonly directory?: string
  readonly harnessLine?: string
  readonly invalid: boolean
}

function parseConformance(args: readonly string[]): ParsedConformance {
  let directory: string | undefined
  let harnessLine: string | undefined
  let invalid = false
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!
    if (value === '--harness-line') {
      const next = args[index + 1]
      if (next === undefined || next.startsWith('-')) invalid = true
      else { harnessLine = next; index += 1 }
    } else if (value.startsWith('--harness-line=')) {
      harnessLine = value.slice('--harness-line='.length)
    } else if (value.startsWith('-') || directory !== undefined) invalid = true
    else directory = value
  }
  if (harnessLine !== undefined && (valid(harnessLine) === null || !BLUE_PLUGIN_SUPPORTED_HARNESS_LINES.includes(harnessLine as typeof BLUE_PLUGIN_HARNESS_LINE))) invalid = true
  return { ...(directory === undefined ? {} : { directory }), ...(harnessLine === undefined ? {} : { harnessLine }), invalid }
}

/**
 * Execute one author command without depending on global process I/O.
 * @param args - command arguments after the executable name.
 * @param io - output and runtime execution effects.
 * @returns process exit status.
 */
export async function runBluePluginCli(args: readonly string[], io: BluePluginCliIo): Promise<number> {
  const [command, ...rest] = args
  if (command === 'catalog') {
    if (rest.length !== 1 || rest[0] !== '--json') {
      io.stderr(BLUE_PLUGIN_USAGE)
      return 2
    }
    io.stdout(JSON.stringify({
      productVersion: BLUE_VERSION,
      apiVersion: BLUE_API_VERSION,
      harnessLine: BLUE_PLUGIN_HARNESS_LINE,
      supportedHarnessLines: BLUE_PLUGIN_SUPPORTED_HARNESS_LINES,
      capabilities: BLUE_CAPABILITY_CATALOG_V1,
    }, null, 2) + '\n')
    return 0
  }
  if (command === 'create') {
    const parsed = parseCreate(rest)
    if (parsed.invalid || parsed.directory === undefined || parsed.packageName === undefined) {
      io.stderr(BLUE_PLUGIN_USAGE)
      return 2
    }
    const created = createPluginPackage({ directory: parsed.directory, packageName: parsed.packageName })
    if (!created.ok) {
      io.stderr(`blue-plugin create: ${created.message}\n`)
      return 1
    }
    io.stdout(`${created.directory}\n`)
    return 0
  }
  if (command === 'validate') {
    if (rest.length !== 1 || rest[0]!.startsWith('-')) {
      io.stderr(BLUE_PLUGIN_USAGE)
      return 2
    }
    return io.runRuntime('validate', rest)
  }
  if (command === 'conformance') {
    const parsed = parseConformance(rest)
    if (parsed.invalid || parsed.directory === undefined) {
      io.stderr(BLUE_PLUGIN_USAGE)
      return 2
    }
    return io.runRuntime('conformance', [
      parsed.directory,
      '--install',
      ...(parsed.harnessLine === undefined ? [] : ['--harness-line', parsed.harnessLine]),
    ])
  }
  io.stderr(BLUE_PLUGIN_USAGE)
  return command === undefined || command === '--help' || command === '-h' ? 0 : 2
}
