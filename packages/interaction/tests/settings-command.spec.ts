/**
 * Tests for the `/settings` command and its two-level panel: the
 * service/display guards, the level-one namespace list (namespace absence,
 * the dynamic permission/agent-preset rows' gating, the open-file action),
 * the level-two item lists (off-preset merges, unset tokens, the editable
 * row's free-form form, the restart suffix), the write path (parsed patches
 * with descriptor revisions, unsets through `mutate`, the conflict retry,
 * the in-panel feedback row, the updateValue rollback on failure), the
 * diff-and-update refresh (rebuild on a row-set change, level-one fallback
 * when the open namespace disappears), the theme-swap re-home, and the
 * open-file flow through the external-editor seam.
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
import { FormPanel } from '../src/form-panel.ts'
import type { PermissionPresetsService } from '../src/permission-panel.ts'
import { NoticeTail, registerSettingsCommand, SettingsPanel } from '../src/settings-command.ts'
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
  /** Per-namespace effect timing overrides (default 'live'). */
  readonly applies?: Record<string, 'live' | 'restart'>
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
      ns, schema: {}, value, revision: revisions.get(ns) ?? 0,
      applies: options.applies?.[ns] ?? ('live' as const),
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

/** The fake agent-presets roster: only `list()` reaches the panel. */
interface FakeRoster {
  readonly list: () => Promise<readonly { readonly id: string }[]>
}

interface BenchOptions extends SettingsFakeOptions {
  readonly withSettings?: boolean
  readonly presets?: PermissionPresetsService
  readonly roster?: FakeRoster
}

