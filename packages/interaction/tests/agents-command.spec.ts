/**
 * Unit tests for `/agents`: the tree row builder (expansion, diagnostics,
 * metrics), the elapsed/token formatting, and the command over the real
 * command runtime — browser mount, expand/collapse, the `blueChildAttach`
 * service handoff on Enter (and the capability-absent notice when the
 * optional `blue-attach-view` plugin is not mounted), Escape/session-switch
 * close, and unload mid-listing.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueSubagentTreeEntry } from '@dsh-blue/blue-app'
import {
  agentMetricsText,
  buildAgentRows,
  formatAgentElapsed,
  registerAgentsCommand,
} from '../src/agents-command.ts'
import { EditorHostService, setEditorSlotSwap, setSharedEditor } from '../src/editor-instance.ts'
import { FakeBlueComponents, FakeKeymap, FakeScreen, FakeTheme, KEY } from './fakes.ts'

/** Strip SGR and the fake palette's marker characters so assertions read visible text. */
function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#!?@]/g, ''))
}

type ChildEntry = BlueSubagentTreeEntry & { readonly kind: 'child' }

/** One child tree-row fixture. */
function child(id: string, over: Partial<ChildEntry> = {}): ChildEntry {
  return {
    kind: 'child',
    id,
    parentId: 'agent-1',
    depth: 1,
    activity: 'inactive',
    hasChildren: false,
    mode: 'continuable',
    ...over,
  }
}

describe('formatAgentElapsed / agentMetricsText', () => {
  it('formats seconds, minutes, and clamps negatives', () => {
    expect(formatAgentElapsed(45_000)).toBe('45s')
    expect(formatAgentElapsed(130_000)).toBe('2m 10s')
    expect(formatAgentElapsed(-5)).toBe('0s')
  })

  it('joins tokens and elapsed, preferring the live clock over the settled one', () => {
    expect(agentMetricsText({}, 1000)).toBe('')
    expect(agentMetricsText({ tokens: 2048 }, 1000)).toBe('2k tok')
    expect(agentMetricsText({ settledMs: 65_000 }, 1000)).toBe('1m 5s')
    expect(agentMetricsText({ tokens: 100, settledMs: 5000, activeSince: 500 }, 3500)).toBe('100 tok · 3s')
  })
})

describe('buildAgentRows', () => {
  const tree: BlueSubagentTreeEntry[] = [
    child('parent', { activity: 'running', hasChildren: true, label: 'explore', tokens: 2048, activeSince: 1000 }),
    child('nested', { parentId: 'parent', depth: 2, mode: 'one-shot', label: undefined }),
    { kind: 'diagnostic', id: 'broken', parentId: 'agent-1', depth: 1, reason: 'corrupt' },
    child('orphaned', { parentId: 'ghost', depth: 2 }),
    child('leaf', {}),
  ]

  it('shows depth-1 rows by default and hides collapsed descendants and orphans', () => {
    const rows = buildAgentRows(tree, new Set())
    expect(rows.map(row => row.value)).toEqual(['parent', 'broken', 'leaf'])
    const parent = rows[0]!
    expect(parent.label).toBe('▸ ● explore')
    expect(parent.badge).toBe('running')
    expect(parent.description).toContain('continuable')
    expect(parent.description).toContain('2k tok')
    expect(rows[1]).toMatchObject({ label: '⚠ broken', description: 'diagnostic: corrupt', disabled: true })
    expect(rows[2]!.label).toBe('○ leaf')
  })

  it('reveals descendants of expanded rows with indentation and the open marker', () => {
    const rows = buildAgentRows(tree, new Set(['parent']))
    expect(rows.map(row => row.value)).toEqual(['parent', 'nested', 'broken', 'leaf'])
    expect(rows[0]!.label).toBe('▾ ● explore')
    expect(rows[1]!.label).toBe('  ○ nested')
    expect(rows[1]!.description).toBe('one-shot')
  })

  it('hides descendants of diagnostics and of non-expandable parents', () => {
    const diagnostics: BlueSubagentTreeEntry[] = [
      { kind: 'diagnostic', id: 'broken', parentId: 'agent-1', depth: 1, reason: 'unavailable' },
      child('under-diagnostic', { parentId: 'broken', depth: 2 }),
    ]
    expect(buildAgentRows(diagnostics, new Set()).map(row => row.value)).toEqual(['broken'])
    // A row hanging under a leaf parent is inconsistent host data; it hides.
    const underLeaf: BlueSubagentTreeEntry[] = [child('leaf'), child('under-leaf', { parentId: 'leaf', depth: 2 })]
    expect(buildAgentRows(underLeaf, new Set()).map(row => row.value)).toEqual(['leaf'])
  })
})

