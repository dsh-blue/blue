/**
 * `blue-pane-activity` plugin: the mode machine. Covers the moon/braille
 * rows per phase, the teaching-tip rotation (picked on loading-kind change,
 * the kimi semantics), the thinking/dialog empty renders, the idle
 * placeholder ratchet, snapshot-seeded attach, the per-style intervals, the
 * width guards, and unload cleanup.
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as activity from '../src/pane-activity.ts'
import { buildTipRotation } from '../src/status-tips.ts'
import { MOON_SPINNER_FRAMES, MOON_SPINNER_INTERVAL_MS } from '../src/spinners.ts'
import { STATUS_TIPS } from '../src/tips-content.ts'
import { bootPanePlugin, type PanePluginHarness } from './pane-fakes.ts'
import { asAgent, COLORS, fakeAgent, type FakeAgent } from './status-fakes.ts'
import {
  assistantEvent,
  event,
  reasoningDelta,
  resetSeq,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  turnEnd,
  turnStart,
} from './helpers.ts'
import { visibleWidth } from '../../core/src/width.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { BlueComponent } from '@dsh-blue/blue-core'
import { BlueLocaleService } from '../../frontend/src/locale.ts'
import { initialConversationFacts } from '../../conversation/src/facts.ts'

/** Fake timers recording interval creation/clearing; ticks run manually. */
class FakeTimers implements activity.ActivityTimers {
  readonly ticks: (() => void)[] = []
  readonly intervals: number[] = []
  cleared = 0

  setInterval(callback: () => void, ms: number): ReturnType<typeof setInterval> {
    this.ticks.push(callback)
    this.intervals.push(ms)
    return this.ticks.length as unknown as ReturnType<typeof setInterval>
  }

  clearInterval(_handle: ReturnType<typeof setInterval>): void {
    this.cleared += 1
  }
}

afterEach(() => {
  activity.setActivityTimers(undefined)
  resetSeq()
})

interface ActivityHarness extends PanePluginHarness {
  timers: FakeTimers
}

/**
 * Boot the pane with fake timers installed.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 */
async function boot(current: FakeAgent | null = null): Promise<ActivityHarness> {
  const timers = new FakeTimers()
  activity.setActivityTimers(timers)
  const harness = await bootPanePlugin(activity, current)
  return { ...harness, timers }
}

/** A fake agent preset to the given status. */
function runningAgent(running: FakeAgent): FakeAgent {
  running.status = 'running'
  return running
}

/** The first moon-row tip: slot 0 of the SWRR rotation. */
const FIRST_TIP = buildTipRotation(STATUS_TIPS)[0]!.text

/** Emit one session event for the agent's session. */
function emit2(ctx: Context, agent: FakeAgent, event: Parameters<typeof turnStart>[0]): void {
  ctx.emit('session/event', agent.session, event)
}

/** Render the mounted (gutter-wrapped) pane as if the child saw `width`. */
function unwrapped(pane: BlueComponent, width: number): string[] {
  return pane.render(width)
}

