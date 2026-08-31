/**
 * User-facing `/plugin` command family. Installed inventory stays local while
 * the catalog reads inert metadata from a bounded, pinned GitHub index.
 * Profile mutations remain delegated to the dsh profile owner and take effect
 * only after restart.
 *
 * @module @dsh-blue/blue-interaction/plugin-command
 */

import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { BLUE_API_VERSION, BLUE_VERSION } from '@dsh-blue/blue-api'
import { validateBluePluginManifestV1, type BluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1'
import { bluePluginRuntimePath, BLUE_PLUGIN_HARNESS_LINE } from '@dsh-blue/blue-plugin-kit'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import { satisfies, valid } from 'semver'
import { profileNameFromArgv, profileRoot, readProfileFacts } from './updater/profile.ts'
import { updaterInternals } from './updater/io.ts'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { CanonicalDocumentController, type FrontendPanelDocument } from './frontend-panel.ts'
import { interactionTranslator } from './locale.ts'
import {
  bundledPluginCatalog,
  refreshPluginCatalog,
  type PluginCatalogEntry,
  type PluginCatalogResult,
} from './plugin-catalog.ts'

const GITHUB_PROXY_ENV = 'BLUE_GITHUB_PROXY'

interface ProcessResult {
  readonly stdout: string
  readonly stderr: string
}

type RunProcess = (file: string, args: string[], options: { readonly encoding: 'utf8', readonly timeout: number }) => Promise<ProcessResult>
type RefreshCatalog = (signal: AbortSignal) => Promise<PluginCatalogResult>

const pluginCommandEffects: { run: RunProcess, refreshCatalog: RefreshCatalog } = {
  run: promisify(execFile) as unknown as RunProcess,
  refreshCatalog: refreshPluginCatalog,
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

interface PluginPanelState {
  catalog: PluginCatalogResult
  refreshing: boolean
  busy?: string
  message?: string
}

type PluginPanelAction =
  | { readonly kind: 'plugin.verify', readonly row: InstalledPluginRow }
  | { readonly kind: 'plugin.uninstall', readonly row: InstalledPluginRow }
  | { readonly kind: 'plugin.catalog.details', readonly entry: PluginCatalogEntry }
  | { readonly kind: 'plugin.catalog.install', readonly entry: PluginCatalogEntry, readonly spec: string }

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
  if (!satisfies(BLUE_API_VERSION, parsed.value.api, { includePrerelease: true })) incompatible.push(`API ${BLUE_API_VERSION}`)
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

const passthrough: BlueTranslate = (key, values) => {
  let result = key
  for (const [name, value] of Object.entries(values ?? {})) result = result.replaceAll(`{${name}}`, String(value))
  return result
}

function installedStateLabel(state: CompatibilityState, t: BlueTranslate): string {
  switch (state) {
    case 'compatible': return t('Compatible')
    case 'incompatible': return t('Incompatible')
    case 'invalid': return t('Invalid')
  }
}

function catalogStateLabel(state: PluginCatalogEntry['state'], t: BlueTranslate): string {
  switch (state) {
    case 'compatible': return t('Compatible')
    case 'needs-migration': return t('Needs migration')
    case 'incompatible': return t('Incompatible')
    case 'invalid': return t('Invalid')
  }
}

function catalogStatus(state: PluginPanelState, t: BlueTranslate): string {
  if (state.refreshing) return t('vetted snapshot · refreshing GitHub')
  if (state.catalog.source === 'live') return t('catalog refreshed from GitHub')
  return state.catalog.message === undefined ? t('vetted catalog snapshot') : t('offline · using vetted snapshot')
}

function pluginPanelModel(rows: readonly InstalledPluginRow[], state: PluginPanelState, t: BlueTranslate = passthrough): FrontendPanelDocument {
  if (state.busy !== undefined) return { mode: 'loading', title: t('Plugins'), view: { kind: 'text', content: state.busy }, dismissible: false }
  const installedNames = new Set(rows.map(row => row.packageName))
  return {
    mode: 'select',
    title: t('Plugins'),
    header: { kind: 'text', content: state.message ?? t('{installed} installed · {indexed} indexed · {status}', { installed: rows.length, indexed: state.catalog.entries.length, status: catalogStatus(state, t) }) },
    items: [
      ...rows.map(row => ({
        id: `installed:${row.packageName}`,
        label: row.label,
        detail: `v${row.installed} · ${row.spec}`,
        badge: installedStateLabel(row.state, t),
        group: 'installed',
        variantsFirst: true,
        secondaryAction: { kind: 'plugin.uninstall', row },
        variants: [
          { id: 'verify', label: t('Verify'), action: { kind: 'plugin.verify', row } },
          { id: 'remove', label: t('Remove'), action: { kind: 'plugin.uninstall', row } },
        ],
      })),
      ...state.catalog.entries.map(entry => {
        const installed = installedNames.has(entry.packageName)
        const installSpec = entry.installSpec
        const installable = installSpec !== undefined && !installed
        return {
          id: `catalog:${entry.repository}`,
          label: entry.packageName,
          detail: `v${entry.version} · ${entry.description}`,
          badge: installed ? t('Installed') : catalogStateLabel(entry.state, t),
          group: 'catalog',
          variantsFirst: true,
          variants: [
            { id: 'details', label: t('Details'), action: { kind: 'plugin.catalog.details', entry } },
            {
              id: 'install',
              label: installed
                ? t('Installed')
                : entry.state === 'needs-migration'
                  ? t('Migration required')
                  : t('Install'),
              disabled: !installable,
              ...(installSpec !== undefined && !installed ? { action: { kind: 'plugin.catalog.install', entry, spec: installSpec } } : {}),
            },
          ],
        }
      }),
    ],
    grouped: true,
    includeAllGroup: false,
    groups: ['installed', 'catalog'],
    groupLabels: { installed: t('Installed'), catalog: t('Catalog') },
    groupCounts: { installed: rows.length, catalog: state.catalog.entries.length },
    emptyByGroup: {
      installed: { title: t('No Blue plugins installed'), description: t('Open Catalog to inspect indexed plugins.') },
      catalog: { title: t('No plugins indexed'), description: t('The vetted catalog snapshot is empty.') },
    },
    filterable: true,
  }
}

function catalogDetailModel(entry: PluginCatalogEntry, installed: boolean, t: BlueTranslate = passthrough): FrontendPanelDocument {
  const installSpec = entry.installSpec
  return {
    mode: 'info',
    title: entry.packageName,
    header: { kind: 'text', content: entry.description },
    view: {
      kind: 'text',
      content: [
        `${t('Version')}      ${entry.version}`,
        `${t('Status')}       ${installed ? t('Installed') : catalogStateLabel(entry.state, t)}`,
        `${t('Reason')}       ${installed ? t('Already installed in this profile') : entry.reason}`,
        `${t('Repository')}   ${entry.repositoryUrl}`,
        `${t('Commit')}       ${entry.commit}`,
        `${t('Capabilities')} ${entry.capabilities.join(', ') || t('none declared')}`,
      ].join('\n'),
    },
    ...(installSpec !== undefined && !installed ? { submit: { kind: 'plugin.catalog.install', entry, spec: installSpec } } : {}),
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
    const directory = statSync(local).isDirectory() ? local : undefined
    return {
      ok: true,
      kind: 'local',
      spec: `file:${local}`,
      ...(directory === undefined ? {} : { directory }),
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
  const activePanels = new Set<() => void>()
  const t = interactionTranslator(ctx)
  const unregister = ctx.commands.register({
    name: 'plugin',
    description: 'Inspect, verify, install, and remove Blue plugins',
    input: { hint: '[list|search|info|verify|install|remove] [package-or-path] · bare opens installed/catalog tabs' },
    handler: async invocation => {
      const input = invocation.rawInput.trim()
      const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(input)
      const action = match?.[1] ?? 'list'
      const argument = match?.[2]?.trim() ?? ''
      try {
        if (input === '' && displayServices(ctx) !== undefined) {
          const display = displayServices(ctx)!
          let rows = installedPlugins()
          const state: PluginPanelState = { catalog: bundledPluginCatalog(), refreshing: true }
          const refreshAbort = new AbortController()
          let live = true
          let restore: (() => void) | undefined
          let restoreDetail: (() => void) | undefined
          let panel: CanonicalDocumentController
          const closeDetail = (): void => { restoreDetail?.(); restoreDetail = undefined }
          const close = (): void => {
            if (!live) return
            live = false
            refreshAbort.abort()
            closeDetail()
            restore?.()
            restore = undefined
            activePanels.delete(close)
          }
          const refresh = (): void => {
            rows = installedPlugins()
            panel.invalidate()
            display.screen.requestRender()
          }
          const operate = async (busy: string, operation: () => Promise<string>): Promise<void> => {
            if (!live) return
            state.busy = busy
            panel.invalidate()
            display.screen.requestRender()
            try {
              const result = await operation()
              if (live) state.message = result
            } catch (error) {
              if (live) state.message = t('plugin operation failed: {message}', { message: error instanceof Error ? error.message : String(error) })
            } finally {
              if (live) {
                delete state.busy
                refresh()
              }
            }
          }
          const verify = (row: InstalledPluginRow): Promise<void> => operate(
            t('Verifying {plugin}...', { plugin: row.label }),
            async () => validationText(await validatePackage(row.root)),
          )
          const uninstall = (row: InstalledPluginRow): Promise<void> => operate(
            t('Uninstalling {plugin}...', { plugin: row.label }),
            async () => `${await runProfileCommand('remove', row.packageName)}\n${t('uninstalled; restart Blue to apply')}`,
          )
          const install = (entry: PluginCatalogEntry, spec: string): Promise<void> => {
            closeDetail()
            return operate(
              t('Installing {plugin}...', { plugin: entry.packageName }),
              async () => `${await runProfileCommand('add', spec)}\n${t('installed; restart Blue to apply, then run /plugin verify {plugin}', { plugin: entry.packageName })}`,
            )
          }
          const details = (entry: PluginCatalogEntry): void => {
            if (!live) return
            const installed = rows.some(row => row.packageName === entry.packageName)
            let detail: CanonicalDocumentController
            detail = new CanonicalDocumentController({
              keymap: display.keymap,
              theme: display.theme,
              components: display.components,
              model: () => catalogDetailModel(entry, installed, t),
              hint: installed || entry.installSpec === undefined ? t('Esc close') : t('Enter install · Esc close'),
              onAction: actionValue => {
                const selected = actionValue as Extract<PluginPanelAction, { readonly kind: 'plugin.catalog.install' }>
                closeDetail()
                void install(selected.entry, selected.spec)
              },
              onClose: closeDetail,
            })
            closeDetail()
            restoreDetail = mountEditorReplacement(ctx, detail)
          }
          panel = new CanonicalDocumentController({
            keymap: display.keymap,
            theme: display.theme,
            components: display.components,
            model: () => pluginPanelModel(rows, state, t),
            hint: t('Tab pages · ↑↓ rows · ←→ action · Enter run · Alt+S remove · Esc close'),
            showSelectedVariantInFooter: true,
            onAction: actionValue => {
              const selected = actionValue as PluginPanelAction
              if (selected.kind === 'plugin.verify') void verify(selected.row)
              else if (selected.kind === 'plugin.uninstall') void uninstall(selected.row)
              else if (selected.kind === 'plugin.catalog.details') details(selected.entry)
              else void install(selected.entry, selected.spec)
            },
            onClose: close,
          })
          restore = mountEditorReplacement(ctx, panel)
          activePanels.add(close)
          void pluginCommandEffects.refreshCatalog(refreshAbort.signal).then(
            catalog => {
              if (!live) return
              state.catalog = catalog
              state.refreshing = false
              panel.invalidate()
              display.screen.requestRender()
            },
            error => {
              if (!live) return
              state.refreshing = false
              state.message = t('catalog refresh failed: {message}', { message: error instanceof Error ? error.message : String(error) })
              panel.invalidate()
              display.screen.requestRender()
            },
          )
          return { kind: 'success' } satisfies CommandResult
        }

        const rows = installedPlugins()
        if (action === 'list') {
          return {
            kind: 'success',
            text: rows.map(row => `${row.packageName}@${row.installed} [${row.state}]`).join('\n') || 'no Blue plugins installed',
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
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unregister()
    for (const close of activePanels) close()
  }
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
  pluginPanelModel,
  catalogDetailModel,
}
