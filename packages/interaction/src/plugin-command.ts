/**
 * User-facing `/plugin` command family. Read operations use the official
 * marketplace registry; installation is delegated to the profile owner and
 * takes effect after a restart, so the live Cordis tree is never replaced.
 *
 * @module @dsh-blue/blue-interaction/plugin-command
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { PanelModel } from '@dsh-blue/blue-frontend'
import { compareVersions } from './updater/version.ts'
import { profileRoot, readProfileFacts } from './updater/profile.ts'
import { updaterInternals } from './updater/io.ts'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { FrontendPanel } from './frontend-panel.ts'
import { FormPanel } from './form-panel.ts'

const run = promisify(execFile)
const REGISTRY_URL = 'https://raw.githubusercontent.com/dsh-blue/marketplace/master/registry.json'
const GITHUB_PROXY_ENV = 'BLUE_MARKETPLACE_GITHUB_PROXY'

interface InstallSource { readonly kind?: string, readonly spec?: string }
interface Entry { readonly id?: string, readonly package?: string, readonly version?: string, readonly title?: { readonly zh?: string, readonly en?: string }, readonly capabilities?: readonly string[], readonly verified?: boolean, readonly install?: readonly InstallSource[] }

interface PluginRow {
  readonly id: string
  readonly packageName: string
  readonly label: string
  readonly installed?: string
  readonly latest?: string
  readonly spec: string
}

function isGitHubSpec(spec: string): boolean {
  return spec.startsWith('github:') || /^(?:git\+)?https:\/\/github\.com\//u.test(spec)
}

function githubProxyBase(): string | undefined {
  const value = process.env[GITHUB_PROXY_ENV]?.trim()
  if (value === undefined || value.length === 0) return undefined
  return value.replace(/^https?:\/\//u, '').replace(/\/+$/u, '')
}

/** Rewrite GitHub sources for pnpm's git fetch while preserving commit pins. */
function withGitHubProxy(spec: string): string {
  const proxy = githubProxyBase()
  if (proxy === undefined || !isGitHubSpec(spec)) return spec
  if (spec.startsWith('github:')) {
    const repository = spec.slice('github:'.length)
    const separator = repository.lastIndexOf('@')
    const name = separator > 0 ? repository.slice(0, separator) : repository
    const ref = separator > 0 ? repository.slice(separator + 1) : undefined
    return `git+https://${proxy}/https://github.com/${name}${name.endsWith('.git') ? '' : '.git'}${ref === undefined ? '' : `#${ref}`}`
  }
  const match = /^(?:git\+)?https:\/\/github\.com\/(.+)$/u.exec(spec)
  if (match?.[1] === undefined) return spec
  const [path, ref] = match[1].split('#', 2)
  return `git+https://${proxy}/https://github.com/${path}${ref === undefined ? '' : `#${ref}`}`
}

function marketplaceSource(entry: Entry, fallback: string): InstallSource {
  const source = entry.install?.find(value => typeof value.spec === 'string' && value.spec.length > 0)
  return source ?? { spec: fallback }
}

async function entries(): Promise<readonly Entry[]> {
  const url = process.env.BLUE_MARKETPLACE_REGISTRY ?? REGISTRY_URL
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`marketplace registry returned HTTP ${response.status}`)
    const value = await response.json() as { plugins?: readonly Entry[] }
    return value.plugins ?? []
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (reason === 'fetch failed') throw new Error(`${reason}; configure BLUE_MARKETPLACE_REGISTRY to a reachable registry URL`)
    throw error
  }
}

function profile(): string {
  const args = process.argv
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg?.startsWith('--profile=')) return arg.slice('--profile='.length)
    if (arg === '--profile' && args[i + 1] !== undefined) return args[i + 1]!
  }
  return 'blue'
}

function entryLabel(entry: Entry): string {
  return entry.title?.en ?? entry.title?.zh ?? entry.id ?? entry.package ?? 'unknown plugin'
}

function profileSpec(row: PluginRow): string {
  if (isGitHubSpec(row.spec)) return withGitHubProxy(row.spec)
  return row.latest === undefined ? row.spec : `${row.packageName}@${row.latest}`
}

async function runProfileCommand(action: 'add' | 'remove', spec: string): Promise<string> {
  const host = process.env.BLUE_DSH_BIN
  const command = host === undefined ? 'dsh' : process.execPath
  const args = host === undefined
    ? ['plugin', '--profile', profile(), action, withGitHubProxy(spec)]
    : [host, 'plugin', '--profile', profile(), action, withGitHubProxy(spec)]
  const result = await run(command, args, { encoding: 'utf8', timeout: 120000 })
  const output = `${result.stdout}${result.stderr}`.trim()
  return output.length === 0 ? `${action} completed` : output
}

