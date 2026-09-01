/** Native child-session attach view behavior.
 * @module @dsh-blue/blue-interaction/tests/attach-view
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ATTACH_CHROME,
  attachMetricsText,
  ChildAttachView,
  formatAttachElapsed,
  mountChildAttach,
  type BlueChildAttachTarget,
} from '../src/attach-view.ts'
import { EditorHostService, setEditorSlotSwap } from '../src/editor-instance.ts'
import { FakeBlueComponents, FakeScreen, FakeTheme } from './fakes.ts'
import { expectLinesFit } from '../../core/tests/width-scan.ts'

function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#!?@]/g, ''))
}

function conversation(text: string, seq = 2): unknown {
  return {
    entries: [
      { id: 'u1', seq: seq - 1, turn: 1, kind: 'user', text: 'hello child', images: [] },
      { id: 'a1', seq, turn: 1, kind: 'assistant', step: 0, text, streaming: false },
    ],
    streaming: false,
  }
}

function longConversation(turns: number): unknown {
  const entries: unknown[] = []
  for (let index = 0; index < turns; index += 1) {
    entries.push(
      { id: `u${String(index)}`, seq: index * 2 + 1, turn: index + 1, kind: 'user', text: `line ${String(index)}`, images: [] },
      { id: `a${String(index)}`, seq: index * 2 + 2, turn: index + 1, kind: 'assistant', step: 0, text: `reply ${String(index)}`, streaming: false },
    )
  }
  return { entries, streaming: false }
}

function toolConversation(): unknown {
  return {
    entries: [{
      id: 'tool-1', seq: 1, turn: 1, kind: 'tool', step: 0, callId: 'call-1',
      name: 'bash', arguments: '{"command":"pwd"}', startedAt: 1, channel: 'transcript',
    }],
    streaming: false,
  }
}

interface AttachHarness {
  readonly ctx: Context
  readonly parent: Agent
  readonly child: Session
  readonly screen: FakeScreen
  readonly view: ChildAttachView
  readonly followups: string[]
  readonly interrupts: string[]
  readonly observations: { started: number, disposed: number }
  readonly push: (session: Session, key: string, value: unknown, seq: number) => void
  readonly setSelected: (agent: Agent | null) => void
  listReject: unknown
  followupReject: unknown
  followupWait: Promise<void> | undefined
  interruptReject: unknown
}

async function mount(options: {
  readonly target?: BlueChildAttachTarget
  readonly live?: boolean
  readonly listed?: boolean
  readonly query?: boolean
  readonly snapshot?: { readonly asOfSeq?: number, readonly values?: Record<string, unknown> }
  readonly deferredList?: Promise<void>
  readonly deferredQuery?: Promise<void>
  readonly emptyObservation?: boolean
} = {}): Promise<AttachHarness> {
  const ctx = new Context()
  const screen = new FakeScreen()
  const components = new FakeBlueComponents()
  const parentSession = { id: SessionId('parent'), header: { cwd: '/tmp' } } as unknown as Session
  const child = { id: SessionId('child'), header: { cwd: '/tmp', origin: 'subagent', parentSession: parentSession.id } } as unknown as Session
  const parent = { id: parentSession.id, session: parentSession, status: 'idle' } as unknown as Agent
  let selected: Agent | null = parent
  const followups: string[] = []
  const interrupts: string[] = []
  const observations = { started: 0, disposed: 0 }
  const projectionListeners = new Set<(session: Session, key: string, value: unknown, seq: number) => void>()
  const harness = {
    ctx,
    parent,
    child,
    screen,
    view: undefined as unknown as ChildAttachView,
    followups,
    interrupts,
    observations,
    push(session: Session, key: string, value: unknown, seq: number) {
      for (const listener of projectionListeners) listener(session, key, value, seq)
    },
    setSelected(agent: Agent | null) { selected = agent },
    listReject: undefined as unknown,
    followupReject: undefined as unknown,
    followupWait: undefined,
    interruptReject: undefined as unknown,
  } satisfies AttachHarness
  ctx.provide('blueCurrentAgent', {
    current: () => selected,
    revision: () => 0,
    subscribe: () => () => {},
  } as never)
  ctx.provide('sessions', { list: () => options.live === false ? [parentSession] : [parentSession, child] } as never)
  ctx.provide('sessionProjections', {
    snapshot: () => ({
      asOfSeq: options.snapshot?.asOfSeq ?? 2,
      values: options.snapshot?.values ?? { blueConversation: conversation('child reply') },
    }),
    onChanged(listener: (session: Session, key: string, value: unknown, seq: number) => void) {
      projectionListeners.add(listener)
      return () => { projectionListeners.delete(listener) }
    },
  } as never)
  ctx.provide('subagents', {
    listDescendants: async () => {
      await options.deferredList
      if (harness.listReject !== undefined) throw harness.listReject
      return options.listed === false ? [] : [{
        kind: 'child', id: child.id, parentId: parent.id, depth: 1,
        activity: 'inactive', hasChildren: false, mode: options.target?.mode ?? 'continuable', label: 'explore',
      }]
    },
    followup: async (_parent: Agent, _child: SessionId, blocks: readonly { readonly text?: string }[]) => {
      followups.push(String(blocks[0]?.text))
      await harness.followupWait
      if (harness.followupReject !== undefined) throw harness.followupReject
      return 'message-1'
    },
    interrupt: (_id: SessionId) => {
      interrupts.push('child')
      if (harness.interruptReject !== undefined) throw harness.interruptReject
    },
  } as never)
  if (options.query !== false) {
    ctx.provide('sessionQuery', {
      observeSession: async () => {
        observations.started += 1
        await options.deferredQuery
        return {
          ...(options.emptyObservation ? {} : {
            projections: {
              asOfSeq: options.snapshot?.asOfSeq ?? 2,
              values: options.snapshot?.values ?? { blueConversation: conversation('cold reply') },
            },
          }),
          [Symbol.dispose]() { observations.disposed += 1 },
        }
      },
    } as never)
  }
  const target = options.target ?? { id: 'child', label: 'explore', mode: 'continuable' }
  harness.view = new ChildAttachView({
    ctx,
    parent,
    target,
    screen: screen as never,
    components: components as never,
    colors: new FakeTheme().colors,
    t: key => key,
    tools: { get: () => undefined },
    onClose: () => harness.view.dispose(),
  })
  return harness
}

describe('attach metrics', () => {
  it('formats elapsed time and optional metrics', () => {
    expect(formatAttachElapsed(-5)).toBe('0s')
    expect(formatAttachElapsed(45_000)).toBe('45s')
    expect(formatAttachElapsed(130_000)).toBe('2m 10s')
    expect(attachMetricsText({}, 1_000)).toBe('')
    expect(attachMetricsText({ tokens: 2_048 }, 1_000)).toBe('2k tok')
    expect(attachMetricsText({ settledMs: 65_000 }, 1_000)).toBe('1m 5s')
    expect(attachMetricsText({ tokens: 100, settledMs: 5_000, activeSince: 500 }, 3_500)).toBe('100 tok · 3s')
  })
})

describe('ChildAttachView', () => {
  afterEach(() => { vi.useRealTimers() })

  it('seeds a live child and renders stable framed rows at every supported width', async () => {
    const rig = await mount({ snapshot: { values: {
      blueConversation: conversation('initial reply'),
      blueConversationFacts: { active: false, epochTokens: 512 },
      subagentTiming: { settledMs: 2_000 },
    } } })
    rig.view.open()
    rig.view.open()
    await vi.waitFor(() => expect(plain(rig.view.render(80)).join('\n')).toContain('initial reply'))
    expect(plain(rig.view.render(80))[0]).toContain('Subagent · explore')
    expect(plain(rig.view.render(80))[0]).toContain('○ idle · 512 tok · 2s')
    expect(plain(rig.view.render(80)).join('\n')).toContain(ATTACH_CHROME.placeholder)
    for (const width of [100, 40, 20, 10, 5]) expectLinesFit('attach', rig.view.render(width), width)
    expect(rig.view.render(4)).toEqual([])
    rig.screen.rows = Number.POSITIVE_INFINITY
    expect(rig.view.render(40)).toHaveLength(6)
    rig.screen.rows = 0
    expect(rig.view.render(40)).toHaveLength(6)
    rig.view.invalidate()
    rig.view.dispose()
    rig.view.dispose()
  })

  it('uses a cold session observation and disposes its exact cut', async () => {
    const rig = await mount({ live: false })
    rig.view.open()
    await vi.waitFor(() => expect(plain(rig.view.render(60)).join('\n')).toContain('cold reply'))
    expect(rig.observations.disposed).toBe(1)
    rig.view.dispose()

    const empty = await mount({ live: false, emptyObservation: true })
    empty.view.open()
    await vi.waitFor(() => expect(empty.observations.disposed).toBe(1))
    expect(plain(empty.view.render(60)).join('\n')).not.toContain('cold reply')
    empty.view.dispose()

    let release!: () => void
    const switched = await mount({ live: false, deferredQuery: new Promise(resolve => { release = resolve }) })
    switched.view.open()
    await vi.waitFor(() => expect(switched.observations.started).toBe(1))
    switched.setSelected(null)
    release()
    await vi.waitFor(() => expect(switched.observations.disposed).toBe(1))
    expect(plain(switched.view.render(60)).join('\n')).not.toContain('cold reply')
    switched.view.dispose()
  })

  it('surfaces native seed failures and contains stale-session results', async () => {
    const missing = await mount({ live: false, query: false })
    missing.view.open()
    await vi.waitFor(() => expect(plain(missing.view.render(160)).join('\n')).toContain('no session query service'))
    missing.view.dispose()

    const foreign = await mount({ listed: false })
    foreign.view.open()
    await vi.waitFor(() => expect(plain(foreign.view.render(60)).join('\n')).toContain('not in the current session'))
    foreign.view.dispose()

    let release!: () => void
    const late = await mount({ deferredList: new Promise(resolve => { release = resolve }) })
    late.view.open()
    late.setSelected(null)
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(plain(late.view.render(60)).join('\n')).not.toContain('child reply')
    late.view.dispose()

    const rejected = await mount()
    rejected.listReject = 'catalog offline'
    rejected.view.open()
    await vi.waitFor(() => expect(plain(rejected.view.render(60)).join('\n')).toContain('catalog offline'))
    rejected.view.dispose()

    let rejectLate!: () => void
    const disposedError = await mount({ deferredList: new Promise((_, reject) => { rejectLate = () => reject(new Error('late failure')) }) })
    disposedError.view.open()
    disposedError.view.dispose()
    rejectLate()
    await Promise.resolve()
  })

  it('submits continuable follow-ups, clears input, and contains rejection', async () => {
    const rig = await mount()
    rig.view.open()
    rig.view.handleInput('h')
    rig.view.handleInput('i')
    rig.view.handleInput('\x7f')
    rig.view.handleInput('!')
    rig.view.handleInput('\r')
    await vi.waitFor(() => expect(rig.followups).toEqual(['h!']))
    rig.view.handleInput(' ')
    rig.view.handleInput('\r')
    expect(rig.followups).toHaveLength(1)
    rig.view.handleInput('q')
    rig.view.handleInput('\x1b[Z')
    rig.view.handleInput('\x01')
    expect(plain(rig.view.render(60)).join('\n')).toContain(' q▌')
    rig.view.handleInput('\x7f')
    rig.view.handleInput('\x7f')
    rig.followupReject = new Error('child is busy')
    rig.view.handleInput('x')
    rig.view.handleInput('\r')
    await vi.waitFor(() => expect(plain(rig.view.render(60)).join('\n')).toContain('child is busy'))
    rig.view.dispose()

    let release!: () => void
    const late = await mount()
    late.followupWait = new Promise(resolve => { release = resolve })
    late.followupReject = new Error('late followup')
    late.view.open()
    late.view.handleInput('x')
    late.view.handleInput('\r')
    late.view.dispose()
    release()
    await Promise.resolve()

    let releaseSuccess!: () => void
    const lateSuccess = await mount()
    lateSuccess.followupWait = new Promise(resolve => { releaseSuccess = resolve })
    lateSuccess.view.open()
    lateSuccess.view.handleInput('y')
    lateSuccess.view.handleInput('\r')
    lateSuccess.view.dispose()
    releaseSuccess()
    await Promise.resolve()
  })

  it('clears buffered input before interrupting and closes with q or Escape', async () => {
    const rig = await mount()
    rig.view.open()
    rig.view.handleInput('a')
    rig.view.handleInput('\x03')
    expect(rig.interrupts).toEqual([])
    rig.view.handleInput('\x03')
    expect(rig.interrupts).toEqual(['child'])
    rig.interruptReject = 'cannot interrupt'
    rig.view.handleInput('\x03')
    expect(plain(rig.view.render(60)).join('\n')).toContain('cannot interrupt')
    rig.view.handleInput('q')
    rig.view.handleInput('ignored')

    const escaped = await mount()
    escaped.view.open()
    escaped.view.handleInput('\x1b')
    escaped.view.handleInput('ignored')
  })

  it('degrades one-shot children to read-only while retaining scroll and interrupt', async () => {
    const rig = await mount({ target: { id: 'child', mode: 'one-shot' }, snapshot: { values: { blueConversation: longConversation(12) } } })
    rig.view.open()
    await vi.waitFor(() => expect(plain(rig.view.render(40)).join('\n')).toContain('reply 11'))
    rig.view.handleInput('x')
    rig.view.handleInput('\r')
    rig.view.handleInput('\x7f')
    expect(rig.followups).toEqual([])
    rig.view.handleInput('\x1b[5~')
    expect(plain(rig.view.render(40)).join('\n')).toContain(ATTACH_CHROME.oneShotReadonly)
    rig.view.handleInput('\x03')
    expect(rig.interrupts).toEqual(['child'])
    rig.view.dispose()
  })

  it('follows fresh projection values without letting a stale key rewind state', async () => {
    let release!: () => void
    const rig = await mount({
      deferredList: new Promise(resolve => { release = resolve }),
      snapshot: { asOfSeq: 2, values: {
        blueConversation: conversation('stale cut'),
        blueConversationFacts: { epochTokens: 512 },
      } },
    })
    rig.view.open()
    rig.push(rig.child, 'blueConversation', conversation('fresh push', 5), 5)
    rig.push({ id: SessionId('other') } as Session, 'blueConversation', conversation('foreign'), 6)
    rig.push(rig.child, 'unrelated', {}, 6)
    release()
    await vi.waitFor(() => expect(plain(rig.view.render(80)).join('\n')).toContain('fresh push'))
    await vi.waitFor(() => expect(plain(rig.view.render(80)).join('\n')).toContain('512 tok'))
    const rows = plain(rig.view.render(80)).join('\n')
    expect(rows).not.toContain('stale cut')
    expect(rows).toContain('512 tok')
    rig.push(rig.child, 'blueConversation', conversation('stale push', 3), 3)
    rig.push(rig.child, 'blueConversation', { entries: 'bad' }, 7)
    rig.push(rig.child, 'blueConversationFacts', { active: 'yes', epochTokens: 'many' }, 8)
    rig.push(rig.child, 'subagentTiming', null, 9)
    expect(plain(rig.view.render(80)).join('\n')).not.toContain('stale push')
    rig.push(rig.child, 'blueConversationFacts', { active: true, epochTokens: 4_096 }, 10)
    expect(plain(rig.view.render(80))[0]).toContain('● running · 4k tok')
    rig.view.dispose()
    rig.push(rig.child, 'blueConversation', conversation('late'), 20)
  })

  it('ticks only while running and can re-arm after settlement', async () => {
    vi.useFakeTimers()
    const rig = await mount({ snapshot: { values: {
      blueConversation: conversation('child reply'),
      subagentTiming: { active: { since: 1_000 } },
    } } })
    rig.view.open()
    await vi.waitFor(() => expect(plain(rig.view.render(80))[0]).toContain('● running'))
    const before = rig.screen.renderRequests
    vi.advanceTimersByTime(1_000)
    expect(rig.screen.renderRequests).toBeGreaterThan(before)
    rig.push(rig.child, 'subagentTiming', { settledMs: 9_000 }, 5)
    const settled = rig.screen.renderRequests
    vi.advanceTimersByTime(2_000)
    expect(rig.screen.renderRequests).toBe(settled)
    rig.push(rig.child, 'subagentTiming', { active: { since: 2_000 } }, 6)
    vi.advanceTimersByTime(1_000)
    expect(rig.screen.renderRequests).toBeGreaterThan(settled)
    rig.view.dispose()
  })

  it('scrolls by line and page, clamps both bounds, and preserves a parked viewport', async () => {
    const rig = await mount({ snapshot: { asOfSeq: 24, values: { blueConversation: longConversation(12) } } })
    rig.view.open()
    await vi.waitFor(() => expect(plain(rig.view.render(40)).join('\n')).toContain('reply 11'))
    const tail = plain(rig.view.render(40))
    rig.view.handleInput('\x1b[A')
    expect(plain(rig.view.render(40))).not.toEqual(tail)
    for (let index = 0; index < 20; index += 1) rig.view.handleInput('\x1b[5~')
    expect(plain(rig.view.render(40)).join('\n')).toContain('line 0')
    const top = rig.screen.renderRequests
    rig.view.handleInput('\x1b[A')
    expect(rig.screen.renderRequests).toBe(top)
    const parked = plain(rig.view.render(40))
    rig.push(rig.child, 'blueConversation', longConversation(13), 26)
    expect(plain(rig.view.render(40))).toEqual(parked)
    for (let index = 0; index < 200; index += 1) rig.view.handleInput('\x1b[B')
    rig.view.handleInput('\x1b[6~')
    expect(plain(rig.view.render(40)).join('\n')).toContain('reply 12')
    const bottom = rig.screen.renderRequests
    rig.view.handleInput('\x1b[B')
    expect(rig.screen.renderRequests).toBe(bottom)
    rig.view.dispose()
  })
})

describe('mountChildAttach', () => {
  it('returns absent without a display and otherwise restores the editor slot on close', async () => {
    const ctx = new Context()
    const parent = { id: SessionId('parent') } as unknown as Agent
    expect(mountChildAttach(ctx, parent, { id: 'child', mode: 'one-shot' }, () => {})).toBeUndefined()

    const base = await mount({
      target: { id: 'child', mode: 'one-shot' },
      snapshot: { values: { blueConversation: toolConversation() } },
    })
    const theme = new FakeTheme()
    base.ctx.provide('blueScreen', base.screen as never)
    base.ctx.provide('blueTheme', theme as never)
    base.ctx.provide('blueKeymap', {} as never)
    base.ctx.provide('blueComponents', new FakeBlueComponents() as never)
    const childAgent = { id: SessionId('child') } as unknown as Agent
    base.ctx.provide('agents', { get: () => childAgent } as never)
    const toolGet = vi.fn(() => undefined)
    base.ctx.provide('tools', { get: toolGet } as never)
    new EditorHostService(base.ctx)
    setEditorSlotSwap(base.ctx, { mount: component => base.screen.mountDialogPanel(component) })
    const closed = vi.fn()
    const handle = mountChildAttach(base.ctx, base.parent, { id: 'child', mode: 'one-shot' }, closed)
    expect(handle).toBeDefined()
    await vi.waitFor(() => expect(toolGet).toHaveBeenCalledWith('bash', childAgent))
    handle?.close()
    handle?.close()
    expect(closed).toHaveBeenCalledOnce()

    const noResident = await mount({
      target: { id: 'child', mode: 'one-shot' },
      snapshot: { values: { blueConversation: toolConversation() } },
    })
    noResident.ctx.provide('blueScreen', noResident.screen as never)
    noResident.ctx.provide('blueTheme', theme as never)
    noResident.ctx.provide('blueKeymap', {} as never)
    noResident.ctx.provide('blueComponents', new FakeBlueComponents() as never)
    noResident.ctx.provide('agents', { get: () => undefined } as never)
    const noResidentGet = vi.fn(() => undefined)
    noResident.ctx.provide('tools', { get: noResidentGet } as never)
    new EditorHostService(noResident.ctx)
    setEditorSlotSwap(noResident.ctx, { mount: component => noResident.screen.mountDialogPanel(component) })
    const noResidentHandle = mountChildAttach(noResident.ctx, noResident.parent, { id: 'child', mode: 'one-shot' }, () => {})
    await vi.waitFor(() => expect(noResidentGet).toHaveBeenCalledWith('bash', undefined))
    noResidentHandle?.close()
  })
})