/** Mount the command with fakes: commands registry, settings, presets, roster, shared editor. */
function mount(options: BenchOptions = {}) {
  const { ctx, screen, components, theme } = fakeBlueContext()
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
  if (options.roster !== undefined) ctx.provide('agentPresets', options.roster as never)
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
  return { ctx, screen, components, theme, settings, notices, dispose, command }
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

/** The roster fake: two presets in roster order. */
function fakeRoster(ids: readonly string[] = ['reviewer', 'default']): FakeRoster {
  return { list: () => Promise.resolve(ids.map(id => ({ id }))) }
}

/** Every namespace the panel lists, with resolved values. */
function fullSections(): Record<string, Record<string, unknown>> {
  return {
    blue: {
      updateCheck: true, updateChannel: 'rc', theme: 'dark',
      collapseThinking: true, collapseToolCalls: true,
      windowTurns: 15, recentStepsRetention: 30, expandTurns: 3,
      userFoldLines: 10, userFoldChars: 1000,
      editorCommand: '', pasteImageBackend: 'auto',
    },
    shell: {
      timeoutMs: 60_000, maxTimeoutMs: 600_000, maxOutputBytes: 64_000,
      maxSpillBytes: 67_108_864, graceMs: 3_000,
    },
    'agent-loop': { maxParallelToolCalls: 5 },
    'agent-default-model': { reasoningEffort: 'low' },
    'llm-deepseek': { thinking: 'enabled' },
    'web-search-deepseek': { maxUses: 3, maxTokens: 4096 },
    permission: { defaultPreset: 'workspace-write' },
    'agent-presets': { default: 'reviewer' },
  }
}

/** The last UNHIDDEN overlay whose component is of the given type. */
function topOverlay<T>(screen: FakeScreen, type: new (...args: never[]) => T): T | undefined {
  const entry = [...screen.overlays].reverse().find(overlay => !overlay.hidden && overlay.component instanceof type)
  return entry?.component as T | undefined
}

/** The mounted level-one panel (the SelectListPanel's notice-tail wrapper). */
function l1(screen: FakeScreen): NoticeTail {
  const entry = topOverlay(screen, NoticeTail)
  if (entry === undefined) throw new Error('no level-one panel mounted')
  return entry
}

/** The mounted level-two panel, when a namespace is open. */
function l2(screen: FakeScreen): SettingsPanel | undefined {
  return topOverlay(screen, SettingsPanel)
}

/** The mounted free-form form, when an editable row is being edited. */
function form(screen: FakeScreen): FormPanel | undefined {
  return topOverlay(screen, FormPanel)
}

/**
 * Render the topmost live panel to text. Feedback assertions read the
 * panels' own notice row — the editor's hint line leaves the tree while a
 * panel is open, so outcomes render with the panel (level two inside the
 * frame, level one tailed under it).
 */
function frameText(bench: { screen: FakeScreen }): string {
  const entry = [...bench.screen.overlays].reverse().find(overlay => !overlay.hidden)
  if (entry === undefined) throw new Error('no live panel mounted')
  return entry.component.render(80).join('\n')
}

/** The label under the level-one cursor (the ❯ row's text, marker paints stripped). */
function l1CursorLabel(panel: NoticeTail): string {
  const row = panel.render(80)
    .map(line => line.replaceAll('^', '').replaceAll('~', ''))
    .find(line => line.includes('❯'))
  return row?.split('❯ ')[1]?.split(' — ')[0]?.trim() ?? ''
}

/** Move the level-one cursor onto the row with the given label and press Enter. */
async function selectL1(bench: { screen: FakeScreen }, label: string): Promise<void> {
  const panel = l1(bench.screen)
  for (let guard = 0; guard < 30 && l1CursorLabel(panel) !== label; guard += 1) {
    panel.handleInput(KEY.down)
  }
  if (l1CursorLabel(panel) !== label) throw new Error(`level-one row not found: ${label}`)
  panel.handleInput(KEY.enter)
  await settle()
}

/** Open a namespace's level-two list. */
async function openNamespace(bench: { screen: FakeScreen }, ns: string): Promise<void> {
  await selectL1(bench, ns)
  if (l2(bench.screen) === undefined) throw new Error(`namespace did not open: ${ns}`)
}

/** Close every open level: form, then level two, then level one. */
function closeAll(bench: { screen: FakeScreen }): void {
  form(bench.screen)?.handleInput(KEY.escape)
  l2(bench.screen)?.handleInput(KEY.escape)
  topOverlay(bench.screen, NoticeTail)?.handleInput(KEY.escape)
}

/** Flush the write path's async continuations. */
function settle(ms = 10): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('/settings registration and guards', () => {
  it('registers the command and errors when the settings service is absent', async () => {
    const { command } = mount({ withSettings: false })
    expect(command.description).toBe(
      'Edit user settings by namespace (update, theme, folding, transcript, shell, agent, search, permission)',
    )
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

  it('mounts nothing when the registration disposed behind the opening fetch', async () => {
    let release!: (rows: readonly { readonly id: string }[]) => void
    const gate = new Promise<readonly { readonly id: string }[]>(resolve => {
      release = resolve
    })
    const bench = mount({ sections: fullSections(), roster: { list: () => gate } })
    const pending = bench.command.handler()
    bench.dispose()
    release([{ id: 'reviewer' }])
    expect(await pending).toEqual({ kind: 'success' })
    expect(bench.screen.overlays).toHaveLength(0)
  })
})

describe('/settings level one', () => {
  it('renders every namespace in row order, with the open-file action last', async () => {
    const bench = mount({ sections: fullSections(), presets: fakePresets(), roster: fakeRoster() })
    const result = await bench.command.handler()
    expect(result).toEqual({ kind: 'success' })
    // Walk the cursor over all nine rows, collecting the pointer labels.
    const panel = l1(bench.screen)
    const labels: string[] = []
    for (let count = 0; count < 9; count += 1) {
      labels.push(l1CursorLabel(panel))
      panel.handleInput(KEY.down)
    }
    expect(labels).toEqual([
      'blue',
      'shell',
      'agent-loop',
      'agent-default-model',
      'llm-deepseek',
      'web-search-deepseek',
      'permission',
      'agent-presets',
      'Open settings.yaml in $EDITOR',
    ])
    // The frame carries the title and the muted title hint.
    const frame = panel.render(80).join('\n')
    expect(frame).toContain('settings')
    expect(frame).toContain('· esc close · ↵ open')
    expect(bench.components.settingsLists).toHaveLength(0)
  })

  it('annotates each namespace row with its blurb and row count', async () => {
    const bench = mount({ sections: fullSections(), presets: fakePresets(), roster: fakeRoster() })
    await bench.command.handler()
    const frame = l1(bench.screen).render(100)
      .map(line => line.replaceAll('^', '').replaceAll('~', '').replaceAll('_', ''))
      .join('\n')
    expect(frame).toContain('blue — Blue UI preferences · 12 settings')
    expect(frame).toContain('shell — bash tool limits · 5 settings')
    expect(frame).toContain('agent-presets — composition preset default · 1 settings')
  })

  it('omits namespaces the host did not register', async () => {
    const bench = mount({ sections: { blue: fullSections().blue! } })
    await bench.command.handler()
    const panel = l1(bench.screen)
    const labels: string[] = []
    for (let count = 0; count < 2; count += 1) {
      labels.push(l1CursorLabel(panel))
      panel.handleInput(KEY.down)
    }
    expect(labels).toEqual(['blue', 'Open settings.yaml in $EDITOR'])
  })

  it('gates the dynamic rows on both their namespace and their value source', async () => {
    // Namespace present, services absent: no rows.
    const withoutServices = mount({
      sections: { permission: { defaultPreset: 'read-only' }, 'agent-presets': {} },
    })
    await withoutServices.command.handler()
    const first = l1CursorLabel(l1(withoutServices.screen))
    expect(first).toBe('Open settings.yaml in $EDITOR')
    // Services present, namespaces absent: no rows.
    const withoutNs = mount({ sections: {}, presets: fakePresets(), roster: fakeRoster() })
    await withoutNs.command.handler()
    expect(l1CursorLabel(l1(withoutNs.screen))).toBe('Open settings.yaml in $EDITOR')
    // A failing roster discovery degrades to omitting the agent-preset row.
    const failing = mount({
      sections: { 'agent-presets': {} },
      roster: { list: () => Promise.reject(new Error('roster gone')) },
    })
    await failing.command.handler()
    expect(l1CursorLabel(l1(failing.screen))).toBe('Open settings.yaml in $EDITOR')
  })

  it('stacks level two above level one and Escape walks back down', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    expect(bench.screen.overlays).toHaveLength(2)
    expect(l2(bench.screen)).toBeDefined()
    // Escape on level two pops back to the namespace list, still open.
    l2(bench.screen)!.handleInput(KEY.escape)
    expect(l2(bench.screen)).toBeUndefined()
    expect(topOverlay(bench.screen, NoticeTail)).toBeDefined()
    // Escape on level one closes the panel; a second Escape is a no-op.
    const groups = l1(bench.screen)
    groups.handleInput(KEY.escape)
    expect(bench.screen.overlays.every(overlay => overlay.hidden)).toBe(true)
    groups.handleInput(KEY.escape)
    expect(bench.screen.overlays).toHaveLength(2)
  })
})

describe('/settings level two', () => {
  it('lists the blue rows in order, with resolved values and the namespace frame', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    const items = bench.components.settingsLists.at(-1)!.options.items
    expect(items.map(item => item.id)).toEqual([
      'blue.updateCheck',
      'blue.updateChannel',
      'blue.theme',
      'blue.collapseThinking',
      'blue.collapseToolCalls',
      'blue.windowTurns',
      'blue.recentStepsRetention',
      'blue.expandTurns',
      'blue.userFoldLines',
      'blue.userFoldChars',
      'blue.editorCommand',
      'blue.pasteImageBackend',
    ])
    const byId = new Map(items.map(item => [item.id, item]))
    expect(byId.get('blue.updateCheck')?.currentValue).toBe('true')
    expect(byId.get('blue.windowTurns')?.currentValue).toBe('15')
    // The blank editor command displays through its emptyDisplay token.
    expect(byId.get('blue.editorCommand')?.currentValue).toBe('auto')
    expect(byId.get('blue.editorCommand')?.values).toEqual(['auto'])
    // The frame carries the namespace title and the key-hint footer.
    const frame = frameText(bench)
    expect(frame).toContain('settings › blue')
    expect(frame).toContain('↑↓ select · ↵ change · esc back')
  })

  it('merges off-preset and unresolved current values into the cycle', async () => {
    const bench = mount({
      sections: {
        blue: { theme: 'ocean', editorCommand: 42 },
        shell: { timeoutMs: 45_000 },
        'agent-default-model': {},
        'llm-deepseek': {},
        'agent-presets': {},
        permission: { defaultPreset: 'custom-x' },
      },
      presets: fakePresets(),
      roster: fakeRoster(),
    })
    await bench.command.handler()
    const itemsOf = async (ns: string) => {
      await openNamespace(bench, ns)
      const items = bench.components.settingsLists.at(-1)!.options.items
      l2(bench.screen)!.handleInput(KEY.escape)
      return new Map(items.map(item => [item.id, item]))
    }
    const blue = await itemsOf('blue')
    // A key absent from the resolved section falls back to the first preset.
    expect(blue.get('blue.updateCheck')?.currentValue).toBe('true')
    // A non-string raw on the editable row still stringifies for display.
    expect(blue.get('blue.editorCommand')?.currentValue).toBe('42')
    const shell = await itemsOf('shell')
    // An off-preset number merges in as the current selection.
    expect(shell.get('shell.timeoutMs')?.values).toEqual(['45000', '30000', '60000', '120000', '300000', '600000'])
    const effort = await itemsOf('agent-default-model')
    // An omitted reasoning effort displays as the unset token.
    expect(effort.get('agent-default-model.reasoningEffort')?.currentValue).toBe('default')
    expect(effort.get('agent-default-model.reasoningEffort')?.values)
      .toEqual(['default', 'off', 'low', 'high', 'max'])
    const thinking = await itemsOf('llm-deepseek')
    expect(thinking.get('llm-deepseek.thinking')?.currentValue).toBe('default')
    const agentPresets = await itemsOf('agent-presets')
    expect(agentPresets.get('agent-presets.default')?.currentValue).toBe('none')
    expect(agentPresets.get('agent-presets.default')?.values).toEqual(['none', 'reviewer', 'default'])
    const permission = await itemsOf('permission')
    // An off-table preset merges in likewise.
    expect(permission.get('permission.defaultPreset')?.values).toEqual(['custom-x', 'read-only', 'workspace-write'])
  })

  it('keeps the permission row with an empty presets table', async () => {
    const bench = mount({ sections: { permission: { defaultPreset: '' } }, presets: fakePresets([]) })
    await bench.command.handler()
    await openNamespace(bench, 'permission')
    const row = bench.components.settingsLists.at(-1)!.options.items
      .find(item => item.id === 'permission.defaultPreset')
    expect(row?.currentValue).toBe('')
    expect(row?.values).toEqual([''])
  })

  it('renders a non-scalar stored value as the blank cycle fallback', async () => {
    // Dirty data (an object where a preset name belongs) with an empty
    // presets table: no cycle entry to fall back on, so the display is blank.
    const bench = mount({ sections: { permission: { defaultPreset: {} } }, presets: fakePresets([]) })
    await bench.command.handler()
    await openNamespace(bench, 'permission')
    const row = bench.components.settingsLists.at(-1)!.options.items
      .find(item => item.id === 'permission.defaultPreset')
    expect(row?.currentValue).toBe('')
    expect(row?.values).toEqual([''])
  })

  it('marks restart-applied rows with a description suffix', async () => {
    const bench = mount({ sections: fullSections(), applies: { shell: 'restart' } })
    await bench.command.handler()
    await openNamespace(bench, 'shell')
    const row = bench.components.settingsLists.at(-1)!.options.items
      .find(item => item.id === 'shell.timeoutMs')
    expect(row?.description).toBe('default bash command timeout · restart to apply')
  })
})

describe('/settings writes', () => {
  it('cycles a boolean through the list keys and writes the parsed patch with the revision', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    l2(bench.screen)!.handleInput(KEY.enter)
    await settle()
    expect(bench.settings.writes).toEqual([{ ns: 'blue', patch: { updateCheck: false }, revision: 1 }])
    // The outcome paints in the panel's own feedback row (one repaint for
    // it), never on the editor's hint line.
    expect(frameText(bench)).toContain('update check set to false')
    expect(bench.notices).toEqual([])
    // The accepted write does NOT remount: the list's own cycle already
    // displays the value, and lastKnown moved with it.
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.components.settingsLists[0]?.options.items[0]?.currentValue).toBe('false')
    expect(bench.screen.renderRequests).toBe(1)
    // A document-updated with no further change diffs empty: no updateValue.
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
    expect(bench.screen.renderRequests).toBe(1)
  })

  it('writes enum and number cycles as strings and numbers', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'ocean')
    await settle()
    l2(bench.screen)!.handleInput(KEY.escape)
    await openNamespace(bench, 'shell')
    bench.components.settingsLists.at(-1)!.options.onChange('shell.timeoutMs', '120000')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'blue', patch: { theme: 'ocean' }, revision: 1 },
      { ns: 'shell', patch: { timeoutMs: 120_000 }, revision: 1 },
    ])
    // The feedback row carries the latest outcome.
    expect(frameText(bench)).toContain('shell timeout (ms) set to 120000')
  })

  it('writes the permission preset row through to the permission namespace', async () => {
    const bench = mount({ sections: fullSections(), presets: fakePresets() })
    await bench.command.handler()
    await openNamespace(bench, 'permission')
    bench.components.settingsLists.at(-1)!.options.onChange('permission.defaultPreset', 'read-only')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'permission', patch: { defaultPreset: 'read-only' }, revision: 1 },
    ])
    expect(frameText(bench)).toContain('default permission preset set to read-only')
  })

  it('unsets the reasoning effort when cycled to default', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'agent-default-model')
    bench.components.settingsLists.at(-1)!.options.onChange('agent-default-model.reasoningEffort', 'default')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'agent-default-model', ops: [{ op: 'unset', path: ['reasoningEffort'] }], revision: 1 },
    ])
    expect(frameText(bench)).toContain('default reasoning effort set to default')
  })

  it('writes and unsets the DeepSeek thinking switch', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'llm-deepseek')
    const onChange = bench.components.settingsLists.at(-1)!.options.onChange
    onChange('llm-deepseek.thinking', 'disabled')
    await settle()
    onChange('llm-deepseek.thinking', 'default')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'llm-deepseek', patch: { thinking: 'disabled' }, revision: 1 },
      { ns: 'llm-deepseek', ops: [{ op: 'unset', path: ['thinking'] }], revision: 2 },
    ])
    expect(frameText(bench)).toContain('deepseek thinking set to default')
  })

  it('cycles the default agent preset through the roster ids and none', async () => {
    const bench = mount({ sections: fullSections(), roster: fakeRoster() })
    await bench.command.handler()
    await openNamespace(bench, 'agent-presets')
    const onChange = bench.components.settingsLists.at(-1)!.options.onChange
    onChange('agent-presets.default', 'default')
    await settle()
    onChange('agent-presets.default', 'none')
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'agent-presets', patch: { default: 'default' }, revision: 1 },
      { ns: 'agent-presets', ops: [{ op: 'unset', path: ['default'] }], revision: 2 },
    ])
    expect(frameText(bench)).toContain('default agent preset set to none')
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
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(calls).toBe(2)
    expect(frameText(bench)).toContain('theme set to paper')
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
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(bench.settings.writes).toHaveLength(2)
    expect(frameText(bench)).toContain('could not update theme')
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
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.updateCheck', 'false')
    await settle()
    expect(bench.settings.writes).toHaveLength(1)
    expect(frameText(bench)).toContain('could not update update check: schema rejected')
    expect(bench.components.settingsLists[0]?.updates).toEqual([['blue.updateCheck', 'true']])
  })

  it('stringifies non-Error rejections in the failure notice', async () => {
    const bench = mount({
      sections: fullSections(),
      updateImpl: () => Promise.reject('plain reject'),
    })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(frameText(bench)).toContain('could not update theme: plain reject')
  })

  it('returns silently for a vanished namespace or an unknown row id', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    const onChange = bench.components.settingsLists.at(-1)!.options.onChange
    bench.settings.drop('shell')
    onChange('shell.timeoutMs', '120000')
    onChange('bogus.row', 'x')
    await settle()
    expect(bench.settings.writes).toEqual([])
    expect(bench.notices).toEqual([])
    expect(frameText(bench)).not.toContain('could not')
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
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'light')
    closeAll(bench)
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
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'light')
    closeAll(bench)
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
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'light')
    bench.dispose()
    release()
    await settle()
    expect(bench.notices).toEqual([])
    expect(bench.components.settingsLists).toHaveLength(1)
  })
})