async function pluginRows(): Promise<{ readonly installed: PluginRow[], readonly available: PluginRow[] }> {
  const [all, facts] = await Promise.all([entries(), Promise.resolve(readProfileFacts(profileRoot(profile())))])
  const byPackage = new Map(all.flatMap(entry => entry.package === undefined ? [] : [[entry.package, entry] as const]))
  const installed: PluginRow[] = []
  const seen = new Set<string>()
  for (const [packageName, version] of Object.entries(facts.installed)) {
    if (version === undefined) continue
    const entry = byPackage.get(packageName)
    // The profile also contains Blue's own runtime packages and Harness
    // dependencies. Only packages declared by the marketplace belong in the
    // plugin manager; the bundle's internal dependencies must stay hidden.
    if (entry === undefined) continue
    const spec = facts.specs[packageName] ?? `${packageName}@${version}`
    const latest = entry?.version
    installed.push({
      id: entry.id ?? packageName,
      packageName,
      label: entryLabel(entry),
      installed: version,
      ...(latest === undefined ? {} : { latest }),
      spec,
    })
    seen.add(packageName)
  }
  for (const entry of all) {
    const packageName = entry.package
    if (packageName === undefined || seen.has(packageName)) continue
    const installedVersion = facts.installed[packageName] ?? readPackageVersion(profileRoot(profile()), packageName)
    if (installedVersion === undefined) continue
    const spec = facts.specs[packageName] ?? `${packageName}@${installedVersion}`
    installed.push({
      id: entry.id ?? packageName,
      packageName,
      label: entryLabel(entry),
      installed: installedVersion,
      ...(entry.version === undefined ? {} : { latest: entry.version }),
      spec,
    })
    seen.add(packageName)
  }
  const available = all.flatMap(entry => {
    const packageName = entry.package
    if (packageName === undefined || seen.has(packageName)) return []
    const fallback = `${packageName}${entry.version === undefined ? '' : `@${entry.version}`}`
    const source = marketplaceSource(entry, fallback)
    return [{ id: entry.id ?? packageName, packageName, label: entryLabel(entry), ...(entry.version === undefined ? {} : { latest: entry.version }), spec: source.spec ?? fallback }]
  })
  return { installed: installed.sort((a, b) => a.label.localeCompare(b.label)), available: available.sort((a, b) => a.label.localeCompare(b.label)) }
}

