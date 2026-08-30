/**
 * User-facing `/plugin` command family. Inventory and verification are local:
 * the paused pre-v1 marketplace is not queried. Profile mutations remain
 * delegated to the dsh profile owner and take effect only after restart.
 *
 * @module @dsh-blue/blue-interaction/plugin-command
 */

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { BLUE_VERSION } from '@dsh-blue/blue-api'
import { validateBluePluginManifestV1, type BluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1'
import { bluePluginRuntimePath, BLUE_PLUGIN_HARNESS_LINE } from '@dsh-blue/blue-plugin-kit'
import { satisfies, valid } from 'semver'
import { profileNameFromArgv, profileRoot, readProfileFacts } from './updater/profile.ts'
import { updaterInternals } from './updater/io.ts'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { CanonicalDocumentController, type FrontendPanelDocument } from './frontend-panel.ts'

const GITHUB_PROXY_ENV = 'BLUE_GITHUB_PROXY'

interface ProcessResult {
  readonly stdout: string
  readonly stderr: string
}

type RunProcess = (file: string, args: string[], options: { readonly encoding: 'utf8', readonly timeout: number }) => Promise<ProcessResult>

const pluginCommandEffects: { run: RunProcess } = {
  run: promisify(execFile) as unknown as RunProcess,
}

type CompatibilityState = 'compatible' | 'incompatible' | 'invalid'

interface InstalledPluginRow {
  readonly packageName: string
  readonly label: string
  readonly installed: string
  readonly spec: string
  readonly root: string
  readonly state: CompatibilityState
  readonly reason: string
  readonly manifest?: BluePluginManifestV1
}

interface ValidationFinding {
  readonly code?: string
  readonly message?: string
}

interface ValidationReport {
  readonly package?: string
  readonly valid?: boolean
  readonly files?: number
  readonly violations?: readonly ValidationFinding[]
}

function currentProfile(): string {
  return profileNameFromArgv(process.argv)
}

function packageRoot(root: string, packageName: string): string {
  return join(root, 'node_modules', ...packageName.split('/'))
}

function readJson(path: string): Readonly<Record<string, unknown>> | undefined {
  const text = updaterInternals.readTextFile(path)
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Readonly<Record<string, unknown>>
      : undefined
  } catch {
    return undefined
  }
}

function manifestPointer(pkg: Readonly<Record<string, unknown>>): string | undefined {
  const blue = pkg.blue
  if (typeof blue !== 'object' || blue === null || Array.isArray(blue)) return undefined
  const pointer = (blue as Readonly<Record<string, unknown>>).manifest
  return typeof pointer === 'string' && pointer.length > 0 ? pointer : undefined
}

function classifyManifest(packageName: string, root: string, pointer: string): Pick<InstalledPluginRow, 'state' | 'reason' | 'manifest'> {
  const target = resolve(root, pointer)
  const child = relative(root, target)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    return { state: 'invalid', reason: 'manifest pointer escapes the package' }
  }
  const source = readJson(target)
  if (source === undefined) return { state: 'invalid', reason: 'manifest is missing or invalid JSON' }
  const parsed = validateBluePluginManifestV1(source)
  if (!parsed.ok) return { state: 'invalid', reason: parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ') }
  if (parsed.value.id !== packageName) return { state: 'invalid', reason: `manifest id ${parsed.value.id} differs from package name` }
  const incompatible: string[] = []
  if (!satisfies(BLUE_VERSION, parsed.value.compatibility.blue, { includePrerelease: true })) incompatible.push(`Blue ${BLUE_VERSION}`)
  if (!satisfies(BLUE_PLUGIN_HARNESS_LINE, parsed.value.compatibility.harness, { includePrerelease: true })) incompatible.push(`Harness ${BLUE_PLUGIN_HARNESS_LINE}`)
  if (!satisfies(process.versions.node, parsed.value.compatibility.node, { includePrerelease: true })) incompatible.push(`Node ${process.versions.node}`)
  return incompatible.length === 0
    ? { state: 'compatible', reason: 'manifest compatible', manifest: parsed.value }
    : { state: 'incompatible', reason: `does not accept ${incompatible.join(', ')}`, manifest: parsed.value }
}

