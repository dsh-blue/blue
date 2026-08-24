/**
 * Tests for the `/settings` command and its panel: the service/display
 * guards, the group-ordered item list (namespace absence, off-preset
 * merges, the permission row's service gating), the write path (parsed
 * patches with descriptor revisions, the reasoning-effort unset, the
 * conflict retry, the notice channel, the no-remount success and the
 * updateValue rollback on failure), the diff-and-update refresh, and
 * the open-file flow through the external-editor seam.
 */

import { chmod, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// Empty type imports carry the Context merges for the services this spec
// provides (`commands`, `settings`, `permissionPresets`) and the
// 'settings/document-updated' event it emits.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-settings'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import { setExternalEditorLauncher } from '../src/external-editor.ts'
import type { PermissionPresetsService } from '../src/permission-panel.ts'
import { registerSettingsCommand, SettingsPanel } from '../src/settings-command.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

registerTempDirCleanup()

afterEach(() => {
  clearSharedEditor()
  setExternalEditorLauncher(undefined)
  vi.unstubAllEnvs()
})

/** One recorded write against the fake settings service. */
interface WriteCall {
  readonly ns: string
  readonly patch?: object
  readonly ops?: readonly unknown[]
  readonly revision: number | undefined
}

interface SettingsFakeOptions {
  /** Resolved section values per namespace; absent namespaces are undescribed. */
  readonly sections?: Record<string, Record<string, unknown>>
  /** Overrides the update behavior (throw to fail; call options.onWrite first to emit). */
  readonly updateImpl?: (ns: string, patch: object, revision: number | undefined) => Promise<void>
  /** Runs synchronously inside update/mutate before they resolve (event emission). */
  readonly onWrite?: (ns: string) => void
  /** The prepared document path; defaults to unavailable. */
  readonly prepareDocument?: () => Promise<string | undefined>
}

/** The fake settings service: describe/update/mutate/prepareDocument with observable writes. */
function fakeSettings(options: SettingsFakeOptions = {}) {
  const sections: Record<string, Record<string, unknown>> = { ...options.sections }
  const writes: WriteCall[] = []
  const revisions = new Map<string, number>()
  for (const ns of Object.keys(sections)) revisions.set(ns, 1)
  const bump = (ns: string): void => {
    revisions.set(ns, (revisions.get(ns) ?? 0) + 1)
    options.onWrite?.(ns)
  }
  const provider = {
    describe: () => Object.entries(sections).map(([ns, value]) => ({
      ns, schema: {}, value, revision: revisions.get(ns) ?? 0, applies: 'live' as const,
    })),
    get: (ns: object) => sections[String(ns)],
    update: async (ns: object, patch: object, expected?: number) => {
      writes.push({ ns: String(ns), patch, revision: expected })
      if (options.updateImpl !== undefined) return options.updateImpl(String(ns), patch, expected)
      sections[String(ns)] = { ...sections[String(ns)], ...patch }
      bump(String(ns))
    },
    mutate: async (ns: object, ops: readonly unknown[], expected?: number) => {
      writes.push({ ns: String(ns), ops, revision: expected })
      bump(String(ns))
    },
    prepareDocument: options.prepareDocument ?? (() => Promise.resolve(undefined)),
  }
  return {
    provider: provider as unknown as SettingsProvider,
    writes,
    sections,
    /** Remove a namespace, simulating an owner that unloaded mid-panel. */
    drop(ns: string): void {
      Reflect.deleteProperty(sections, ns)
    },
  }
}

/** The structural slice of the registered command the spec drives. */
interface RegisteredCommand {
  readonly name: string
  readonly description: string
  readonly handler: () => CommandResult | Promise<CommandResult>
}

interface BenchOptions extends SettingsFakeOptions {
  readonly withSettings?: boolean
  readonly presets?: PermissionPresetsService
}

/** Mount the command with fakes: commands registry, settings, presets, shared editor. */
function mount(options: BenchOptions = {}) {
  const { ctx, screen, components } = fakeBlueContext()
  const registrations: RegisteredCommand[] = []
  ctx.provide('commands', {
    register: (definition: RegisteredCommand) => {
      registrations.push(definition)
      return () => {}
    },
  } as never)
  const settings = fakeSettings(options)
  if (options.withSettings !== false) ctx.provide('settings', settings.provider)
  if (options.presets !== undefined) ctx.provide('permissionPresets', options.presets as never)
  const notices: string[] = []
  setSharedEditor({
    editor: { focused: false, render: () => [], invalidate: () => {} } as never,
    submitPrompt: () => {},
    notice: text => {
      notices.push(text)
    },
  })
  const dispose = registerSettingsCommand(ctx)
  const command = registrations.find(entry => entry.name === 'settings')!
  return { ctx, screen, components, settings, notices, dispose, command }
}

/** The presets table fake: two presets in table order. */
function fakePresets(names: readonly string[] = ['read-only', 'workspace-write']): PermissionPresetsService {
  return {
    names,
    current: () => names[0] ?? 'custom',
    resolve: () => ({ sandbox: 'x', approval: 'y' }),
    optionOf: name => ({ value: name, name }),
  }
}

/** Every namespace the panel lists, with resolved values. */
function fullSections(): Record<string, Record<string, unknown>> {
  return {
    blue: {
      updateCheck: true, updateChannel: 'rc', theme: 'dark',
      collapseThinking: true, collapseToolCalls: true,
    },
    shell: { timeoutMs: 60_000, maxTimeoutMs: 600_000, maxOutputBytes: 64_000 },
    'agent-loop': { maxParallelToolCalls: 5 },
    'agent-default-model': { reasoningEffort: 'low' },
    'web-search-deepseek': { maxUses: 3, maxTokens: 4096 },
    permission: { defaultPreset: 'workspace-write' },
  }
}

/** The panel component of the last shown overlay. */
function panel(screen: FakeScreen): SettingsPanel {
  const entry = screen.overlays.at(-1)
  if (entry === undefined) throw new Error('no panel mounted')
  return entry.component as SettingsPanel
}

/** Flush the write path's async continuations. */
function settle(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('/settings registration and guards', () => {
  it('registers the command and errors when the settings service is absent', async () => {
    const { command } = mount({ withSettings: false })
    expect(command.description).toBe('Edit user settings (update, theme, folding, shell, agent, search, permission)')
    const result = await command.handler()
    expect(result).toEqual({ kind: 'error', text: 'settings service unavailable on this host' })
  })

  it('errors when the display quartet is absent', async () => {
    const ctx = new Context()
    let captured: RegisteredCommand | undefined
    ctx.provide('commands', {
      register: (definition: RegisteredCommand) => {
        captured = definition
        return () => {}
      },
    } as never)
    ctx.provide('settings', fakeSettings().provider)
    registerSettingsCommand(ctx)
    const result = await captured!.handler()
    expect(result).toEqual({ kind: 'error', text: 'settings panel is unavailable: the Blue screen is not mounted' })
  })
})

describe('/settings item list', () => {
  it('renders every group in order, with the open-file action last', async () => {
    const bench = mount({ sections: fullSections(), presets: fakePresets() })
    const result = await bench.command.handler()
    expect(result).toEqual({ kind: 'success' })
    const items = bench.components.settingsLists.at(-1)!.options.items
    expect(items.map(item => item.id)).toEqual([
      'blue.updateCheck',
      'blue.updateChannel',
      'blue.theme',
      'blue.collapseThinking',
      'blue.collapseToolCalls',
      'shell.timeoutMs',
      'shell.maxTimeoutMs',
      'shell.maxOutputBytes',
      'agent-loop.maxParallelToolCalls',
      'agent-default-model.reasoningEffort',
      'web-search-deepseek.maxUses',
      'web-search-deepseek.maxTokens',
      'permission.defaultPreset',
      'open-file',
    ])
    // Resolved values land on the right column; the effort keeps its stored level.
    const byId = new Map(items.map(item => [item.id, item]))
    expect(byId.get('blue.updateCheck')?.currentValue).toBe('true')
    expect(byId.get('shell.timeoutMs')?.currentValue).toBe('60000')
    expect(byId.get('agent-default-model.reasoningEffort')?.currentValue).toBe('low')
    expect(byId.get('permission.defaultPreset')?.currentValue).toBe('workspace-write')
    expect(byId.get('permission.defaultPreset')?.values).toEqual(['read-only', 'workspace-write'])
    // The frame carries the title and the muted key-hint row.
    const frame = panel(bench.screen).render(80).join('\n')
    expect(frame).toContain('settings')
    expect(frame).toContain('↑↓ select · ↵ change · esc close')
  })

  it('omits rows whose namespace the host did not register', async () => {
    const bench = mount({ sections: { blue: fullSections().blue! } })
    await bench.command.handler()
    const ids = bench.components.settingsLists.at(-1)!.options.items.map(item => item.id)
    expect(ids).toEqual([
      'blue.updateCheck',
      'blue.updateChannel',
      'blue.theme',
      'blue.collapseThinking',
      'blue.collapseToolCalls',
      'open-file',
    ])
  })

  it('gates the permission row on both the namespace and the presets service', async () => {
    // Namespace present, presets service absent: no row.
    const withoutService = mount({ sections: { permission: { defaultPreset: 'read-only' } } })
    await withoutService.command.handler()
    expect(withoutService.components.settingsLists.at(-1)!.options.items.map(item => item.id))
      .toEqual(['open-file'])
    // Presets service present, namespace absent: no row.
    const withoutNs = mount({ sections: {}, presets: fakePresets() })
    await withoutNs.command.handler()
    expect(withoutNs.components.settingsLists.at(-1)!.options.items.map(item => item.id))
      .toEqual(['open-file'])
  })

  it('merges off-preset and unresolved current values into the cycle', async () => {
    const bench = mount({
      sections: {
        blue: { theme: 'ocean' },
        shell: { timeoutMs: 45_000 },
        'agent-default-model': {},
        permission: { defaultPreset: 'custom-x' },
      },
      presets: fakePresets(),
    })
    await bench.command.handler()
    const items = bench.components.settingsLists.at(-1)!.options.items
    const byId = new Map(items.map(item => [item.id, item]))
    // A key absent from the resolved section falls back to the first preset.
    expect(byId.get('blue.updateCheck')?.currentValue).toBe('true')
    // An omitted reasoning effort displays as the default preset.
    expect(byId.get('agent-default-model.reasoningEffort')?.currentValue).toBe('default')
    // An off-preset number merges in as the current selection.
    expect(byId.get('shell.timeoutMs')?.values).toEqual(['45000', '30000', '60000', '120000', '300000', '600000'])
    // An off-table preset merges in likewise.
    expect(byId.get('permission.defaultPreset')?.values).toEqual(['custom-x', 'read-only', 'workspace-write'])
  })

  it('keeps the permission row with an empty presets table', async () => {
    const bench = mount({ sections: { permission: {} }, presets: fakePresets([]) })
    await bench.command.handler()
    const row = bench.components.settingsLists.at(-1)!.options.items
      .find(item => item.id === 'permission.defaultPreset')
    expect(row?.currentValue).toBe('')
    expect(row?.values).toEqual([''])
  })
})

describe('/settings writes', () => {
  it('cycles a boolean through the list keys and writes the parsed patch with the revision', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    const surface = panel(bench.screen)
    surface.handleInput(KEY.enter)
    await settle()
    expect(bench.settings.writes).toEqual([{ ns: 'blue', patch: { updateCheck: false }, revision: 1 }])
    expect(bench.notices).toEqual(['update check set to false'])
    // The accepted write does NOT remount: the list's own cycle already
    // displays the value, and lastKnown moved with it.
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.components.settingsLists[0]?.options.items[0]?.currentValue).toBe('false')
    expect(bench.screen.renderRequests).toBe(0)
    // A document-updated with no further change diffs empty: no updateValue.
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
    expect(bench.screen.renderRequests).toBe(0)
  })

  it('writes enum and number cycles as strings and numbers', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    const onChange = bench.components.settingsLists.at(-1)!.options.onChange
    onChange('blue.theme', 'ocean')
    onChange('shell.timeoutMs', '120000')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'blue', patch: { theme: 'ocean' }, revision: 1 },
      { ns: 'shell', patch: { timeoutMs: 120_000 }, revision: 1 },
    ])
    expect(bench.notices).toEqual(['theme set to ocean', 'shell timeout (ms) set to 120000'])
  })

  it('writes the permission preset row through to the permission namespace', async () => {
    const bench = mount({ sections: fullSections(), presets: fakePresets() })
    await bench.command.handler()
    const onChange = bench.components.settingsLists.at(-1)!.options.onChange
    onChange('permission.defaultPreset', 'read-only')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'permission', patch: { defaultPreset: 'read-only' }, revision: 1 },
    ])
    expect(bench.notices).toEqual(['default permission preset set to read-only'])
  })

  it('unsets the reasoning effort when cycled to default', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    const onChange = bench.components.settingsLists.at(-1)!.options.onChange
    onChange('agent-default-model.reasoningEffort', 'default')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'agent-default-model', ops: [{ op: 'unset', path: ['reasoningEffort'] }], revision: 1 },
    ])
    expect(bench.notices).toEqual(['default reasoning effort set to default'])
  })

  it('retries a stale revision once and then succeeds', async () => {
    let calls = 0
    const bench = mount({
      sections: fullSections(),
      updateImpl: (ns, patch) => {
        calls += 1
        if (calls === 1) throw new SettingsConflictError(settingsNamespace(ns), 1, 2)
        bench.settings.sections[ns] = { ...bench.settings.sections[ns], ...patch }
        return Promise.resolve()
      },
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(calls).toBe(2)
    expect(bench.notices).toEqual(['theme set to paper'])
    expect(bench.components.settingsLists).toHaveLength(1)
  })

  it('flashes the error after the retry also conflicts and rolls the row back', async () => {
    const bench = mount({
      sections: fullSections(),
      updateImpl: ns => {
        throw new SettingsConflictError(settingsNamespace(ns), 1, 3)
      },
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(bench.settings.writes).toHaveLength(2)
    expect(bench.notices).toHaveLength(1)
    expect(bench.notices[0]).toContain('could not update theme')
    // The rejected cycle is rolled back to the last committed display.
    const list = bench.components.settingsLists[0]!
    expect(list.updates).toEqual([['blue.theme', 'dark']])
    expect(list.options.items.find(item => item.id === 'blue.theme')?.currentValue).toBe('dark')
    expect(bench.screen.renderRequests).toBe(1)
  })

  it('flashes a plain write failure without retrying and rolls the row back', async () => {
    const bench = mount({
      sections: fullSections(),
      updateImpl: () => Promise.reject(new Error('schema rejected')),
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.updateCheck', 'false')
    await settle()
    expect(bench.settings.writes).toHaveLength(1)
    expect(bench.notices[0]).toContain('could not update update check: schema rejected')
    expect(bench.components.settingsLists[0]?.updates).toEqual([['blue.updateCheck', 'true']])
  })

  it('stringifies non-Error rejections in the failure notice', async () => {
    const bench = mount({
      sections: fullSections(),
      updateImpl: () => Promise.reject('plain reject'),
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(bench.notices[0]).toContain('could not update theme: plain reject')
  })

  it('returns silently for a vanished namespace or an unknown row id', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    const onChange = bench.components.settingsLists.at(-1)!.options.onChange
    bench.settings.drop('shell')
    onChange('shell.timeoutMs', '120000')
    onChange('bogus.row', 'x')
    await settle()
    expect(bench.settings.writes).toEqual([])
    expect(bench.notices).toEqual([])
  })

  it('skips the notice when the panel closed behind a pending write', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const bench = mount({
      sections: fullSections(),
      updateImpl: () => gate,
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'light')
    panel(bench.screen).handleInput(KEY.escape)
    release()
    await settle()
    expect(bench.notices).toEqual([])
    expect(bench.components.settingsLists).toHaveLength(1)
  })

  it('skips the failure notice when the panel closed behind a pending rejection', async () => {
    let reject!: (error: Error) => void
    const gate = new Promise<void>((_resolve, rejectPromise) => {
      reject = rejectPromise
    })
    const bench = mount({
      sections: fullSections(),
      updateImpl: () => gate,
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'light')
    panel(bench.screen).handleInput(KEY.escape)
    reject(new Error('late failure'))
    await settle()
    expect(bench.notices).toEqual([])
    // The rollback is gated on the panel too: no updateValue, no repaint.
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
    expect(bench.screen.renderRequests).toBe(0)
  })

  it('flags continuations unloaded when the registration disposer runs', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const bench = mount({
      sections: fullSections(),
      updateImpl: () => gate,
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'light')
    bench.dispose()
    release()
    await settle()
    expect(bench.notices).toEqual([])
    expect(bench.components.settingsLists).toHaveLength(1)
  })
})

describe('/settings refresh', () => {
  it('ignores a document-updated whose values match the panel', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
    expect(bench.screen.renderRequests).toBe(0)
  })

  it('pushes changed values into the live list without remounting', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    bench.settings.sections.blue!.theme = 'ocean'
    bench.settings.sections.shell!.timeoutMs = 300_000
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    const list = bench.components.settingsLists[0]!
    // Exactly the deltas land on updateValue; one repaint, no remount.
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(list.updates).toEqual([['blue.theme', 'ocean'], ['shell.timeoutMs', '300000']])
    expect(list.options.items.find(item => item.id === 'blue.theme')?.currentValue).toBe('ocean')
    expect(bench.screen.renderRequests).toBe(1)
    // lastKnown moved with the diff: a second emission diffs empty.
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 3)
    await settle()
    expect(list.updates).toHaveLength(2)
    expect(bench.screen.renderRequests).toBe(1)
  })

  it('remounts only when the row set changed', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    bench.settings.drop('shell')
    bench.ctx.emit('settings/document-updated', settingsNamespace('shell'), 2)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(2)
    const rebuilt = bench.components.settingsLists.at(-1)!
    expect(rebuilt.options.items.some(item => item.id.startsWith('shell.'))).toBe(false)
    expect(bench.screen.overlays[0]?.hidden).toBe(true)
  })

  it('stops refreshing after close', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    panel(bench.screen).handleInput(KEY.escape)
    bench.settings.sections.blue!.theme = 'ocean'
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
    expect(bench.screen.overlays.every(overlay => overlay.hidden)).toBe(true)
  })

  it('skips the refresh when the registration disposer ran before an event', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    bench.settings.sections.blue!.theme = 'ocean'
    bench.dispose()
    // The panel is still open (dispose only flags unloaded): the listener
    // fires, and the inactive guard swallows it.
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 5)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
  })

  it('never remounts when the write commit announces itself through the event', async () => {
    const bench = mount({
      sections: fullSections(),
      onWrite: ns => {
        bench.ctx.emit('settings/document-updated', settingsNamespace(ns), 2)
      },
    })
    await bench.command.handler()
    const list = () => bench.components.settingsLists[0]!
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.notices).toEqual(['theme set to paper'])
    // The synchronous watcher fired before lastKnown moved, so its diff
    // pushed the fresh value once; a debounced real watcher lands after
    // the write and diffs empty.
    expect(list().updates).toEqual([['blue.theme', 'paper']])
  })

  it('skips the value rollback when a mid-write remount already dropped the row', async () => {
    const bench = mount({
      sections: fullSections(),
      updateImpl: ns => {
        // The namespace vanishes mid-write and the watcher announces it:
        // the refresh remounts without the row before the write fails.
        bench.settings.drop(ns)
        bench.ctx.emit('settings/document-updated', settingsNamespace(ns), 2)
        throw new Error('gone mid-write')
      },
    })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(bench.components.settingsLists).toHaveLength(2)
    expect(bench.notices[0]).toContain('could not update theme')
    // The rebuilt list has no blue rows to roll back; the failure still
    // repaints for the notice.
    expect(bench.components.settingsLists.at(-1)!.updates).toEqual([])
    expect(bench.screen.renderRequests).toBe(1)
  })
})