function readPackageVersion(root: string, packageName: string): string | undefined {
  const text = updaterInternals.readTextFile(join(root, 'node_modules', packageName, 'package.json'))
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const version = (parsed as Record<string, unknown>).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

function pluginPanelModel(rows: { readonly installed: readonly PluginRow[], readonly available: readonly PluginRow[] }, state: { readonly busy?: string, readonly message?: string }): PanelModel {
  const installed = rows.installed.map(row => {
    const upgrade = row.latest !== undefined && row.installed !== undefined && compareVersions(row.latest, row.installed) > 0
    const detail = row.installed === undefined
      ? 'installed version unavailable'
      : upgrade ? `v${row.installed} → v${row.latest} · update available` : `v${row.installed} · up to date`
    return {
      id: `installed:${row.packageName}`,
      label: row.label,
      detail,
      group: 'Installed',
      action: { kind: upgrade ? 'plugin.upgrade' : 'plugin.uninstall', row },
      ...(upgrade ? { secondaryAction: { kind: 'plugin.uninstall', row } } : {}),
    }
  })
  const available = rows.available.map(row => ({
    id: `available:${row.packageName}`,
    label: row.label,
    detail: row.latest === undefined ? row.packageName : `v${row.latest} · not installed`,
    group: 'Available',
    action: { kind: 'plugin.install', row },
  }))
  const busy = state.busy
  return busy === undefined
    ? {
        kind: 'panel', mode: 'select', title: 'Plugins',
        header: { kind: 'text', text: state.message ?? `${installed.length} installed · ${available.length} available` },
        view: { kind: 'list', items: [...installed, ...available], grouped: true, includeAllGroup: false, groups: ['Installed', 'Available'], filterable: true },
      }
    : { kind: 'panel', mode: 'loading', title: 'Plugins', view: { kind: 'text', text: busy }, dismissible: false }
}

/** Register `/plugin` and its read/install operations. */
export function registerPluginCommand(ctx: Context): () => void {
  const dispose = ctx.commands.register({
    name: 'plugin',
    description: 'Browse, install, upgrade, and remove Blue plugins',
    input: { hint: '[list|search|info|verify|install] [id|spec] · bare opens the plugin panel' },
    handler: async invocation => {
      const [action = 'list', ...rest] = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
      try {
        if (invocation.rawInput.trim() === '' && displayServices(ctx) !== undefined) {
          const display = displayServices(ctx)!
          let rows: { installed: PluginRow[], available: PluginRow[] }
          const editor = getSharedEditor(ctx)
          editor?.notice?.('loading plugins...')
          try {
            rows = await pluginRows()
          } catch (error) {
            return { kind: 'error', text: `plugin operation failed: ${error instanceof Error ? error.message : String(error)}` } satisfies CommandResult
          } finally {
            editor?.notice?.('')
          }
          const state: { busy?: string, message?: string } = {}
          let restore: (() => void) | undefined
          const close = (): void => { restore?.(); restore = undefined }
          const executeMutation = async (kind: 'plugin.install' | 'plugin.uninstall' | 'plugin.upgrade', row: PluginRow): Promise<void> => {
            if (state.busy !== undefined) return
            state.busy = kind === 'plugin.install' ? `Installing ${row.label}...` : kind === 'plugin.upgrade' ? `Upgrading ${row.label}...` : `Uninstalling ${row.label}...`
            display.screen.requestRender()
            try {
              const output = await runProfileCommand(kind === 'plugin.uninstall' ? 'remove' : 'add', kind === 'plugin.uninstall' ? row.packageName : profileSpec(row))
              rows = await pluginRows()
              state.message = `${output}\n${kind === 'plugin.uninstall' ? 'uninstalled' : kind === 'plugin.upgrade' ? 'upgraded' : 'installed'}; restart Blue to apply`
            } catch (error) {
              state.message = `plugin operation failed: ${error instanceof Error ? error.message : String(error)}`
            } finally {
              delete state.busy
              display.screen.requestRender()
            }
          }
          const confirmUpgrade = (row: PluginRow): void => {
            const form = new FormPanel({
              keymap: display.keymap,
              theme: display.theme,
              components: display.components,
              title: 'Upgrade Plugin',
              subtitle: `${row.label}: v${row.installed ?? '?'} → v${row.latest ?? '?'}`,
              fields: [{ id: 'confirm', label: `Upgrade ${row.label}?`, hint: 'type y to confirm · Esc cancels', required: true, validate: value => value.toLowerCase() === 'y' ? undefined : 'type y to confirm, or Esc to cancel' }],
              onSubmit: () => {
                formRestore?.()
                void executeMutation('plugin.upgrade', row)
              },
              onCancel: () => formRestore?.(),
            })
            const formRestore = mountEditorReplacement(ctx, form)
          }
          const panel = new FrontendPanel({
            keymap: display.keymap,
            theme: display.theme,
            components: display.components,
            model: () => pluginPanelModel(rows, state),
            hint: 'Tab/←→ pages · Alt+S uninstall',
            onAction: actionValue => {
              const action = actionValue as { kind?: string, row?: PluginRow }
              if (action.row === undefined) return
              if (action.kind === 'plugin.upgrade') confirmUpgrade(action.row)
              else if (action.kind === 'plugin.install' || action.kind === 'plugin.uninstall') void executeMutation(action.kind, action.row)
            },
            onClose: close,
          })
          restore = mountEditorReplacement(ctx, panel)
          return { kind: 'success' } satisfies CommandResult
        }
        if (action === 'list' || action === 'search' || action === 'info') {
          const all = await entries()
          if (action === 'list') return { kind: 'success', text: all.map(entry => `${entry.id ?? ''}@${entry.version ?? ''}`).join('\n') || 'marketplace is empty' } satisfies CommandResult
          if (action === 'search') {
            const query = rest.join(' ').toLowerCase()
            const found = all.filter(entry => JSON.stringify(entry).toLowerCase().includes(query))
            return { kind: 'success', text: found.map(entry => `${entry.id ?? ''} — ${entry.title?.en ?? entry.title?.zh ?? ''}`).join('\n') || 'no matching plugins' } satisfies CommandResult
          }
          const id = rest[0]
          if (id === undefined) return { kind: 'error', text: 'usage: /plugin info <id-or-package>' }
          const entry = all.find(value => value.id === id || value.package === id)
          return entry === undefined
            ? { kind: 'error', text: `plugin not found: ${id}` }
            : { kind: 'success', text: JSON.stringify(entry) } satisfies CommandResult
        }
        if (action === 'verify') return { kind: 'success', text: `verification requested for ${rest[0] ?? ''}; use blue-plugin-validate and the packed fixture before enabling` } satisfies CommandResult
        if (action === 'install') {
          const spec = rest[0]
          if (spec === undefined) return { kind: 'error', text: 'usage: /plugin install <marketplace id, npm spec, or pinned GitHub commit>' }
          const github = /github\.com\//u.test(spec) || spec.startsWith('github:')
          if (github && !/@[0-9a-f]{7,40}$/iu.test(spec)) return { kind: 'error', text: 'GitHub plugins must be pinned to a commit (append @<sha>)' }
          const host = process.env.BLUE_DSH_BIN
          const command = host === undefined ? 'dsh' : process.execPath
          const args = host === undefined ? ['plugin', '--profile', profile(), 'add', withGitHubProxy(spec)] : [host, 'plugin', '--profile', profile(), 'add', withGitHubProxy(spec)]
          const result = await run(command, args, { encoding: 'utf8', timeout: 120000 })
          const output = `${result.stdout}${result.stderr}`.trim()
          return { kind: 'success', text: `${output}\ninstalled; restart Blue to apply` } satisfies CommandResult
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
