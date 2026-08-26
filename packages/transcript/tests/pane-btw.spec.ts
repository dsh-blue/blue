/**
 * `blue-pane-btw` plugin: the side-question pane and its `/btw` command.
 * Covers the command's error branches (no session, creation failure), the
 * seeded side-agent creation, the streaming/finalize reply rendering with
 * the thinking row, dismissal and single-slot replacement, the editor
 * splice (`'blue/editor-connected-above'` emissions), the fitBodyLines
 * mechanics (row budget from the terminal height, tail-follow, manual
 * scrolling through `'blue/btw-command'`, the min-height ratchet, per-
 * question scroll reset), and the unloaded-mid-creation guard.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  BlueSessionActions,
  BlueSideSession,
  BlueSideSessionStatus,
} from '../../app/src/types.ts'
import * as btw from '../src/pane-btw.ts'
import {
  assistantEvent,
  reasoningDelta,
  resetSeq,
  textDelta,
  userEvent,
} from './helpers.ts'
import { bootPanePlugin, type PaneFakeCommands, type PanePluginHarness } from './pane-fakes.ts'
import { fakeAgent, type FakeAgent } from './status-fakes.ts'

/** One opaque fake side session plus its action handle and captures. */
interface FakeSide {
  projectionSession: { events: SessionEvent[] }
  handle: BlueSideSession
  followups: string[]
  listeners: Set<(status: BlueSideSessionStatus) => void>
  disposed: number
}

/** Build one fake side-session action handle. */
function makeSide(): FakeSide {
  const side = {
    projectionSession: { events: [] },
    followups: [],
    listeners: new Set(),
    disposed: 0,
  } as FakeSide
  side.handle = {
    projectionSession: side.projectionSession,
    followup: (text) => { side.followups.push(text) },
    subscribeStatus: (listener) => {
      side.listeners.add(listener)
      return () => { side.listeners.delete(listener) }
    },
    dispose: () => {
      side.disposed += 1
      side.listeners.clear()
      return Promise.resolve()
    },
  }
  return side
}

/** Fake app action service: records creations; can fail or hold the next one. */
class FakeSessionActions implements BlueSessionActions {
  readonly creates: true[] = []
  readonly sides: FakeSide[] = []
  failure: unknown
  available = true
  hold = false
  private pendingResolve: (() => void) | undefined

  get pending(): boolean {
    return this.pendingResolve !== undefined
  }

  createSideSession(): Promise<BlueSideSession | undefined> {
    if (!this.available) return Promise.resolve(undefined)
    this.creates.push(true)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const side = makeSide()
    this.sides.push(side)
    if (this.hold) {
      return new Promise((resolve) => {
        this.pendingResolve = () => resolve(side.handle)
      })
    }
    return Promise.resolve(side.handle)
  }

  /** Publish one admitted status transition to a side handle. */
  emitStatus(side: FakeSide, status: BlueSideSessionStatus): void {
    for (const listener of side.listeners) listener(status)
  }

  /** Fulfill the held creation. */
  resolvePending(): void {
    const resolve = this.pendingResolve
    this.pendingResolve = undefined
    resolve?.()
  }
}

/**
 * Boot the plugin with the fake app-owned action service.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 * @param actions - the fake side-session actions.
 */
async function boot(current: FakeAgent | null, actions: FakeSessionActions): Promise<PanePluginHarness> {
  actions.available = current !== null
  return bootPanePlugin(btw, current, { blueSessionActions: actions })
}

/** Invoke `/btw` with the given raw input. */
function run(commands: PaneFakeCommands, rawInput: string): Promise<unknown> {
  return Promise.resolve(commands.run('btw', rawInput))
}

/**
 * Fake visible width mirroring the pi-tui convention the real `topRule`
 * uses: SGR stripped, `↑`/`↓` one column each, everything else one (the
 * transcript package must not import pi-tui — L0 discipline; pi-tui's
 * wcwidth treats the arrows as single-width).
 */