function installedPlugins(): readonly InstalledPluginRow[] {
  const root = profileRoot(currentProfile())
  const facts = readProfileFacts(root)
  const rows: InstalledPluginRow[] = []
  for (const [packageName, spec] of Object.entries(facts.specs)) {
    const installedRoot = packageRoot(root, packageName)
    const pkg = readJson(join(installedRoot, 'package.json'))
    if (pkg === undefined) continue
    const pointer = manifestPointer(pkg)
    if (pointer === undefined) continue
    const version = pkg.version
    const installed = typeof version === 'string' ? version : 'unknown'
    const classified = classifyManifest(packageName, installedRoot, pointer)
    rows.push({
      packageName,
      label: classified.manifest?.id ?? packageName,
      installed,
      spec,
      root: installedRoot,
      ...classified,
    })
  }
  return rows.sort((left, right) => left.label.localeCompare(right.label))
}

function pluginPanelModel(rows: readonly InstalledPluginRow[], state: { readonly busy?: string, readonly message?: string }): FrontendPanelDocument {
  if (state.busy !== undefined) return { mode: 'loading', title: 'Plugins', view: { kind: 'text', content: state.busy }, dismissible: false }
  return {
    mode: 'select',
    title: 'Installed Plugins',
    header: { kind: 'text', content: state.message ?? `${rows.length} installed · marketplace paused` },
    items: rows.map(row => ({
      id: row.packageName,
      label: row.label,
      detail: `v${row.installed} · ${row.state} · ${row.spec}`,
      action: { kind: 'plugin.verify', row },
      secondaryAction: { kind: 'plugin.uninstall', row },
    })),
    grouped: false,
    includeAllGroup: false,
    filterable: true,
  }
}