describe('/settings editable rows', () => {
  it('opens the free-form form on Enter and writes the submitted text', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    // The single-entry cycle reports the current display unchanged; the
    // callback opens the form instead of writing.
    bench.components.settingsLists.at(-1)!.options.onChange('blue.editorCommand', 'auto')
    const panel = form(bench.screen)
    expect(panel).toBeDefined()
    expect(bench.settings.writes).toEqual([])
    for (const char of 'vim') panel!.handleInput(char)
    panel!.handleInput(KEY.enter)
    await settle()
    expect(bench.settings.writes).toEqual([{ ns: 'blue', patch: { editorCommand: 'vim' }, revision: 1 }])
    // The form path pushes the display itself (pi-tui's cycle never moved).
    expect(bench.components.settingsLists[0]?.updates).toEqual([['blue.editorCommand', 'vim']])
    expect(frameText(bench)).toContain('external editor set to vim')
    expect(form(bench.screen)).toBeUndefined()
  })

  it('prefills the stored command and unsets the key on an empty submission', async () => {
    const bench = mount({
      sections: { ...fullSections(), blue: { ...fullSections().blue, editorCommand: 'nano' } },
    })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.editorCommand', 'nano')
    const panel = form(bench.screen)!
    // The prefill is the stored raw, not the display token: clear it.
    for (let count = 0; count < 4; count += 1) panel.handleInput('\x7f')
    panel.handleInput(KEY.enter)
    await settle()
    expect(bench.settings.writes).toEqual([
      { ns: 'blue', ops: [{ op: 'unset', path: ['editorCommand'] }], revision: 1 },
    ])
    expect(bench.components.settingsLists[0]?.updates).toEqual([['blue.editorCommand', 'auto']])
    expect(frameText(bench)).toContain('external editor set to auto')
  })

  it('cancels the form without writing', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.editorCommand', 'auto')
    form(bench.screen)!.handleInput(KEY.escape)
    await settle()
    expect(bench.settings.writes).toEqual([])
    expect(form(bench.screen)).toBeUndefined()
    expect(l2(bench.screen)).toBeDefined()
  })
})

