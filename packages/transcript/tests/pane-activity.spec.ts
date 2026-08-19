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
import { asAgent, fakeAgent, type FakeAgent } from './status-fakes.ts'
import {
  reasoningDelta,
  resetSeq,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  turnEnd,
  turnStart,
} from './helpers.ts'
import type { Context } from '@deepseek-ai/cordis'

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

describe('blue-pane-activity', () => {
  it('mounts one bottom pane that renders zero rows while never active', async () => {
    const { screen, dispose } = await boot()
    expect(activity.name).toBe('blue-pane-activity')
    expect(activity.inject).toEqual(['blueScreen', 'blueTheme', 'blueComponents'])
    expect(screen.bottomChildren).toHaveLength(1)
    expect(screen.paneLines()).toEqual([])
    await dispose()
    expect(screen.bottomChildren).toHaveLength(0)
  })

  it('shows the moon row with a teaching tip for a running agent (waiting)', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { screen, timers, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${FIRST_TIP}`])
    expect(timers.intervals).toEqual([120])

    // Each tick advances the frame and requests a redraw.
    const baseline = screen.renderRequests.length
    timers.ticks[0]!()
    expect(screen.paneLines()).toEqual([`🌒 · Tip: ${FIRST_TIP}`])
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // The frame wraps around the moon cycle.
    for (let index = 0; index < MOON_SPINNER_FRAMES.length - 1; index += 1) timers.ticks[0]!()
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${FIRST_TIP}`])

    // Unloading stops the animation.
    await dispose()
    expect(timers.cleared).toBe(1)
  })

  it('switches to composing\'s braille row and back to the moon', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, timers, dispose } = await boot(agent)
    emit2(ctx, agent, textDelta(1, 1, 'answering'))
    expect(screen.paneLines()).toEqual(['⠋ working…'])
    expect(timers.intervals).toEqual([120, 80])
    // The composing kind picked a fresh tip; returning to the moon kind
    // picks the rotation's next slot.
    timers.ticks[1]!()
    expect(screen.paneLines()).toEqual(['⠙ working…'])
    emit2(ctx, agent, toolResultEvent(1, 1, "c0", "done"))
    // The shared frame counter survives the style flip; the third loading
    // kind change picked the rotation's next slot.
    expect(screen.paneLines()).toEqual([`🌒 · Tip: ${buildTipRotation(STATUS_TIPS)[2]!.text}`])
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
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${FIRST_TIP}`])
    await dispose()
  })

  it('keeps the moon up through invisible reasoning', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, dispose } = await boot(agent)
    emit2(ctx, agent, reasoningDelta(1, 1, ' '))
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${FIRST_TIP}`])
    await dispose()
  })

  it('hides while a dialog panel occupies the editor slot', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, timers, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${FIRST_TIP}`])
    ctx.emit('blue/editor-slot-swapped', true)
    expect(screen.paneLines()).toEqual([])
    expect(timers.cleared).toBe(1)
    // Returning re-enters the moon loading kind: a fresh tip from the next
    // rotation slot.
    ctx.emit('blue/editor-slot-swapped', false)
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${buildTipRotation(STATUS_TIPS)[1]!.text}`])
    expect(timers.intervals).toEqual([120, 120])
    await dispose()
  })

  it('parks the idle placeholder after activity and resets stale idle on wake', async () => {
    const agent = fakeAgent([])
    const { ctx, screen, timers, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([])

    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${FIRST_TIP}`])
    emit2(ctx, agent, turnEnd(1))
    expect(screen.paneLines()).toEqual([''])

    // A turn that ended leaves the phase idle; waking the agent treats the
    // stale idle as a fresh waiting turn until an event lands.
    agent.status = 'idle'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'idle' })
    expect(screen.paneLines()).toEqual([''])
    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${buildTipRotation(STATUS_TIPS)[1]!.text}`])
    await dispose()
    expect(timers.cleared).toBe(2)
  })

  it('filters other agents\' flips and foreign sessions\' events', async () => {
    const agent = fakeAgent([])
    const { ctx, screen, timers, dispose } = await boot(agent)
    ctx.emit('agent/status', { agent: asAgent(runningAgent(fakeAgent([]))), status: 'running' })
    expect(timers.ticks).toHaveLength(0)
    expect(screen.paneLines()).toEqual([])

    // A foreign session's events never reach the tracker.
    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    const foreign = fakeAgent([])
    ctx.emit('session/event', foreign.session, textDelta(1, 1, 'x'))
    expect(screen.paneLines()).toEqual([`🌑 · Tip: ${FIRST_TIP}`])
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
    const pane = screen.bottomChildren[0]!
    const full = `🌑 · Tip: ${FIRST_TIP}`
    // The fake width measure counts codepoints, so the moon is one cell
    // there: the row's visible width is 1 + the lead + the tip.
    const visible = 1 + ' · Tip: '.length + FIRST_TIP.length
    expect(pane.render(visible)).toEqual([full])
    // One column short drops the tip but keeps the moon.
    expect(pane.render(visible - 1)).toEqual(['🌑'])
    // With no room for the frame itself there is no row.
    expect(pane.render(0)).toEqual([])
    pane.invalidate()
    expect(pane.render(visible)).toEqual([full])
    await dispose()
  })

  it('renders nothing below the composing row\'s fixed width', async () => {
    const agent = runningAgent(fakeAgent([]))
    const { ctx, screen, dispose } = await boot(agent)
    emit2(ctx, agent, textDelta(1, 1, 'answering'))
    const pane = screen.bottomChildren[0]!
    expect(pane.render(10)).toEqual(['⠋ working…'])
    expect(pane.render(9)).toEqual([])
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
