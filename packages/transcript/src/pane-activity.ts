/**
 * `blue-pane-activity` plugin: the dock's activity pane as the kimi mode
 * machine (the `resolveActivityPaneMode` port, S17). The pane renders one
 * row that says what the attached agent is doing: `waiting` and `tool` show
 * the moon spinner with a rotating teaching tip (the S15 footer pool through
 * the same SWRR expansion, picked fresh when the loading kind changes — the
 * kimi working-tips semantics), `composing` shows the braille `working...`
 * row with the frame in `primary`, the plain label, and the tip riding when
 * the width allows (full kimi parity — the user's second dogfood ruling
 * restored the row: kimi's assistant block has no cursor, so its pane
 * spinner is the composing signal; Blue aligns), `thinking` clears the pane
 * entirely (the spinner belongs to the transcript's thinking block), and
 * `idle` keeps the one-row placeholder kimi's `Spacer(1)` holds — always,
 * so the dock never jumps when the spinner disappears. A dialog panel
 * occupying the editor slot (`'blue/editor-slot-swapped'`) hides the pane
 * outright — below an open panel only the footer stays (the S16 dogfood
 * ruling).
 *
 * The phase is the fold's streaming stage: `StreamingPhaseTracker` over the
 * attached session's events (`session/event`, filtered like the transcript
 * mounter), seeded from the durable snapshot on attach so a resumed
 * mid-stream agent lands in the right phase at once. rc.7's event surface
 * carries no step-retry record, so kimi's retry label/detail row is cropped
 * — retries read as plain `waiting`. The moon glyph is two cells wide; row
 * width math goes through the live `blueComponents.visibleWidth`.
 *
 * @module @dsh-blue/blue-transcript/pane-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueComponent, BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'
import { StreamingPhaseTracker } from './phase.ts'
import { buildTipRotation } from './status-tips.ts'
import { STATUS_TIPS } from './tips-content.ts'
import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  MOON_SPINNER_FRAMES,
  MOON_SPINNER_INTERVAL_MS,
} from './spinners.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-activity'

/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents']

/** The joiner between the frame and the teaching tip (kimi format). */
const TIP_LEAD = ' · Tip: '

/** The composing row's base: one frame cell, a space, the kimi label. */
const WORKING_LABEL = ' working...'

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

/** What the pane renders; `hidden` covers the dialog hangup. */
export type ActivityPaneMode = 'hidden' | 'waiting' | 'thinking' | 'composing' | 'tool' | 'idle'

/** The loading kinds that carry a teaching tip (kimi `loadingTipKind`). */
type TipKind = 'moon' | 'composing'

/** The pane's render state, reconciled by the `sync` closure in `apply`. */
interface ActivityState {
  /** The resolved mode the row renders from. */
  mode: ActivityPaneMode
  /** The current spinner frame counter (moon and braille share it). */
  frame: number
  /** The teaching tip riding the spinner row; '' outside the spinner states. */
  tip: string
  /** Whether a dialog panel occupies the editor slot. */
  dialog: boolean
}

/**
 * The activity pane: one row while a spinner state is live, the kimi
 * `Spacer(1)` blank placeholder row otherwise, and none while a dialog
 * occupies the editor slot.
 */
class ActivityPaneComponent implements BlueComponent {
  /**
   * @param colors - the semantic color table (primary frame, muted tip).
   * @param components - the factory providing the width helpers.
   * @param state - the shared render state.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly state: ActivityState,
  ) {}

  /**
   * @param width - current viewport width in columns.
   * @returns the pane's row, or none for the empty modes.
   */
  render(width: number): string[] {
    switch (this.state.mode) {
      case 'hidden':
        // Below an open dialog panel only the footer stays.
        return []
      case 'thinking':
        // The spinner belongs to the transcript's thinking block.
        return []
      case 'idle':
        // kimi's Spacer(1): the placeholder row is always present when the
        // spinner is not, so the dock never jumps at the activity edges.
        return ['']
      case 'waiting':
      case 'tool': {
        const frame = MOON_SPINNER_FRAMES[this.state.frame % MOON_SPINNER_FRAMES.length]!
        const row = frame + this.colors.muted(`${TIP_LEAD}${this.state.tip}`)
        // The tip rides along only while the whole row fits (the moon is
        // two cells wide — measured, never assumed); a row not even the
        // frame fits renders nothing.
        if (this.components.visibleWidth(row) <= width) return [row]
        return this.components.visibleWidth(frame) <= width ? [frame] : []
      }
      case 'composing': {
        const frame = BRAILLE_SPINNER_FRAMES[this.state.frame % BRAILLE_SPINNER_FRAMES.length]!
        // kimi parity: the primary frame with the plain label, the tip
        // riding when it fits.
        const base = `${this.colors.primary(frame)}${WORKING_LABEL}`
        const row = base + this.colors.muted(`${TIP_LEAD}${this.state.tip}`)
        if (this.components.visibleWidth(row) <= width) return [row]
        return this.components.visibleWidth(base) <= width ? [base] : []
      }
    }
  }