describe('registerAgentsCommand', () => {
  interface CommandHarness {
    readonly ctx: Context
    readonly screen: FakeScreen
    readonly agent: Agent
    readonly switchSession: (id: string) => void
    readonly pushSnapshot: (value: unknown) => void
    readonly opened: { readonly id: string, readonly label?: string, readonly mode: string }[]
    readonly notice: ReturnType<typeof vi.fn>
    tree: BlueSubagentTreeEntry[]
    treeError: { readonly code: string, readonly message: string } | undefined
    treeDefer: { readonly promise: Promise<BlueSubagentTreeEntry[]>, resolve: (value: BlueSubagentTreeEntry[]) => void } | undefined
  }

  /** Mount the command over in-memory seams and the real command runtime. */
  async function mount(options: { readonly display?: boolean, readonly attach?: boolean } = {}): Promise<CommandHarness> {
    const ctx = new Context()
    const screen = new FakeScreen()
    if (options.display !== false) {
      ctx.provide('blueScreen', screen as never)
      ctx.provide('blueTheme', new FakeTheme() as never)
      ctx.provide('blueKeymap', new FakeKeymap() as never)
      ctx.provide('blueComponents', new FakeBlueComponents() as never)
    }
    new EditorHostService(ctx)
    setEditorSlotSwap(ctx, { mount: component => screen.mountDialogPanel(component) })
    const notice = vi.fn()
    setSharedEditor(ctx, { notice } as never)
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('agents-spec'), { meta: { cwd: '/tmp/spec' } })
    const agent = { id: 'agent-1', session, status: 'idle', ctx: new Context() } as unknown as Agent

    const opened: { readonly id: string, readonly label?: string, readonly mode: string }[] = []
    let snapshot: unknown = { id: 'agent-1', cwd: '/tmp/spec', status: 'idle', mode: 'normal' }
    const readerListeners = new Set<(value: unknown) => void>()
    const harness: CommandHarness = {
      ctx,
      screen,
      agent,
      switchSession: id => {
        snapshot = { id, cwd: '/tmp/spec', status: 'idle', mode: 'normal' }
        // oxlint-disable-next-line no-useless-spread -- a listener may dispose its subscription mid-fan-out
        for (const listener of [...readerListeners]) listener(snapshot)
      },
      pushSnapshot: value => {
        snapshot = value
        // oxlint-disable-next-line no-useless-spread -- a listener may dispose its subscription mid-fan-out
        for (const listener of [...readerListeners]) listener(snapshot)
      },
      opened,
      notice,
      tree: [],
      treeError: undefined,
      treeDefer: undefined,
    }
    ctx.provide('blueSessionReader', {
      current: () => snapshot,
      subscribe(listener: (value: unknown) => void) {
        readerListeners.add(listener)
        listener(snapshot)
        return { dispose: () => readerListeners.delete(listener) }
      },
    } as never)
    ctx.provide('blueSessionActions', {
      subagentTree: async () => {
        if (harness.treeDefer !== undefined) await harness.treeDefer.promise
        return harness.treeError === undefined
          ? { ok: true, value: harness.tree }
          : { ok: false, code: harness.treeError.code, message: harness.treeError.message }
      },
    } as never)
    if (options.attach !== false) {
      ctx.provide('blueChildAttach', {
        active: false,
        open: (target: { readonly id: string, readonly label?: string, readonly mode: string }) => { opened.push(target) },
        close: () => {},
      } as never)
    }
    return harness
  }

  async function run(ctx: Context, agent: Agent, line: string) {
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    return execution?.result
  }

  it('registers /agents and reports an empty tree', async () => {
    const harness = await mount()
    const dispose = registerAgentsCommand(harness.ctx)
    expect(harness.ctx.commands.list().map(command => command.name)).toContain('agents')
    expect(await run(harness.ctx, harness.agent, '/agents')).toEqual({ kind: 'success', text: 'no subagents in this session' })
    dispose()
  })

  it('requires the display services and a readable tree', async () => {
    const noDisplay = await mount({ display: false })
    const disposeDisplay = registerAgentsCommand(noDisplay.ctx)
    expect(await run(noDisplay.ctx, noDisplay.agent, '/agents')).toMatchObject({ kind: 'error' })
    disposeDisplay()

    const failing = await mount()
    failing.treeError = { code: 'BLUE_SESSION_UNAVAILABLE', message: 'No session' }
    const disposeFailing = registerAgentsCommand(failing.ctx)
    expect(await run(failing.ctx, failing.agent, '/agents')).toEqual({ kind: 'error', text: 'No session' })
    disposeFailing()
  })

  it('browses the tree, expands and collapses children, and hands Enter to the attach service', async () => {
    const harness = await mount()
    harness.tree = [
      child('c1', { activity: 'running', hasChildren: true, label: 'explore', tokens: 1024 }),
      child('c2', { parentId: 'c1', depth: 2, mode: 'one-shot' }),
      { kind: 'diagnostic', id: 'broken', parentId: 'agent-1', depth: 1, reason: 'corrupt' },
    ]
    const dispose = registerAgentsCommand(harness.ctx)
    expect(await run(harness.ctx, harness.agent, '/agents')).toEqual({ kind: 'success' })
    const browser = harness.screen.overlays.at(-1)!
    let rows = plain(browser.component.render(100))
    expect(rows.some(row => row.includes('Subagents'))).toBe(true)
    expect(rows.some(row => row.includes('▸ ● explore'))).toBe(true)
    expect(rows.some(row => row.includes('c2'))).toBe(false)

    // Space expands the subtree; Space on a leaf and on a diagnostic is a no-op.
    browser.component.handleInput(KEY.space)
    rows = plain(browser.component.render(100))
    expect(rows.some(row => row.includes('○ c2'))).toBe(true)
    browser.component.handleInput(KEY.down)
    browser.component.handleInput(KEY.space)
    browser.component.handleInput(KEY.down)
    browser.component.handleInput(KEY.space)
    expect(plain(browser.component.render(100)).some(row => row.includes('broken'))).toBe(true)

    // Space on the expanded parent collapses it again; expand it once more.
    browser.component.handleInput(KEY.up)
    browser.component.handleInput(KEY.up)
    browser.component.handleInput(KEY.space)
    expect(plain(browser.component.render(100)).some(row => row.includes('c2'))).toBe(false)
    browser.component.handleInput(KEY.space)

    // Enter hands the child to the attach service; the browser stays open.
    browser.component.handleInput(KEY.enter)
    expect(harness.opened).toEqual([{ id: 'c1', label: 'explore', mode: 'continuable' }])
    expect(browser.hidden).toBe(false)

    // A label-less row omits the label key entirely.
    browser.component.handleInput(KEY.down)
    browser.component.handleInput(KEY.enter)
    expect(harness.opened[1]).toEqual({ id: 'c2', mode: 'one-shot' })
    dispose()
  })

  it('notices instead of attaching when the attach plugin is absent', async () => {
    const harness = await mount({ attach: false })
    harness.tree = [child('c1', { label: 'explore' })]
    const dispose = registerAgentsCommand(harness.ctx)
    expect(await run(harness.ctx, harness.agent, '/agents')).toEqual({ kind: 'success' })
    const browser = harness.screen.overlays.at(-1)!
    browser.component.handleInput(KEY.enter)
    expect(harness.opened).toEqual([])
    expect(harness.notice).toHaveBeenCalledOnce()
    expect(String(harness.notice.mock.calls[0]![0])).toContain('blue-attach-view')
    expect(browser.hidden).toBe(false)
    dispose()
  })

  it('Escape closes the browser; a session switch strands and closes it; a null snapshot does not', async () => {
    const harness = await mount()
    harness.tree = [child('c1')]
    const dispose = registerAgentsCommand(harness.ctx)
    expect(await run(harness.ctx, harness.agent, '/agents')).toEqual({ kind: 'success' })
    const browser = harness.screen.overlays.at(-1)!
    browser.component.handleInput(KEY.escape)
    expect(browser.hidden).toBe(true)

    // Reopen, then switch the session: the stale browser closes.
    expect(await run(harness.ctx, harness.agent, '/agents')).toEqual({ kind: 'success' })
    const reopened = harness.screen.overlays.at(-1)!
    expect(reopened.hidden).toBe(false)
    harness.switchSession('agent-2')
    expect(reopened.hidden).toBe(true)

    // Reopen once more: a null snapshot (no active session) closes nothing.
    expect(await run(harness.ctx, harness.agent, '/agents')).toEqual({ kind: 'success' })
    harness.pushSnapshot(null)
    expect(harness.screen.overlays.at(-1)!.hidden).toBe(false)
    dispose()
  })

  it('closes the browser when the fiber unloads mid-listing', async () => {
    const harness = await mount()
    let resolveTree!: (value: BlueSubagentTreeEntry[]) => void
    harness.treeDefer = { promise: new Promise(resolve => { resolveTree = resolve }), resolve: resolveTree }
    const dispose = registerAgentsCommand(harness.ctx)
    const pending = run(harness.ctx, harness.agent, '/agents')
    dispose()
    resolveTree([child('c1')])
    expect(await pending).toEqual({ kind: 'success' })
    expect(harness.screen.overlays.at(-1)?.hidden).not.toBe(false)
  })
})