describe('/settings refresh', () => {
  it('ignores a document-updated whose values match the panel', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
    expect(bench.screen.renderRequests).toBe(0)
  })

  it('pushes changed values into the open list without remounting', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.settings.sections.blue!.theme = 'ocean'
    bench.settings.sections.shell!.timeoutMs = 300_000
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    const list = bench.components.settingsLists[0]!
    // Exactly the OPEN namespace's deltas land on updateValue; the closed
    // shell change waits for its own list to open. One repaint, no remount.
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(list.updates).toEqual([['blue.theme', 'ocean']])
    expect(list.options.items.find(item => item.id === 'blue.theme')?.currentValue).toBe('ocean')
    expect(bench.screen.renderRequests).toBe(1)
    // lastKnown moved with the diff: a second emission diffs empty.
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 3)
    await settle()
    expect(list.updates).toHaveLength(1)
    expect(bench.screen.renderRequests).toBe(1)
  })

  it('remounts only when the row set changed', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.settings.drop('shell')
    bench.ctx.emit('settings/document-updated', settingsNamespace('shell'), 2)
    await settle()
    // Level one remounted (its rows changed) and level two rebuilt for the
    // still-present open namespace; the retired panels hide behind.
    expect(bench.components.settingsLists).toHaveLength(2)
    expect(bench.screen.overlays).toHaveLength(4)
    expect(bench.screen.overlays[0]?.hidden).toBe(true)
    expect(bench.screen.overlays[1]?.hidden).toBe(true)
    const rebuiltGroups = frameText(bench)
    expect(rebuiltGroups).not.toContain('shell ›')
    expect(l1CursorLabel(l1(bench.screen))).toBe('blue')
  })

  it('drops back to level one when the open namespace disappears', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'shell')
    bench.settings.drop('shell')
    bench.ctx.emit('settings/document-updated', settingsNamespace('shell'), 2)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(l2(bench.screen)).toBeUndefined()
    expect(topOverlay(bench.screen, NoticeTail)).toBeDefined()
    expect(bench.screen.overlays).toHaveLength(3)
  })

  it('stops refreshing after close', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    closeAll(bench)
    bench.settings.sections.blue!.theme = 'ocean'
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(bench.components.settingsLists[0]?.updates).toEqual([])
    expect(bench.screen.overlays.every(overlay => overlay.hidden)).toBe(true)
  })

  it('absorbs a same-rowset change at level one without touching the panel', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    // No namespace open: the diff has no live list to push into, and the
    // new baseline simply waits for the namespace to open.
    bench.settings.sections.blue!.theme = 'ocean'
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    await settle()
    expect(bench.components.settingsLists).toHaveLength(0)
    expect(bench.screen.renderRequests).toBe(0)
    await openNamespace(bench, 'blue')
    expect(bench.components.settingsLists[0]?.options.items
      .find(item => item.id === 'blue.theme')?.currentValue).toBe('ocean')
  })

  it('drops the refresh when the registration disposes behind the fetch', async () => {
    let release!: () => void
    const gate = new Promise<readonly { id: string }[]>(resolve => {
      release = () => resolve([{ id: 'reviewer' }])
    })
    const list = vi.fn()
      .mockResolvedValueOnce([{ id: 'reviewer' }])
      .mockReturnValueOnce(gate)
    const bench = mount({ sections: fullSections(), roster: { list } })
    await bench.command.handler()
    await settle()
    bench.settings.sections.blue!.theme = 'ocean'
    bench.ctx.emit('settings/document-updated', settingsNamespace('blue'), 2)
    // Wait for the refresh's own fetch to be in flight, then dispose
    // behind it: the continuation's inactive guard swallows the result.
    await vi.waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2)
    })
    bench.dispose()
    release()
    await settle()
    expect(bench.screen.renderRequests).toBe(0)
    expect(bench.components.settingsLists).toHaveLength(0)
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
    expect(bench.screen.overlays).toHaveLength(1)
  })

  it('never remounts when the write commit announces itself through the event', async () => {
    const bench = mount({
      sections: fullSections(),
      onWrite: ns => {
        bench.ctx.emit('settings/document-updated', settingsNamespace(ns), 2)
      },
    })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    const list = () => bench.components.settingsLists[0]!
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(frameText(bench)).toContain('theme set to paper')
    // The synchronous watcher's refresh lands behind the commit continuation
    // (fetchGroups yields), so lastKnown has already moved and the diff is
    // empty; a debounced real watcher behaves the same.
    expect(list().updates).toEqual([])
  })

  it('drops the rolled-back row with the mid-write rebuild', async () => {
    const bench = mount({
      sections: fullSections(),
      updateImpl: ns => {
        // The namespace vanishes mid-write and the watcher announces it:
        // the refresh rebuilds without the row before the failure lands.
        bench.settings.drop(ns)
        bench.ctx.emit('settings/document-updated', settingsNamespace(ns), 2)
        throw new Error('gone mid-write')
      },
    })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.theme', 'paper')
    await settle()
    // The rebuild retired the open list (blue is gone): level one alone is
    // live, and the failure notice renders on its notice tail.
    expect(bench.components.settingsLists).toHaveLength(1)
    expect(l2(bench.screen)).toBeUndefined()
    expect(frameText(bench)).toContain('could not update theme')
    expect(bench.screen.overlays).toHaveLength(3)
  })
})

