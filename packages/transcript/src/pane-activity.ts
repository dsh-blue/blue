/**
 * `blue-pane-activity` plugin: a one-row spinner bottom pane shown while the
 * attached agent runs. The row is an accent braille frame plus a muted
 * `working…` label; an idle agent renders zero rows, so the pane occupies
 * nothing. While running, an interval (default 100ms) advances the frame and
 * requests a redraw; the interval stops on idle and on fiber unload. The
 * timer primitives live behind a module-level replaceable holder (the
 * `status-git` runner precedent) so tests inject fakes. `blueSession` is
 * read through `ctx.get` plus `'blue/session-changed'` (never `inject`), the
 * same discipline as the transcript plugin itself, and `'agent/status'`
 * flips are filtered to the attached agent.
 *
 * @module @dsh-blue/blue-transcript/pane-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueComponent, BlueSemanticColors } from '@dsh-blue/blue-core'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-activity'

/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme']

/** Spinner frame cycle interval in milliseconds. */
export const SPINNER_INTERVAL_MS = 100

/** The braille frames the spinner cycles through. */
export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** The rendered row's visible width: one frame cell, a space, `working…`. */
const SPINNER_LINE_WIDTH = 10

/** The timer primitives behind the spinner animation; replaceable in tests. */
export interface ActivityTimers {
  /** Start a repeating callback; mirrors the global `setInterval`. */
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  /** Stop a repeating callback; mirrors the global `clearInterval`. */
  clearInterval: (handle: ReturnType<typeof setInterval>) => void
}

/** The process timer primitives. */
const defaultActivityTimers: ActivityTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: handle => clearInterval(handle),
}

let activityTimers: ActivityTimers = defaultActivityTimers

/**
 * Replace the animation timers (tests inject fakes here).
 * @param timers - the replacement, or `undefined` to restore the defaults.
 */
export function setActivityTimers(timers: ActivityTimers | undefined): void {
  activityTimers = timers ?? defaultActivityTimers
}

/** The pane's render state, mutated by the status tracking in `apply`. */
interface ActivityState {
  /** Whether the attached agent is running. */
  running: boolean
  /** The current spinner frame counter. */
  frame: number
}

/**
 * The spinner pane: one row while running, zero rows otherwise. Rows narrower
 * than the fixed line render nothing rather than overflow the viewport.
 */
class ActivityPaneComponent implements BlueComponent {
  /**
   * @param colors - the semantic color table (accent frame, muted label).
   * @param state - the shared running/frame state.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly state: ActivityState,
  ) {}

  /**
   * @param width - current viewport width in columns.
   * @returns the spinner row while running; none otherwise.
   */
  render(width: number): string[] {
    if (!this.state.running) return []
    if (width < SPINNER_LINE_WIDTH) return []
    const frame = SPINNER_FRAMES[this.state.frame % SPINNER_FRAMES.length]!
    return [`${this.colors.primary(frame)} ${this.colors.muted('working…')}`]
  }

  /** Stateless render; nothing to drop. */
  invalidate(): void {}
}

/**
 * Mount the activity pane. The visible state tracks the attached agent's
 * `status`: attaching reads `agent.status` as the initial value (a session
 * switch to a running agent shows the spinner immediately), and
 * `'agent/status'` flips drive the transitions. A redraw is requested only
 * when the running state actually changed; the interval additionally
 * requests one per frame advance. Unloading the fiber unmounts the pane and
 * stops the timer.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const screen = ctx.blueScreen
  const state: ActivityState = { running: false, frame: 0 }
  let agent: Agent | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const stopTimer = (): void => {
    if (timer === undefined) return
    activityTimers.clearInterval(timer)
    timer = undefined
  }

  /** Reconcile the pane with the attached agent's current status. */
  const sync = (): void => {
    const running = agent?.status === 'running'
    if (running === state.running) return
    state.running = running
    if (running) {
      state.frame = 0
      timer = activityTimers.setInterval(() => {
        state.frame += 1
        screen.requestRender()
      }, SPINNER_INTERVAL_MS)
    } else {
      stopTimer()
    }
    screen.requestRender()
  }

  const attach = (next: Agent): void => {
    agent = next
    sync()
  }

  const current = ctx.get('blueSession')?.current
  if (current) attach(current)
  ctx.on('blue/session-changed', attach)
  ctx.on('agent/status', (payload) => {
    if (payload.agent !== agent) return
    sync()
  })

  const pane = new ActivityPaneComponent(colors, state)
  // Bottom panes render in mount order; a zero-row render occupies nothing.
  ctx.effect(() => screen.addBottomChild(pane))
  // Effect-bound so unloading this fiber stops the animation.
  ctx.effect(() => () => stopTimer())
}
