/**
 * `blue-pane-activity` plugin: the spinner bottom pane. Covers the zero-row
 * idle render, attach from a pre-existing current agent and from
 * `blue/session-changed`, `agent/status` filtering, the frame-advancing
 * interval (injected fake timers and the real defaults), the width guard,
 * and unload cleanup.
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as activity from '../src/pane-activity.ts'
import { bootPanePlugin, type PanePluginHarness } from './pane-fakes.ts'
import { asAgent, fakeAgent, type FakeAgent } from './status-fakes.ts'

/** Fake timers recording interval creation/clearing; ticks run manually. */
class FakeTimers implements activity.ActivityTimers {
  readonly ticks: (() => void)[] = []
  cleared = 0

  setInterval(callback: () => void, _ms: number): ReturnType<typeof setInterval> {
    this.ticks.push(callback)
    return this.ticks.length as unknown as ReturnType<typeof setInterval>
  }

  clearInterval(_handle: ReturnType<typeof setInterval>): void {
    this.cleared += 1
  }
}

afterEach(() => {
  activity.setActivityTimers(undefined)
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

describe('blue-pane-activity', () => {
  it('mounts one bottom pane that renders zero rows while idle', async () => {
    const { screen, dispose } = await boot()
    expect(activity.name).toBe('blue-pane-activity')
    expect(activity.inject).toEqual(['blueScreen', 'blueTheme'])
    expect(screen.bottomChildren).toHaveLength(1)
    expect(screen.paneLines()).toEqual([])
    await dispose()
    expect(screen.bottomChildren).toHaveLength(0)
  })

  it('shows the spinner immediately for a pre-existing running agent', async () => {
    const { screen, timers, dispose } = await boot(runningAgent(fakeAgent([])))
    expect(screen.paneLines()).toEqual(['⠋ working…'])
    expect(timers.ticks).toHaveLength(1)

    // Each tick advances the frame and requests a redraw.
    const baseline = screen.renderRequests.length
    timers.ticks[0]!()
    expect(screen.paneLines()).toEqual(['⠙ working…'])
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // The frame counter wraps around the cycle.
    for (let index = 0; index < activity.SPINNER_FRAMES.length - 1; index += 1) timers.ticks[0]!()
    expect(screen.paneLines()).toEqual(['⠋ working…'])

    // Unloading stops the animation.
    await dispose()
    expect(timers.cleared).toBe(1)
  })

  it('starts and stops on agent/status flips of the attached agent only', async () => {
    const agent = fakeAgent([])
    const { ctx, screen, timers, dispose } = await boot(agent)
    expect(screen.paneLines()).toEqual([])

    // Another agent's flip is filtered out.
    ctx.emit('agent/status', { agent: asAgent(runningAgent(fakeAgent([]))), status: 'running' })
    expect(timers.ticks).toHaveLength(0)
    expect(screen.paneLines()).toEqual([])

    agent.status = 'running'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(screen.paneLines()).toEqual(['⠋ working…'])
    expect(timers.ticks).toHaveLength(1)

    // A duplicate notification changes nothing and requests no redraw.
    const baseline = screen.renderRequests.length
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'running' })
    expect(timers.ticks).toHaveLength(1)
    expect(screen.renderRequests.length).toBe(baseline)

    agent.status = 'idle'
    ctx.emit('agent/status', { agent: asAgent(agent), status: 'idle' })
    expect(screen.paneLines()).toEqual([])
    expect(timers.cleared).toBe(1)
    await dispose()
  })

  it('re-attaches on blue/session-changed using the new agent status', async () => {
    const first = runningAgent(fakeAgent([]))
    const { ctx, screen, timers, dispose } = await boot(first)
    expect(screen.paneLines()).toEqual(['⠋ working…'])

    // A switch to an idle agent stops the timer and hides the pane.
    ctx.emit('blue/session-changed', asAgent(fakeAgent([])))
    expect(screen.paneLines()).toEqual([])
    expect(timers.cleared).toBe(1)

    // The detached agent's flips no longer reach the pane.
    first.status = 'idle'
    const baseline = screen.renderRequests.length
    ctx.emit('agent/status', { agent: asAgent(first), status: 'idle' })
    expect(timers.cleared).toBe(1)
    expect(screen.renderRequests.length).toBe(baseline)

    // A switch between two idle agents requests no redraw.
    ctx.emit('blue/session-changed', asAgent(fakeAgent([])))
    expect(screen.renderRequests.length).toBe(baseline)

    // A switch to a running agent restarts the spinner from the first frame.
    ctx.emit('blue/session-changed', asAgent(runningAgent(fakeAgent([]))))
    expect(screen.paneLines()).toEqual(['⠋ working…'])
    expect(timers.ticks).toHaveLength(2)
    await dispose()
  })

  it('renders nothing below the fixed line width', async () => {
    const { screen, dispose } = await boot(runningAgent(fakeAgent([])))
    const pane = screen.bottomChildren[0]!
    expect(pane.render(10)).toEqual(['⠋ working…'])
    expect(pane.render(9)).toEqual([])
    pane.invalidate()
    expect(pane.render(10)).toEqual(['⠋ working…'])
    await dispose()
  })

  it('animates with the default timers when none are injected', async () => {
    const harness = await bootPanePlugin(activity, runningAgent(fakeAgent([])))
    const baseline = harness.screen.renderRequests.length
    await new Promise(resolve => setTimeout(resolve, activity.SPINNER_INTERVAL_MS * 2 + 50))
    expect(harness.screen.renderRequests.length).toBeGreaterThan(baseline)
    await harness.dispose()
  })
})