describe('/settings re-home', () => {
  it('re-mounts the same panels on blue/input-editor-changed (the theme-swap rebuild)', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    const firstGroups = l1(bench.screen)
    const firstList = l2(bench.screen)
    bench.ctx.emit('blue/input-editor-changed')
    await settle()
    expect(bench.screen.overlays).toHaveLength(4)
    expect(bench.screen.overlays[0]?.hidden).toBe(true)
    expect(bench.screen.overlays[1]?.hidden).toBe(true)
    // The SAME instances re-home: no rebuild, so the lists (and their
    // highlights) survive the swap.
    expect(l1(bench.screen)).toBe(firstGroups)
    expect(l2(bench.screen)).toBe(firstList)
    expect(bench.components.settingsLists).toHaveLength(1)
  })

  it('re-homes an open form on top of the re-homed stack', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    bench.components.settingsLists.at(-1)!.options.onChange('blue.editorCommand', 'auto')
    const firstForm = form(bench.screen)
    expect(firstForm).toBeDefined()
    bench.ctx.emit('blue/input-editor-changed')
    await settle()
    expect(bench.screen.overlays).toHaveLength(6)
    expect(form(bench.screen)).toBe(firstForm)
  })

  it('stays closed when the editor changes after close', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    await openNamespace(bench, 'blue')
    closeAll(bench)
    bench.ctx.emit('blue/input-editor-changed')
    await settle()
    expect(bench.screen.overlays).toHaveLength(2)
    expect(bench.screen.overlays.every(overlay => overlay.hidden)).toBe(true)
  })

  it('skips the re-home when the registration disposer ran before the event', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    bench.dispose()
    bench.ctx.emit('blue/input-editor-changed')
    await settle()
    expect(bench.screen.overlays).toHaveLength(1)
  })

  it('reads the palette live across a theme swap', async () => {
    const bench = mount({ sections: fullSections() })
    await bench.command.handler()
    const marked = (text: string) => `SWAPPED<${text}>`
    ;(bench.theme as { colors: unknown }).colors = {
      ...bench.theme.colors,
      primary: marked,
    }
    expect(frameText(bench)).toContain('SWAPPED<  settings>')
  })
})