function visibleWidth(text: string): number {
  return [...text.replace(/\x1b\[[0-9;]*m/g, '')].length
}

/**
 * The pane's top border at the default width. The identity colors leave the
 * manual bold SGR of the title; the composite width is computed with the
 * fake width function, mirroring `topRule` itself.
 */
function rule(truncated: boolean, width = 78): string {
  const hint = truncated ? 'Esc close · ↑↓ scroll ' : 'Esc close '
  const composite = `\x1b[1m BTW \x1b[22m─ ${hint}`
  return `╭${composite}${'─'.repeat(Math.max(0, width - 2 - visibleWidth(composite)))}╮`
}

/** One bordered body row at the default width (plain content). */
function bodyRow(text: string, width = 78): string {
  return `│ ${text}${' '.repeat(Math.max(0, width - 4 - text.length))} │`
}

/** The default frame: rule + fitted body rows + the trailing spacer. */
function frame(rows: readonly string[], truncated = false): string[] {
  return [rule(truncated), ...rows.map(text => bodyRow(text)), '']
}

describe('blue-pane-btw', () => {
  it('registers the /btw command and mounts a closed pane', async () => {
    const agents = new FakeSessionActions()
    const { screen, commands, dispose } = await boot(fakeAgent([]), agents)
    expect(btw.name).toBe('blue-pane-btw')
    const definition = commands.definitions.get('btw')
    expect(definition?.description).toBe('Ask a side question in a forked session')
    expect(definition?.input).toEqual({ hint: '<question>' })
    expect(screen.bottomChildren).toHaveLength(1)
    expect(screen.paneLines()).toEqual([])
    await dispose()
    expect(commands.definitions.size).toBe(0)
    expect(screen.bottomChildren).toHaveLength(0)
  })

  it('errors without an active session', async () => {
    const agents = new FakeSessionActions()
    const { commands, dispose } = await boot(null, agents)
    expect(await run(commands, 'hello')).toEqual({
      kind: 'error',
      text: 'no active session for a side question',
    })
    expect(agents.creates).toHaveLength(0)
    await dispose()
  })

  it('reports creation failures, Error or not', async () => {
    const agents = new FakeSessionActions()
    const { commands, screen, dispose } = await boot(fakeAgent([]), agents)
    agents.failure = new Error('no adapter')
    expect(await run(commands, 'hello')).toEqual({
      kind: 'error',
      text: 'could not start the side session: no adapter',
    })
    agents.failure = 'plain rejection'
    expect(await run(commands, 'hello')).toEqual({
      kind: 'error',
      text: 'could not start the side session: plain rejection',
    })
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })

  it('asks through the app action, streams the projection, finalizes, and settles', async () => {
    resetSeq()
    const current = fakeAgent([userEvent('parent work')], { cwd: '/repo' })
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(current, agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)

    expect(await run(commands, 'what is x?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(splice).toHaveBeenLastCalledWith(true, true)
    expect(agents.creates).toHaveLength(1)
    const side = agents.sides[0]!
    expect(side.followups).toEqual(['what is x?'])
    expect(screen.paneLines()).toEqual(frame(['› what is x?', 'thinking…']))

    // Text deltas accumulate; other sessions, reasoning deltas, and
    // non-assistant events are ignored.
    const session = side.projectionSession
    ctx.emit('session/event', session, textDelta(1, 1, 'x is '))
    ctx.emit('session/event', session, textDelta(1, 1, 'a letter'))
    expect(screen.paneLines()).toEqual(frame(['› what is x?', 'x is a letter', 'thinking…']))
    const baseline = screen.renderRequests.length
    ctx.emit('session/event', fakeAgent([]).session as never, textDelta(1, 1, 'stray'))
    ctx.emit('session/event', session, reasoningDelta(1, 1, 'hmm'))
    ctx.emit('session/event', session, userEvent('echo'))
    expect(screen.renderRequests.length).toBe(baseline)

    // The finalize rewrites the accumulation authoritatively, dropping
    // non-text blocks.
    ctx.emit('session/event', session, assistantEvent(1, 1, [
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'x is the 24th letter' },
    ]))
    expect(screen.paneLines()).toEqual(frame(['› what is x?', 'x is the 24th letter', 'thinking…']))

    // The app-owned handle admits only this side session's status changes.
    agents.emitStatus(side, 'running')
    expect(screen.paneLines()).toHaveLength(5)
    agents.emitStatus(side, 'idle')
    // The thinking row leaves but the high-water height stays: the third
    // body row pads blank (the min-height ratchet).
    expect(screen.paneLines()).toEqual(frame(['› what is x?', 'x is the 24th letter', '']))

    // Unloading disposes the live side agent and releases the editor splice.
    await dispose()
    expect(side.disposed).toBe(1)
    expect(splice).toHaveBeenLastCalledWith(false)
  })

  it('drops the editor splice while a dialog occupies the slot and re-asserts on return', async () => {
    resetSeq()
    const current = fakeAgent([], { cwd: '/repo' })
    const agents = new FakeSessionActions()
    const { ctx, commands, dispose } = await boot(current, agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)

    expect(await run(commands, 'q?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(splice).toHaveBeenLastCalledWith(true, true)

    // A dialog taking the editor slot releases the splice claim: the flag
    // would otherwise point at an off-tree editor.
    ctx.emit('blue/editor-slot-swapped', true)
    expect(splice).toHaveBeenLastCalledWith(false)
    // The editor returning re-asserts the claim with the live busy flag.
    ctx.emit('blue/editor-slot-swapped', false)
    expect(splice).toHaveBeenLastCalledWith(true, true)

    // Once dismissed, a slot round-trip re-asserts nothing.
    await run(commands, '')
    const calls = splice.mock.calls.length
    ctx.emit('blue/editor-slot-swapped', true)
    ctx.emit('blue/editor-slot-swapped', false)
    expect(splice.mock.calls.length).toBe(calls)
    expect(splice).toHaveBeenLastCalledWith(false)
    await dispose()
  })

  it('dismisses with bare /btw and refuses a second dismiss', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)
    await run(commands, 'first?')
    const side = agents.sides[0]!
    expect(screen.paneLines()).toEqual(frame(['› first?', 'thinking…']))

    expect(await run(commands, '')).toEqual({ kind: 'success', text: 'dismissed the side question' })
    expect(side.disposed).toBe(1)
    expect(splice).toHaveBeenLastCalledWith(false)
    expect(screen.paneLines()).toEqual([])

    // The dismissed agent's subscriptions are unbound.
    const baseline = screen.renderRequests.length
    ctx.emit('session/event', side.projectionSession as never, textDelta(1, 1, 'late'))
    agents.emitStatus(side, 'idle')
    expect(screen.renderRequests.length).toBe(baseline)

    expect(await run(commands, '   ')).toEqual({ kind: 'error', text: 'no side question is open' })
    await dispose()
  })

  it('replaces the open side question on a new /btw', async () => {
    resetSeq()
    const current = fakeAgent([userEvent('parent work')])
    const agents = new FakeSessionActions()
    const { commands, screen, dispose } = await boot(current, agents)
    await run(commands, 'first?')
    expect(await run(commands, 'second?')).toEqual({ kind: 'success', text: 'asked the side question' })

    expect(agents.creates).toHaveLength(2)
    expect(agents.sides[0]!.disposed).toBe(1)
    expect(agents.sides[1]!.followups).toEqual(['second?'])
    expect(screen.paneLines()).toEqual(frame(['› second?', 'thinking…']))
    await dispose()
  })

  it('settles a replacement side question without a projection service', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const current = fakeAgent([])
    const harness = await bootPanePlugin(btw, current, { blueSessionActions: agents, sessionProjections: undefined })
    expect(await run(harness.commands, 'first?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(await run(harness.commands, 'second?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(harness.screen.paneLines()).toContainEqual(expect.stringContaining('thinking…'))
    const side = agents.sides[1]!
    agents.emitStatus(side, 'running')
    agents.emitStatus(side, 'idle')
    await harness.dispose()
  })

  it('settles a side question on an explicit idle status event', async () => {
    const agents = new FakeSessionActions()
    const harness = await boot(fakeAgent([]), agents)
    const splice: unknown[] = []
    harness.ctx.on('blue/editor-connected-above', (...args: unknown[]) => { splice.push(args) })
    expect(await run(harness.commands, 'status settle?')).toEqual({ kind: 'success', text: 'asked the side question' })
    const side = agents.sides[0]!
    agents.emitStatus(side, 'idle')
    expect(splice.at(-1)).toEqual([true, false])
    agents.emitStatus(side, 'running')
    await harness.dispose()
  })

  it('ignores an invalid side-session projection shape', async () => {
    const agents = new FakeSessionActions()
    const harness = await bootPanePlugin(btw, fakeAgent([]), {
      blueSessionActions: agents,
      sessionProjections: {
        snapshot: () => ({ values: { blueConversation: {} } }),
        onChanged: () => () => {},
      },
    })
    expect(await run(harness.commands, 'invalid projection?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(await run(harness.commands, 'invalid projection again?')).toEqual({ kind: 'success', text: 'asked the side question' })
    await harness.dispose()
  })

  it('disposes the fresh handle when the fiber unloaded mid-creation', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    agents.hold = true
    const { commands, dispose } = await boot(fakeAgent([]), agents)
    const pending = run(commands, 'late?')
    await vi.waitFor(() => {
      expect(agents.pending).toBe(true)
    })
    await dispose()
    agents.resolvePending()
    expect(await pending).toEqual({ kind: 'error', text: 'the side-question plugin was unloaded' })
    expect(agents.sides[0]!.disposed).toBe(1)
  })

  it('fits the body to the terminal-height budget with a trailing spacer', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'q?')
    const side = agents.sides[0]!
    const session = side.projectionSession

    const ten = Array.from({ length: 10 }, (_, index) => `line${index + 1}`).join('\n')
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: ten }]))
    // Body = question + 10 lines + thinking = 12 rows. rows = 24 → budget
    // = max(3, 8) - 1 = 7: rule + 7 body rows + spacer, tail-followed.
    expect(screen.paneLines()).toHaveLength(1 + 7 + 1)
    expect(screen.paneLines()[1]).toBe(bodyRow('line5'))

    // A resize re-fits live: rows = 15 → budget = max(3, 5) - 1 = 4.
    screen.rows = 15
    expect(screen.paneLines()).toHaveLength(1 + 4 + 1)
    expect(screen.paneLines()[1]).toBe(bodyRow('line8'))

    // rows = 4 → budget = max(3, 1) - 1 = 2, never below the panel minimum.
    screen.rows = 4
    expect(screen.paneLines()).toHaveLength(1 + 2 + 1)
    expect(screen.paneLines()[1]).toBe(bodyRow('line10'))
    await dispose()
  })

  it('caps an overflowing body at the budget, tail-following, and scrolls on command', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'q?')
    const side = agents.sides[0]!
    const session = side.projectionSession

    const long = Array.from({ length: 25 }, (_, index) => `line${index + 1}`).join('\n')
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: long }]))
    // Question + 25 reply rows + thinking = 27 rows; the last 7 show
    // (tail-follow), and the hint advertises the scroll keys.
    const lines = screen.paneLines()
    expect(lines).toHaveLength(1 + 7 + 1)
    expect(lines[0]).toBe(rule(true))
    expect(lines[1]).toBe(bodyRow('line20'))
    expect(lines.at(-2)).toBe(bodyRow('thinking…'))
    expect(lines.at(-1)).toBe('')

    // Scroll up one row: the viewport steps back and stops following.
    ctx.emit('blue/btw-command', 'scroll-up')
    expect(screen.paneLines()[1]).toBe(bodyRow('line19'))
    ctx.emit('blue/btw-command', 'scroll-up')
    expect(screen.paneLines()[1]).toBe(bodyRow('line18'))

    // Scrolling back to the bottom resumes tail-following.
    ctx.emit('blue/btw-command', 'scroll-down')
    ctx.emit('blue/btw-command', 'scroll-down')
    expect(screen.paneLines()[1]).toBe(bodyRow('line20'))

    // New content while tail-following pins to the new bottom.
    ctx.emit('session/event', session, textDelta(1, 1, 'tail'))
    expect(screen.paneLines()[1]).toBe(bodyRow('line20'))
    expect(screen.paneLines().at(-2)).toBe(bodyRow('thinking…'))
    await dispose()
  })

  it('clamps scrolling at the top and ignores scroll commands while closed', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const baseline = screen.renderRequests.length
    ctx.emit('blue/btw-command', 'scroll-up')
    ctx.emit('blue/btw-command', 'close')
    expect(screen.renderRequests.length).toBe(baseline)
    expect(screen.paneLines()).toEqual([])

    await run(commands, 'q?')
    const side = agents.sides[0]!
    const session = side.projectionSession
    const long = Array.from({ length: 25 }, (_, index) => `line${index + 1}`).join('\n')
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: long }]))
    // One render materializes the overflow budget (the fake screen renders
    // only on request); the scroll commands act on the measured state.
    expect(screen.paneLines()[1]).toBe(bodyRow('line20'))

    // Scrolling past the top clamps to offset 0: the question row shows.
    for (let i = 0; i < 30; i += 1) ctx.emit('blue/btw-command', 'scroll-up')
    expect(screen.paneLines()[1]).toBe(bodyRow('› q?'))
    // Scroll-down past the bottom clamps to the tail.
    for (let i = 0; i < 30; i += 1) ctx.emit('blue/btw-command', 'scroll-down')
    expect(screen.paneLines()[1]).toBe(bodyRow('line20'))
    await dispose()
  })

  it('treats a scroll command as a no-op while the body fits the budget', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'q?')
    // Question + thinking = 2 rows against a budget of 7: nothing to scroll.
    expect(screen.paneLines()).toEqual(frame(['› q?', 'thinking…']))
    const baseline = screen.renderRequests.length
    ctx.emit('blue/btw-command', 'scroll-up')
    ctx.emit('blue/btw-command', 'scroll-down')
    expect(screen.renderRequests.length).toBe(baseline)
    expect(screen.paneLines()).toEqual(frame(['› q?', 'thinking…']))
    await dispose()
  })

  it('resets the scroll state and height ratchet on a fresh question', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'first?')
    const first = agents.sides[0]!
    const session = first.projectionSession
    const long = Array.from({ length: 25 }, (_, index) => `line${index + 1}`).join('\n')
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: long }]))
    // Render once so the overflow budget is measured, then scroll up one.
    expect(screen.paneLines()[1]).toBe(bodyRow('line20'))
    ctx.emit('blue/btw-command', 'scroll-up')
    expect(screen.paneLines()[1]).toBe(bodyRow('line19'))

    // A new question replaces the slot and starts from the top, unscrolled.
    await run(commands, 'second?')
    expect(agents.sides[0]!.disposed).toBe(1)
    expect(screen.paneLines()).toEqual(frame(['› second?', 'thinking…']))
    await dispose()
  })

  it('keeps the high-water height when the body shrinks (min-height ratchet)', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'q?')
    const side = agents.sides[0]!
    const session = side.projectionSession
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: 'l1\nl2\nl3' }]))
    // Body = question + 3 lines + thinking = 5 rows → the panel grows to 5.
    expect(screen.paneLines()).toHaveLength(1 + 5 + 1)

    // The finalize shrinks the body to question + 1 line, and the idle flip
    // drops the thinking row — but the panel stays at its high-water height
    // instead of flickering.
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: 'done' }]))
    agents.emitStatus(side, 'idle')
    const lines = screen.paneLines()
    expect(lines).toHaveLength(1 + 5 + 1)
    expect(lines[1]).toBe(bodyRow('› q?'))
    expect(lines[2]).toBe(bodyRow('done'))
    // The padding rows render through the border machinery, like the rest.
    expect(lines[3]).toBe(bodyRow(''))
    expect(lines[4]).toBe(bodyRow(''))
    await dispose()
  })

  it('renders uncapped when the terminal height is unknown', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    screen.rows = 0
    await run(commands, 'q?')
    const side = agents.sides[0]!
    const session = side.projectionSession
    const long = Array.from({ length: 25 }, (_, index) => `line${index + 1}`).join('\n')
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: long }]))
    const lines = screen.paneLines()
    // 1 + 27 + 1: every body row renders, untruncated.
    expect(lines).toHaveLength(1 + 27 + 1)
    expect(lines[0]).toBe(rule(false))
    expect(lines[1]).toBe(bodyRow('› q?'))
    expect(lines.at(-2)).toBe(bodyRow('thinking…'))
    await dispose()
  })

  it('continues the side conversation on submit while idle', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)
    await run(commands, 'first?')
    const side = agents.sides[0]!
    const session = side.projectionSession
    // The first turn settles; the busy flag flips with it.
    agents.emitStatus(side, 'idle')
    expect(splice).toHaveBeenLastCalledWith(true, false)
    expect(side.followups).toHaveLength(1)

    // The editor routes the next Enter here: a second turn appends to the
    // SAME side agent (no second creation), and the busy flag returns.
    ctx.emit('blue/btw-command', 'submit', 'and then?')
    expect(agents.creates).toHaveLength(1)
    expect(splice).toHaveBeenLastCalledWith(true, true)
    expect(side.followups).toEqual(['first?', 'and then?'])
    // The first turn settled before the submit, so its thinking row is gone;
    // the blank separator row sits between the two turns.
    expect(screen.paneLines()).toEqual(frame(['› first?', '', '› and then?', 'thinking…']))

    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: 'second reply' }]))
    agents.emitStatus(side, 'idle')
    expect(screen.paneLines()).toEqual(frame(['› first?', '', '› and then?', 'second reply']))
    await dispose()
  })

  it('ignores a submit while the side agent is still answering', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'first?')
    const side = agents.sides[0]!
    const baseline = side.followups.length
    const renderBaseline = screen.renderRequests.length

    ctx.emit('blue/btw-command', 'submit', 'ignored')
    expect(side.followups).toHaveLength(baseline)
    expect(screen.renderRequests.length).toBe(renderBaseline)
    // The pane still shows the first turn only.
    expect(screen.paneLines()).toEqual(frame(['› first?', 'thinking…']))
    await dispose()
  })

  it('ignores submit commands with no text or while closed', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const baseline = screen.renderRequests.length
    ctx.emit('blue/btw-command', 'submit', '')
    ctx.emit('blue/btw-command', 'submit')
    expect(screen.renderRequests.length).toBe(baseline)

    await run(commands, 'q?')
    const side = agents.sides[0]!
    ctx.emit('blue/btw-command', 'submit', '   ')
    expect(side.followups).toHaveLength(1)
    await dispose()
  })

  it('closes through the close command and hides below the minimum width', async () => {
    resetSeq()
    const agents = new FakeSessionActions()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)
    await run(commands, 'q?')
    const side = agents.sides[0]!

    const pane = screen.bottomChildren[0]!
    // The mount layer's gutter squeezes the child to `width - 2` and pads
    // the left column; the pane's own minimum-width guard hides below that.
    expect(pane.render(5)).toEqual([])
    expect(pane.render(10)[0]?.slice(1).startsWith('╭')).toBe(true)
    pane.invalidate()
    expect(pane.render(10)[0]?.slice(1).startsWith('╭')).toBe(true)

    ctx.emit('blue/btw-command', 'close')
    await vi.waitFor(() => {
      expect(side.disposed).toBe(1)
    })
    // The splice release lands on the dismiss continuation's microtask.
    await vi.waitFor(() => {
      expect(splice).toHaveBeenLastCalledWith(false)
    })
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })
})