describe('/settings open-file', () => {
  it('notices when the document is unavailable or cannot be prepared', async () => {
    const unavailable = mount({ sections: fullSections() })
    await unavailable.command.handler()
    unavailable.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(unavailable.notices).toEqual(['settings file unavailable'])

    const failing = mount({
      sections: fullSections(),
      prepareDocument: () => Promise.reject(new Error('disk gone')),
    })
    await failing.command.handler()
    failing.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(failing.notices).toEqual(['settings file unavailable'])
  })

  it('notices when no editor is configured', async () => {
    vi.stubEnv('VISUAL', '')
    vi.stubEnv('EDITOR', '')
    const dir = mkdtempTracked('blue-settings-command-')
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'theme: dark\n', 'utf-8')
    const bench = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(path) })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(bench.notices).toEqual(['no editor configured ($VISUAL/$EDITOR)'])
    expect(bench.screen.suspends).toBe(0)
  })

  it('edits the document through the suspend seam and writes the result back', async () => {
    vi.stubEnv('VISUAL', '')
    vi.stubEnv('EDITOR', 'test-editor')
    const dir = mkdtempTracked('blue-settings-command-')
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'theme: dark\n', 'utf-8')
    const seen: { text?: string, command?: string } = {}
    setExternalEditorLauncher((text, command) => {
      seen.text = text
      seen.command = command
      return Promise.resolve('theme: ocean\n')
    })
    const bench = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(path) })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(seen).toEqual({ text: 'theme: dark\n', command: 'test-editor' })
    expect(bench.screen.suspends).toBe(1)
    expect(await readFile(path, 'utf-8')).toBe('theme: ocean\n')
  })

  it('leaves the document untouched when the editor exits nonzero or makes no change', async () => {
    vi.stubEnv('EDITOR', 'test-editor')
    const dir = mkdtempTracked('blue-settings-command-')
    const quit = join(dir, 'quit.yaml')
    const same = join(dir, 'same.yaml')
    await writeFile(quit, 'a: 1\n', 'utf-8')
    await writeFile(same, 'b: 2\n', 'utf-8')
    setExternalEditorLauncher(text => Promise.resolve(text === 'a: 1\n' ? undefined : text))
    const bench = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(quit) })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(await readFile(quit, 'utf-8')).toBe('a: 1\n')
    // The unchanged-text arm: same bytes back, no write.
    const reopened = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(same) })
    await reopened.command.handler()
    reopened.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(await readFile(same, 'utf-8')).toBe('b: 2\n')
  })

  it('notices when the document cannot be read or written', async () => {
    vi.stubEnv('EDITOR', 'test-editor')
    setExternalEditorLauncher(() => Promise.resolve('edited: true\n'))
    // The read failure: prepareDocument resolves a directory.
    const dir = mkdtempTracked('blue-settings-command-')
    const unreadable = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(dir) })
    await unreadable.command.handler()
    unreadable.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(unreadable.notices[0]).toContain('could not read settings file')
    // The write failure: a permission-stripped document.
    const locked = join(dir, 'settings.yaml')
    await writeFile(locked, 'theme: dark\n', 'utf-8')
    await chmod(locked, 0o444)
    const unwritable = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(locked) })
    await unwritable.command.handler()
    unwritable.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    expect(unwritable.notices[0]).toContain('could not write settings file')
  })

  it('skips the write-back when the panel closed while the editor was open', async () => {
    vi.stubEnv('EDITOR', 'test-editor')
    const dir = mkdtempTracked('blue-settings-command-')
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'theme: dark\n', 'utf-8')
    let release!: (text: string) => void
    const gate = new Promise<string>(resolve => {
      release = resolve
    })
    setExternalEditorLauncher(() => gate)
    const bench = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(path) })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    await settle()
    panel(bench.screen).handleInput(KEY.escape)
    release('theme: ocean\n')
    await settle()
    expect(await readFile(path, 'utf-8')).toBe('theme: dark\n')
  })

  it('skips everything when the panel closed before the document was prepared', async () => {
    let release!: (path: string) => void
    const gate = new Promise<string>(resolve => {
      release = resolve
    })
    const dir = mkdtempTracked('blue-settings-command-')
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'theme: dark\n', 'utf-8')
    const bench = mount({ sections: fullSections(), prepareDocument: () => gate })
    await bench.command.handler()
    bench.components.settingsLists.at(-1)!.options.onChange('open-file', '')
    panel(bench.screen).handleInput(KEY.escape)
    release(path)
    await settle()
    expect(bench.notices).toEqual([])
    expect(bench.screen.suspends).toBe(0)
  })
})

describe('SettingsPanel', () => {
  it('tolerates a list without input handling and forwards invalidate', () => {
    const invalidate = vi.fn()
    const surface = new SettingsPanel({
      theme: { colors: new Proxy({}, { get: () => (text: string) => text }) } as never,
      list: { render: () => ['row'], invalidate } as never,
    })
    expect(surface.focused).toBe(false)
    expect(() => surface.handleInput('x')).not.toThrow()
    surface.invalidate()
    expect(invalidate).toHaveBeenCalledOnce()
    // Rule, title, body row, key-hint footer, rule.
    expect(surface.render(40)).toHaveLength(5)
  })
})