describe('/settings open-file', () => {
  /** Select the level-one open-file row. */
  const openFile = async (bench: { screen: FakeScreen }): Promise<void> => {
    await selectL1(bench, 'Open settings.yaml in $EDITOR')
  }

  it('notices when the document is unavailable or cannot be prepared', async () => {
    const unavailable = mount({ sections: fullSections() })
    await unavailable.command.handler()
    await openFile(unavailable)
    expect(frameText(unavailable)).toContain('settings file unavailable')

    const failing = mount({
      sections: fullSections(),
      prepareDocument: () => Promise.reject(new Error('disk gone')),
    })
    await failing.command.handler()
    await openFile(failing)
    expect(frameText(failing)).toContain('settings file unavailable')
  })

  it('notices when no editor is configured', async () => {
    vi.stubEnv('VISUAL', '')
    vi.stubEnv('EDITOR', '')
    const dir = mkdtempTracked('blue-settings-command-')
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'theme: dark\n', 'utf-8')
    const bench = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(path) })
    await bench.command.handler()
    await openFile(bench)
    expect(frameText(bench)).toContain('no editor configured ($VISUAL/$EDITOR)')
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
    await openFile(bench)
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
    await openFile(bench)
    expect(await readFile(quit, 'utf-8')).toBe('a: 1\n')
    // The unchanged-text arm: same bytes back, no write.
    const reopened = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(same) })
    await reopened.command.handler()
    await openFile(reopened)
    expect(await readFile(same, 'utf-8')).toBe('b: 2\n')
  })

  it('notices when the document cannot be read or written', async () => {
    vi.stubEnv('EDITOR', 'test-editor')
    setExternalEditorLauncher(() => Promise.resolve('edited: true\n'))
    // The read failure: prepareDocument resolves a directory.
    const dir = mkdtempTracked('blue-settings-command-')
    const unreadable = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(dir) })
    await unreadable.command.handler()
    await openFile(unreadable)
    expect(frameText(unreadable)).toContain('could not read settings file')
    // The write failure: a permission-stripped document.
    const locked = join(dir, 'settings.yaml')
    await writeFile(locked, 'theme: dark\n', 'utf-8')
    await chmod(locked, 0o444)
    const unwritable = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(locked) })
    await unwritable.command.handler()
    await openFile(unwritable)
    expect(frameText(unwritable)).toContain('could not write settings file')
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
    await openFile(bench)
    closeAll(bench)
    release('theme: ocean\n')
    await settle()
    expect(await readFile(path, 'utf-8')).toBe('theme: dark\n')
  })

  it('skips everything when the panel closed before the document was prepared', async () => {
    const dir = mkdtempTracked('blue-settings-command-')
    const path = join(dir, 'settings.yaml')
    await writeFile(path, 'theme: dark\n', 'utf-8')
    const bench = mount({ sections: fullSections(), prepareDocument: () => Promise.resolve(path) })
    await bench.command.handler()
    const opening = selectL1(bench, 'Open settings.yaml in $EDITOR')
    closeAll(bench)
    await opening
    expect(bench.notices).toEqual([])
    expect(bench.screen.suspends).toBe(0)
  })
})