describe('blue-pane-activity', () => {
  it('mounts one bottom pane that renders the kimi placeholder row while idle', async () => {
    const { screen, dispose } = await boot()
    expect(activity.name).toBe('blue-pane-activity')
    expect(activity.inject).toEqual(['bluePanes', 'blueSessionFacts'])
    expect(screen.bottomChildren).toHaveLength(1)
    // kimi's Spacer(1): the placeholder row is always present when the
    // spinner is not, so the dock never jumps at the activity edges.
    expect(screen.paneLines()).toEqual([''])
    await dispose()
    expect(screen.bottomChildren).toHaveLength(0)
  })

  it('shows the moon row with a teaching tip for a running agent (waiting)', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { screen, timers, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    expect(timers.intervals).toEqual([120])

    // Each tick advances the frame and requests a redraw.
    const baseline = screen.renderRequests.length
    timers.ticks[0]!()
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[1]!} · Tip: ${FIRST_TIP}`])
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // The frame wraps around the moon cycle.
    for (let index = 0; index < MOON_SPINNER_FRAMES.length - 1; index += 1) timers.ticks[0]!()
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])

    // Unloading stops the animation.
    await dispose()
    expect(timers.cleared).toBe(1)
  })

  it('uses Agent status as the waiting fallback while the projection is still idle', async () => {
    const timers = new FakeTimers()
    activity.setActivityTimers(timers)
    const agent = runningAgent(fakeAgent([]))
    const facts = initialConversationFacts()
    const harness = await bootPanePlugin(activity, agent, {
      blueSessionFacts: {
        current: facts,
        currentAgent: asAgent(agent),
        subscribe(listener: (value: typeof facts) => void) {
          listener(facts)
          return () => {}
        },
        subscribeAgent(listener: (value: ReturnType<typeof asAgent>) => void) {
          listener(asAgent(agent))
          return () => {}
        },
      },
    })
    expect(harness.screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    await harness.dispose()
  })

  it('switches the mounted activity row in place when locale changes', async () => {
    const harness = await boot(runningAgent(fakeAgent([])))
    const pane = harness.screen.bottomChildren[0]
    const localeFiber = await harness.ctx.plugin({
      name: 'activity-locale',
      apply(ctx: Context) {
        const locale = new BlueLocaleService(ctx, { systemLocale: 'en' })
        ctx.effect(() => () => locale.dispose())
      },
    })
    await Promise.resolve()
    expect(harness.screen.paneLines()[0]).toContain(' · Tip: ')
    harness.ctx.blueLocale.setPreference('zh')
    expect(harness.screen.bottomChildren[0]).toBe(pane)
    expect(harness.screen.paneLines()[0]).toContain(' · 提示：')
    await localeFiber.dispose()
    await harness.dispose()
  })

  it('shows the kimi working row with a fresh tip while composing', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, timers, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    // Composing flips to the braille style at 80 ms; the kind change picks
    // the next rotation slot and the row is the kimi shape: primary frame,
    // plain label, riding tip (the user's second dogfood ruling restored
    // the row — kimi's assistant block has no cursor).
    emit2(ctx, agent, textDelta(1, 1, 'answering'))
    const composingTip = buildTipRotation(STATUS_TIPS)[1]!.text
    // The streamed chars ride as the live ↓ counter (9 chars → ↓2).
    expect(screen.paneLines()).toEqual([`⠋ working... ↓2 · Tip: ${composingTip}`])
    expect(timers.intervals).toEqual([120, 80])
    // A tick advances the shared frame counter.
    timers.ticks[1]!()
    expect(screen.paneLines()).toEqual([`⠙ working... ↓2 · Tip: ${composingTip}`])
    // A tool result re-enters the moon kind with the next rotation slot;
    // the shared frame counter survived the style flip, so the moon picks
    // up where the cycle left off.
    emit2(ctx, agent, toolCallEvent(1, 1, 'c0', 'worker', '{}'))
    emit2(ctx, agent, toolResultEvent(1, 1, 'c0', 'done'))
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[1]!} ↓2 · Tip: ${buildTipRotation(STATUS_TIPS)[2]!.text}`])
    await dispose()
  })

  it('drops the composing tip then the whole row under width pressure', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, dispose } = await boot(agent)
    emit2(ctx, agent, textDelta(1, 1, 'answering'))
    const tip = buildTipRotation(STATUS_TIPS)[1]!.text
    const visible = 1 + ' working...'.length + ' ↓2'.length + ' · Tip: '.length + tip.length
    expect(screen.paneLines(visible)).toEqual([`⠋ working... ↓2 · Tip: ${tip}`])
    for (const width of [visible - 1, 12, 10]) {
      expect(screen.paneLines(width).every(line => visibleWidth(line) <= width)).toBe(true)
    }
    emit2(ctx, agent, toolCallEvent(1, 1, 'c0', 'worker', '{}'))
    emit2(ctx, agent, toolResultEvent(1, 1, 'c0', 'done'))
    expect(screen.paneLines(2).every(line => visibleWidth(line) <= 2)).toBe(true)
    await dispose()
  })

  it('rides the turn token flow: ↑ from the latest usage, ↓ from streamed chars, reset per turn', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, dispose } = await boot(agent)
    // Before any data the moon row carries no counter.
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    // Chunks that carry no text (block starts, tool-call deltas) count
    // nothing.
    emit2(ctx, agent, event('assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }))
    expect(screen.paneLines()[0]).not.toContain('↓')
    // A finished response contributes its input side as ↑ (context tokens:
    // input + cache reads/writes).
    const finished = assistantEvent(1, 1, [{ type: 'text', text: 'done' }])
    finished.data.usage = { inputTokens: 2000, outputTokens: 5, cacheReadTokens: 1024 }
    emit2(ctx, agent, finished)
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} ↑3k · Tip: ${FIRST_TIP}`])
    // Streamed text and reasoning accumulate as ↓ (chars over the 4-chars
    // per-token heuristic); both counters ride together.
    emit2(ctx, agent, textDelta(1, 2, 'answering'))
    emit2(ctx, agent, reasoningDelta(1, 2, 'thinking hard'))
    emit2(ctx, agent, toolCallEvent(1, 2, 'c0', 'worker', '{}'))
    emit2(ctx, agent, toolResultEvent(1, 2, 'c0', 'done'))
    expect(screen.paneLines()[0]).toContain('↑3k ↓5')
    // A new turn resets both (the tip rotation is independent — assert the
    // counters, not the tip slot).
    emit2(ctx, agent, turnEnd(1))
    emit2(ctx, agent, turnStart(2))
    const resetRow = screen.paneLines()[0] ?? ''
    expect(resetRow).not.toContain('↑')
    expect(resetRow).not.toContain('↓')
    // An empty text delta still flips to composing, but with no counter —
    // zero streamed chars renders no ↓.
    emit2(ctx, agent, textDelta(2, 1, ''))
    const composingRow = screen.paneLines()[0] ?? ''
    expect(composingRow).toContain('working...')
    expect(composingRow).not.toContain('↓')
    await dispose()
  })

  it('empties while the model thinks (the spinner belongs to the thinking block)', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, timers, dispose } = await boot(agent)
    emit2(ctx, agent, reasoningDelta(1, 1, 'pondering'))
    expect(screen.paneLines()).toEqual([])
    expect(timers.cleared).toBe(1)
    // Once active, the idle placeholder ratchet holds a blank row.
    emit2(ctx, agent, turnEnd(1))
    expect(screen.paneLines()).toEqual([''])
    await dispose()
  })

  it('shows the moon row without the composing label while a tool runs', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, dispose } = await boot(agent)
    emit2(ctx, agent, toolCallEvent(1, 1, 'c1', 'bash', '{}'))
    // waiting → tool keeps the moon loading kind, so the tip survives.
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    await dispose()
  })

  it('keeps the moon up through invisible reasoning', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, dispose } = await boot(agent)
    emit2(ctx, agent, reasoningDelta(1, 1, ' '))
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    await dispose()
  })

  it('hides while a dialog panel occupies the editor slot', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, timers, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    ctx.emit('blue/editor-slot-swapped', true)
    expect(screen.paneLines()).toEqual([])
    expect(timers.cleared).toBe(1)
    // Returning re-enters the moon loading kind: a fresh tip from the next
    // rotation slot.
    ctx.emit('blue/editor-slot-swapped', false)
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${buildTipRotation(STATUS_TIPS)[1]!.text}`])
    expect(timers.intervals).toEqual([120, 120])
    await dispose()
  })

  it('parks the idle placeholder and resets stale idle on wake', async () => {
    const agent = fakeAgent([])
    const { ctx, screen, timers, dispose } = await boot(agent)
    // kimi's Spacer(1): the placeholder shows even before any activity.
    expect(screen.paneLines()).toEqual([''])

    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    emit2(ctx, agent, turnEnd(1))
    expect(screen.paneLines()).toEqual([''])

    // A turn that ended leaves the phase idle; waking the agent treats the
    // stale idle as a fresh waiting turn until an event lands.
    agent.status = 'idle'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'idle' })
    expect(screen.paneLines()).toEqual([''])
    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${buildTipRotation(STATUS_TIPS)[1]!.text}`])
    await dispose()
    expect(timers.cleared).toBe(2)
  })

  it('filters other agents\' flips and foreign sessions\' events', async () => {
    const agent = fakeAgent([])
    const { ctx, screen, timers, dispose } = await boot(agent)
    ctx.emit('agent/status', { agent: asAgent(runningAgent(fakeAgent([]))), status: 'running' })
    expect(timers.ticks).toHaveLength(0)
    expect(screen.paneLines()).toEqual([''])

    // A foreign session's events never reach the tracker.
    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    const foreign = fakeAgent([])
    ctx.emit('session/event', foreign.session, textDelta(1, 1, 'x'))
    expect(screen.paneLines()).toEqual([`${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`])
    await dispose()
  })

  it('seeds the phase from the snapshot on attach', async () => {
    // The snapshot ends mid-thinking: the resumed pane is empty at once.
    const agent = runningAgent(fakeAgent([
      turnStart(1),
      reasoningDelta(1, 1, 'mid-thought'),
    ]))
    const { screen, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })

  it('drops the tip under width pressure and the row entirely below it', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { screen, dispose } = await boot(agent)
    const full = `${MOON_SPINNER_FRAMES[0]!} · Tip: ${FIRST_TIP}`
    // The width measure is pi-tui's (D48): the moon glyph spans two cells,
    // so the row's visible width is the moon + the lead + the tip.
    const visible = visibleWidth(MOON_SPINNER_FRAMES[0]!) + ' · Tip: '.length + FIRST_TIP.length
    expect(screen.paneLines(visible)).toEqual([full])
    for (const width of [visible - 1, 2, 1]) {
      expect(screen.paneLines(width).every(line => visibleWidth(line) <= width)).toBe(true)
    }
    await dispose()
  })

  it('animates with the default timers when none are injected', async () => {
    const harness = await bootPanePlugin(activity, runningAgent(fakeAgent([])))
    const baseline = harness.screen.renderRequests.length
    await new Promise(resolve => setTimeout(resolve, MOON_SPINNER_INTERVAL_MS * 2 + 50))
    expect(harness.screen.renderRequests.length).toBeGreaterThan(baseline)
    await harness.dispose()
  })
})