  /** Stateless render; nothing to drop. */
  invalidate(): void {}
}

/**
 * Mount the activity pane. The row reconciles against three facts: the
 * editor-slot occupancy (dialogs hide the pane), the attached agent's
 * status (idle parks the placeholder), and the streaming phase tracker over
 * the attached session's events. The frame timer runs only while a spinner
 * state is live, at the style's interval (moon 120 ms, braille 80 ms); each
 * tick advances the shared frame counter and requests a redraw. `sync`
 * requests a redraw only when the mode or the tip actually changed.
 * Unloading the fiber unmounts the pane and stops the timer.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const screen = ctx.blueScreen
  const components = ctx.blueComponents
  const state: ActivityState = {
    mode: 'idle', frame: 0, tip: '', dialog: false,
  }
  let agent: Agent | undefined
  // Never null: attach re-seeds it per session, and before any attach the
  // agent is undefined so the tracker's phase is unreachable.
  let tracker = new StreamingPhaseTracker()
  let timer: ReturnType<typeof setInterval> | undefined
  let timerMs = 0
  let tipKind: TipKind | undefined
  const rotation = buildTipRotation(STATUS_TIPS)
  let tipIndex = 0

  const stopTimer = (): void => {
    if (timer === undefined) return
    activityTimers.clearInterval(timer)
    timer = undefined
    timerMs = 0
  }

  const ensureTimer = (ms: number): void => {
    if (timer !== undefined && timerMs === ms) return
    stopTimer()
    timerMs = ms
    timer = activityTimers.setInterval(() => {
      state.frame += 1
      screen.requestRender()
    }, ms)
  }

  /** Reconcile the row (mode, tip, timer) with the pane's three facts. */
  const sync = (): void => {
    const running = agent?.status === 'running'
    const mode: ActivityPaneMode = state.dialog
      ? 'hidden'
      : running
        ? tracker.current
        : 'idle'
    const kind: TipKind | undefined = mode === 'composing'
      ? 'composing'
      : mode === 'waiting' || mode === 'tool' ? 'moon' : undefined
    let tipChanged = false
    if (kind !== tipKind) {
      // A fresh tip when the loading kind changes, none when it goes away;
      // a continuous burst of tool calls never flips it (kimi semantics).
      tipKind = kind
      if (kind === undefined || rotation.length === 0) {
        state.tip = ''
      } else {
        state.tip = rotation[tipIndex % rotation.length]!.text
        tipIndex += 1
      }
      tipChanged = true
    }
    const spinner = kind !== undefined
    if (spinner) {
      ensureTimer(mode === 'composing' ? BRAILLE_SPINNER_INTERVAL_MS : MOON_SPINNER_INTERVAL_MS)
    } else {
      stopTimer()
    }
    const changed = mode !== state.mode || tipChanged
    state.mode = mode
    if (changed) screen.requestRender()
  }

  /** Bind to a session's agent: fresh tracker seeded from the snapshot. */
  const attach = (next: Agent): void => {
    agent = next
    tracker = new StreamingPhaseTracker()
    for (const event of next.session.events) tracker.apply(event)
    sync()
  }

  const current = ctx.get('blueSession')?.current
  if (current) attach(current)
  ctx.on('blue/session-changed', attach)
  ctx.on('agent/status', (payload) => {
    if (payload.agent !== agent) return
    // A stale `idle` phase belongs to the previous turn's end; waking the
    // agent starts a new one, which reads as `waiting` until its first
    // event lands.
    if (payload.status === 'running' && tracker.current === 'idle') tracker = new StreamingPhaseTracker()
    sync()
  })
  ctx.on('session/event', (session, event) => {
    if (agent === undefined || session !== agent.session) return
    tracker.apply(event)
    sync()
  })
  ctx.on('blue/editor-slot-swapped', (occupied) => {
    state.dialog = occupied
    sync()
  })

  const pane = new ActivityPaneComponent(colors, components, state)
  // Bottom panes render in mount order; a zero-row render occupies nothing.
  ctx.effect(() => screen.addBottomChild(pane))
  // Effect-bound so unloading this fiber stops the animation.
  ctx.effect(() => () => stopTimer())
}