describe('SettingsPanel', () => {
  it('ratchet-pads the body to the tallest height seen', () => {
    let rows = ['a', 'b', 'c']
    const surface = new SettingsPanel({
      theme: { colors: new Proxy({}, { get: () => (text: string) => text }) } as never,
      title: 'settings › blue',
      footer: ['↑↓ select', '↵ change', 'esc back'],
      list: { render: () => rows, invalidate: () => {} } as never,
      notice: {},
      truncate: text => text,
    })
    // Rule, title, three body rows, blank feedback row, footer, blank, rule.
    const tall = surface.render(40)
    expect(tall).toHaveLength(8)
    rows = ['a']
    // A shorter follow-up (a wrapping description settled) keeps the height.
    expect(surface.render(40)).toHaveLength(8)
  })

  it('tolerates a list without input handling and forwards invalidate', () => {
    const invalidate = vi.fn()
    const surface = new SettingsPanel({
      theme: { colors: new Proxy({}, { get: () => (text: string) => text }) } as never,
      title: 'settings › blue',
      footer: ['↑↓ select', '↵ change', 'esc back'],
      list: { render: () => ['row'], invalidate } as never,
      notice: {},
      truncate: text => text,
    })
    expect(surface.focused).toBe(false)
    expect(() => surface.handleInput('x')).not.toThrow()
    surface.invalidate()
    expect(invalidate).toHaveBeenCalledOnce()
    // Rule, title, body row, blank feedback row, key-hint footer, rule.
    expect(surface.render(40)).toHaveLength(6)
  })
})
