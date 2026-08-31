/**
 * Unit tests for the `/permission` preset picker: row construction from
 * the preset service, the current badge and derived `custom` row, the
 * danger-full-access typed-y gate, dispatch through the real command
 * runtime, and the degraded guards. The panel mounts through the fake
 * D30 editor-slot swap (the FakeScreen overlay registry).
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { openPermissionPanel, type PermissionPresetsService } from '../src/permission-panel.ts'
import { EditorHostService, setSharedEditor } from '../src/editor-instance.ts'
import { fakeBlueContext } from './fakes.ts'
import { KEY } from './fakes.ts'

/** The dsh-base three-preset table, with the display names bare keys get. */
const TABLE = [
  { name: 'read-only', sandbox: 'read-only', approval: 'ask' },
  { name: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' },
  { name: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' },
]

/**
 * The fake preset service: a fixed table, a switchable current value, and
 * the same derived-`custom` option shape the real service hardcodes.
 */
function fakePresets(behavior: { current?: string } = {}): PermissionPresetsService {
  const current = behavior.current ?? 'workspace-write'
  return {
    names: TABLE.map(entry => entry.name),
    current: () => current,
    resolve: name => {
      const entry = TABLE.find(row => row.name === name)
      if (entry === undefined) throw new Error(`unknown preset: ${name}`)
      return entry
    },
    optionOf: name => name === 'custom'
      ? { value: 'custom', name: 'Custom', description: 'derived state' }
      : { value: name, name },
  }
}

interface MountOptions {
  presets?: PermissionPresetsService
  /** What the spy /permission command returns for every dispatch. */
  outcome?: { kind: 'success', text: string } | { kind: 'error', text: string }
  /** Register the spy command (default); false leaves /permission absent. */
  registerCommand?: boolean
  /** Make the spy succeed with no result text. */
  textless?: boolean
  /** Make the spy handler throw (Error or bare string). */
  reject?: Error | string
}

async function mount(options: MountOptions = {}): Promise<{
  ctx: Context
  agent: Agent
  notices: string[]
  runs: string[]
  overlays: { component: { render(width: number): string[], handleInput(data: string): void }, hidden: boolean }[]
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('perm-spec'))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  ctx.provide('testSession', { current: agent, modelRef: undefined })
  ctx.provide('permissionPresets', options.presets ?? fakePresets())
  const runs: string[] = []
  if (options.registerCommand !== false) {
    ctx.commands.register({
      name: 'permission',
      description: 'spy standing in for the upstream command',
      input: { hint: '<preset>' },
      handler: invocation => {
        runs.push(invocation.rawInput)
        // Mirror the upstream command: rawInput arrives with the leading
        // space; the result text names the trimmed preset.
        const name = invocation.rawInput.trim()
        if (options.textless === true) return { kind: 'success' as const }
        if (options.reject !== undefined) throw options.reject
        return options.outcome ?? { kind: 'success' as const, text: `preset ${name}` }
      },
    })
  }
  const notices: string[] = []
  setSharedEditor(ctx, {
    editor: { focused: false, render: () => [], invalidate: () => {} } as never,
    submitPrompt: () => {},
    notice: (text: string) => { notices.push(text) },
  })
  return { ctx, agent, notices, runs, overlays: screen.overlays }
}

/** The topmost non-hidden overlay's panel. */
function top(mounted: { overlays: { component: { render(width: number): string[], handleInput(data: string): void }, hidden: boolean }[] }) {
  const overlay = mounted.overlays.at(-1)
  if (overlay === undefined) throw new Error('no panel mounted')
  return overlay
}

describe('openPermissionPanel', () => {
  it('renders the table with derived knob descriptions and the current badge', async () => {
    const mounted = await mount()
    openPermissionPanel(mounted.ctx)
    const lines = top(mounted).component.render(80)
    expect(lines.join('\n')).toContain('Permissions')
    expect(lines.join('\n')).toContain('read-only')
    expect(lines.join('\n')).toContain('sandbox read-only · approval ask')
    expect(lines.join('\n')).toContain('sandbox danger-full-access · approval never')
    const currentRow = lines.find(line => line.includes('workspace-write')) ?? ''
    expect(currentRow).toContain('← current')
  })

  it('dispatches the selected preset through the command runtime', async () => {
    const mounted = await mount()
    openPermissionPanel(mounted.ctx)
    // The cursor seeds on the current preset: Enter switches straight off it.
    top(mounted).component.handleInput(KEY.enter)
    // The runtime hands the handler the raw input after the command name
    // (leading space included); the upstream command trims it itself.
    await vi.waitFor(() => { expect(mounted.runs).toEqual([' workspace-write']) })
    await vi.waitFor(() => { expect(mounted.notices).toContain('preset workspace-write') })
    expect(top(mounted).hidden).toBe(true)
  })

  it('paints an error result notice in error red', async () => {
    const mounted = await mount({ outcome: { kind: 'error', text: 'unknown preset "nope"' } })
    openPermissionPanel(mounted.ctx)
    top(mounted).component.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(mounted.notices).toContain('!unknown preset "nope"!') })
  })

  it('blocks the derived custom row and explains why', async () => {
    const mounted = await mount({ presets: fakePresets({ current: 'custom' }) })
    openPermissionPanel(mounted.ctx)
    const frame = top(mounted).component.render(80).join('\n')
    expect(frame).toContain('Custom')
    // The custom row rides after the table; reach it with wraparound.
    top(mounted).component.handleInput(KEY.up)
    top(mounted).component.handleInput(KEY.enter)
    expect(mounted.runs).toEqual([])
    expect(mounted.notices).toContain('?custom is the derived state — pick a preset?')
    // Dismissal of the notice aside, the panel stays for a real choice.
    expect(top(mounted).hidden).toBe(false)
  })

  it('gates danger-full-access behind a typed-y form that returns to the list on Esc', async () => {
    const mounted = await mount()
    openPermissionPanel(mounted.ctx)
    // Seed is workspace-write (row 1); one Down reaches the danger row.
    top(mounted).component.handleInput(KEY.down)
    top(mounted).component.handleInput(KEY.enter)
    expect(mounted.overlays).toHaveLength(2)
    const gate = top(mounted)
    expect(gate.component.render(80).join('\n')).toContain('Full access')
    // Esc pops the gate; the picker beneath is still live.
    gate.component.handleInput(KEY.escape)
    expect(gate.hidden).toBe(true)
    expect(mounted.overlays[0]!.hidden).toBe(false)
    expect(mounted.runs).toEqual([])
  })

  it('keeps the gate open on a wrong entry and dispatches on y', async () => {
    const mounted = await mount()
    openPermissionPanel(mounted.ctx)
    top(mounted).component.handleInput(KEY.down)
    top(mounted).component.handleInput(KEY.enter)
    const gate = top(mounted)
    gate.component.handleInput('n')
    gate.component.handleInput(KEY.enter)
    // The validation error holds the form; nothing dispatched yet.
    expect(gate.hidden).toBe(false)
    expect(mounted.runs).toEqual([])
    gate.component.handleInput(KEY.enter)
    gate.component.handleInput('\x7f')
    gate.component.handleInput('y')
    gate.component.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(mounted.runs).toEqual([' danger-full-access']) })
    await vi.waitFor(() => { expect(mounted.notices).toContain('preset danger-full-access') })
    expect(mounted.overlays.every(overlay => overlay.hidden)).toBe(true)
  })

  it('cancels back to the editor without dispatching', async () => {
    const mounted = await mount()
    openPermissionPanel(mounted.ctx)
    top(mounted).component.handleInput(KEY.escape)
    expect(top(mounted).hidden).toBe(true)
    expect(mounted.runs).toEqual([])
    expect(mounted.notices).toEqual([])
  })

  it('swallows a dispatch against an unregistered command', async () => {
    const mounted = await mount({ registerCommand: false })
    openPermissionPanel(mounted.ctx)
    top(mounted).component.handleInput(KEY.enter)
    // The panel closed on select; execute() resolved undefined and the
    // dispatch settled silently — no notice, nothing thrown.
    await vi.waitFor(() => { expect(top(mounted).hidden).toBe(true) })
    expect(mounted.notices).toEqual([])
  })

  it('stays silent for a success result without text', async () => {
    const mounted = await mount({ textless: true })
    openPermissionPanel(mounted.ctx)
    top(mounted).component.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(mounted.runs).toEqual([' workspace-write']) })
    await vi.waitFor(() => { expect(mounted.notices).toEqual([]) })
  })

  it('warns through the logger for an Error dispatch rejection', async () => {
    const mounted = await mount({ reject: new Error('route exploded') })
    const warn = vi.spyOn(mounted.ctx.logger, 'warn')
    openPermissionPanel(mounted.ctx)
    top(mounted).component.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledOnce() })
    expect(String(warn.mock.calls[0]?.[0])).toContain('permission dispatch failed: route exploded')
    expect(mounted.notices).toEqual([])
  })

  it('renders a non-Error dispatch rejection through String()', async () => {
    const mounted = await mount({ reject: 'bare boom' })
    const warn = vi.spyOn(mounted.ctx.logger, 'warn')
    openPermissionPanel(mounted.ctx)
    top(mounted).component.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(String(warn.mock.calls[0]?.[0])).toContain('permission dispatch failed: bare boom')
    })
  })

  it('notices and does nothing when the Blue screen is not mounted', async () => {
    const bare = new Context()
    new EditorHostService(bare)
    await bare.plugin(SessionStore)
    await bare.plugin(CommandRuntime)
    const session = bare.sessions.create(SessionId('perm-bare'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    bare.provide('permissionPresets', fakePresets())
    const notices: string[] = []
    setSharedEditor(bare, {
      editor: { focused: false, render: () => [], invalidate: () => {} } as never,
      submitPrompt: () => {},
      notice: (text: string) => { notices.push(text) },
    })
    openPermissionPanel(bare)
    expect(notices).toEqual(['permission picker is unavailable: the Blue screen is not mounted'])
  })

  it('is a silent no-op without the preset service', async () => {
    // The input-layer interception probes the service first; the panel
    // function's own guard keeps it inert if reached anyway.
    const { ctx, screen } = fakeBlueContext()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('perm-noservice'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    const notices: string[] = []
    setSharedEditor(ctx, {
      editor: { focused: false, render: () => [], invalidate: () => {} } as never,
      submitPrompt: () => {},
      notice: (text: string) => { notices.push(text) },
    })
    openPermissionPanel(ctx)
    expect(screen.overlays).toHaveLength(0)
    expect(notices).toEqual([])
  })

  it('is a silent no-op when the current preset cannot be projected', async () => {
    const mounted = await mount()
    ;(mounted.ctx.blueSessionActions as unknown as { permissionPreset: () => undefined }).permissionPreset
      = () => undefined
    openPermissionPanel(mounted.ctx)
    expect(mounted.overlays).toHaveLength(0)
  })
})