function githubParts(spec: string): { readonly repository: string, readonly commit: string } | undefined {
  const match = /^(?:github:|(?:git\+)?https:\/\/github\.com\/)(.+?)(?:@|#)([0-9a-f]{40})$/iu.exec(spec)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return { repository: match[1], commit: match[2] }
}

function isGitHubSpec(spec: string): boolean {
  return spec.startsWith('github:') || /^(?:git\+)?https:\/\/github\.com\//u.test(spec)
}

/** Rewrite a pinned GitHub source for pnpm's git fetch. */
function withGitHubProxy(spec: string): string {
  const proxyValue = process.env[GITHUB_PROXY_ENV]?.trim()
  const parts = githubParts(spec)
  if (proxyValue === undefined || proxyValue.length === 0 || parts === undefined) return spec
  const proxy = proxyValue.replace(/^https?:\/\//u, '').replace(/\/+$/u, '')
  const repository = parts.repository.endsWith('.git') ? parts.repository : `${parts.repository}.git`
  return `git+https://${proxy}/https://github.com/${repository}#${parts.commit}`
}

interface InstallSource {
  readonly ok: true
  readonly kind: 'local' | 'npm' | 'github'
  readonly spec: string
  readonly directory?: string
}

interface InvalidInstallSource { readonly ok: false, readonly message: string }

function localPath(spec: string): string | undefined {
  const raw = spec.startsWith('file:') || spec.startsWith('link:') ? spec.slice(spec.indexOf(':') + 1) : spec
  if (!(spec.startsWith('file:') || spec.startsWith('link:') || raw.startsWith('.') || isAbsolute(raw))) return undefined
  return resolve(raw)
}

function installSource(spec: string): InstallSource | InvalidInstallSource {
  const local = localPath(spec)
  if (local !== undefined) {
    if (!existsSync(local)) return { ok: false, message: `local plugin does not exist: ${local}` }
    return {
      ok: true,
      kind: 'local',
      spec,
      ...(statSync(local).isDirectory() ? { directory: local } : {}),
    }
  }
  if (isGitHubSpec(spec)) {
    if (githubParts(spec) === undefined) return { ok: false, message: 'GitHub plugins must be pinned to a full 40-character commit' }
    return { ok: true, kind: 'github', spec }
  }
  const separator = spec.lastIndexOf('@')
  const packageName = separator > 0 ? spec.slice(0, separator) : ''
  const version = separator > 0 ? spec.slice(separator + 1) : ''
  const packageNameValid = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(packageName)
  if (!packageNameValid || valid(version) === null) {
    return { ok: false, message: 'npm plugins require an exact package@version; tags and ranges are not accepted' }
  }
  return { ok: true, kind: 'npm', spec }
}

async function runProfileCommand(action: 'add' | 'remove', spec: string): Promise<string> {
  const host = process.env.BLUE_DSH_BIN
  const command = host === undefined ? 'dsh' : process.execPath
  const args = host === undefined
    ? ['plugin', '--profile', currentProfile(), action, withGitHubProxy(spec)]
    : [host, 'plugin', '--profile', currentProfile(), action, withGitHubProxy(spec)]
  const result = await pluginCommandEffects.run(command, args, { encoding: 'utf8', timeout: 120_000 })
  const output = `${result.stdout}${result.stderr}`.trim()
  return output.length === 0 ? `${action} completed` : output
}

function parseValidationReport(output: string): ValidationReport | undefined {
  try {
    const value: unknown = JSON.parse(output)
    return typeof value === 'object' && value !== null ? value as ValidationReport : undefined
  } catch {
    return undefined
  }
}

async function validatePackage(root: string): Promise<ValidationReport> {
  try {
    const result = await pluginCommandEffects.run(process.execPath, [bluePluginRuntimePath('validate'), root], { encoding: 'utf8', timeout: 120_000 })
    const report = parseValidationReport(result.stdout)
    if (report === undefined) throw new Error('validator returned invalid JSON')
    return report
  } catch (error) {
    const output = typeof error === 'object' && error !== null && 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : undefined
    const report = output === undefined ? undefined : parseValidationReport(output)
    if (report !== undefined) return report
    throw error
  }
}

function validationText(report: ValidationReport): string {
  const subject = report.package ?? 'plugin'
  if (report.valid === true) return `verified ${subject}: valid (${report.files ?? 0} files)`
  const findings = (report.violations ?? []).slice(0, 5).map(value => `${value.code ?? 'INVALID'}: ${value.message ?? 'validation failed'}`)
  return `verification failed for ${subject}${findings.length === 0 ? '' : `\n${findings.join('\n')}`}`
}

function resolveVerificationTarget(target: string, rows: readonly InstalledPluginRow[]): string {
  return rows.find(row => row.packageName === target)?.root ?? resolve(target)
}

/** Register `/plugin` and its local inventory/verification/profile operations. */
export function registerPluginCommand(ctx: Context): () => void {
  const dispose = ctx.commands.register({
    name: 'plugin',
    description: 'Inspect, verify, install, and remove Blue plugins',
    input: { hint: '[list|search|info|verify|install|remove] [package-or-path] · bare opens installed plugins' },
    handler: async invocation => {
      const input = invocation.rawInput.trim()
      const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(input)
      const action = match?.[1] ?? 'list'
      const argument = match?.[2]?.trim() ?? ''
      try {
        if (input === '' && displayServices(ctx) !== undefined) {
          const display = displayServices(ctx)!
          let rows = installedPlugins()
          const state: { busy?: string, message?: string } = {}
          let restore: (() => void) | undefined
          let panel: CanonicalDocumentController
          const close = (): void => { restore?.(); restore = undefined }
          const refresh = (): void => {
            rows = installedPlugins()
            panel.invalidate()
            display.screen.requestRender()
          }
          const verify = async (row: InstalledPluginRow): Promise<void> => {
            state.busy = `Verifying ${row.label}...`
            panel.invalidate()
            display.screen.requestRender()
            try {
              const report = await validatePackage(row.root)
              state.message = validationText(report)
            } catch (error) {
              state.message = `plugin operation failed: ${error instanceof Error ? error.message : String(error)}`
            } finally {
              delete state.busy
              refresh()
            }
          }
          const uninstall = async (row: InstalledPluginRow): Promise<void> => {
            state.busy = `Uninstalling ${row.label}...`
            panel.invalidate()
            display.screen.requestRender()
            try {
              const output = await runProfileCommand('remove', row.packageName)
              state.message = `${output}\nuninstalled; restart Blue to apply`
            } catch (error) {
              state.message = `plugin operation failed: ${error instanceof Error ? error.message : String(error)}`
            } finally {
              delete state.busy
              refresh()
            }
          }
          panel = new CanonicalDocumentController({
            keymap: display.keymap,
            theme: display.theme,
            components: display.components,
            model: () => pluginPanelModel(rows, state),
            hint: 'Enter verify · Alt+S uninstall · Esc close',
            onAction: actionValue => {
              const selected = actionValue as { readonly kind: 'plugin.verify' | 'plugin.uninstall', readonly row: InstalledPluginRow }
              if (selected.kind === 'plugin.verify') void verify(selected.row)
              else void uninstall(selected.row)
            },
            onClose: close,
          })
          restore = mountEditorReplacement(ctx, panel)
          return { kind: 'success' } satisfies CommandResult
        }

        const rows = installedPlugins()
        if (action === 'list') {
          return {
            kind: 'success',
            text: rows.map(row => `${row.packageName}@${row.installed} [${row.state}]`).join('\n') || 'no Blue plugins installed; marketplace is paused',
          } satisfies CommandResult
        }
        if (action === 'search') {
          const query = argument.toLowerCase()
          const found = rows.filter(row => `${row.packageName}\n${row.label}\n${row.spec}`.toLowerCase().includes(query))
          return { kind: 'success', text: found.map(row => `${row.packageName}@${row.installed} [${row.state}]`).join('\n') || 'no matching installed plugins' } satisfies CommandResult
        }
        if (action === 'info') {
          if (argument === '') return { kind: 'error', text: 'usage: /plugin info <installed-package>' }
          const row = rows.find(value => value.packageName === argument)
          return row === undefined
            ? { kind: 'error', text: `installed Blue plugin not found: ${argument}` }
            : { kind: 'success', text: JSON.stringify(row, null, 2) } satisfies CommandResult
        }
        if (action === 'verify') {
          if (argument === '') return { kind: 'error', text: 'usage: /plugin verify <installed-package-or-directory>' }
          const report = await validatePackage(resolveVerificationTarget(argument, rows))
          return { kind: report.valid === true ? 'success' : 'error', text: validationText(report) } satisfies CommandResult
        }
        if (action === 'install') {
          if (argument === '') return { kind: 'error', text: 'usage: /plugin install <local-path|tarball|exact-npm-version|pinned-github-commit>' }
          const source = installSource(argument)
          if (!source.ok) return { kind: 'error', text: source.message }
          if (source.directory !== undefined) {
            const report = await validatePackage(source.directory)
            if (report.valid !== true) return { kind: 'error', text: validationText(report) }
          }
          const output = await runProfileCommand('add', source.spec)
          return { kind: 'success', text: `${output}\ninstalled; restart Blue to apply, then run /plugin verify <package>` } satisfies CommandResult
        }
        if (action === 'remove') {
          if (argument === '') return { kind: 'error', text: 'usage: /plugin remove <installed-package>' }
          const row = rows.find(value => value.packageName === argument)
          if (row === undefined) return { kind: 'error', text: `installed Blue plugin not found: ${argument}` }
          const output = await runProfileCommand('remove', row.packageName)
          return { kind: 'success', text: `${output}\nuninstalled; restart Blue to apply` } satisfies CommandResult
        }
        return { kind: 'error', text: `unknown plugin action: ${action}` } satisfies CommandResult
      } catch (error) {
        return { kind: 'error', text: `plugin operation failed: ${error instanceof Error ? error.message : String(error)}` } satisfies CommandResult
      }
    },
  })
  ctx.effect(() => dispose)
  return dispose
}

/** Test-only access to deterministic parsing and inventory helpers. */
export const pluginCommandInternals = {
  effects: pluginCommandEffects,
  installSource,
  withGitHubProxy,
  installedPlugins,
  parseValidationReport,
  validationText,
  runProfileCommand,
  validatePackage,
}
