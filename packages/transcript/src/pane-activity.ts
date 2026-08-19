/**
 * `blue-pane-activity` plugin: the dock's activity pane as the kimi mode
 * machine (the `resolveActivityPaneMode` port, S17). The pane renders one
 * row that says what the attached agent is doing: `waiting` and `tool` show
 * the moon spinner with a rotating teaching tip (the S15 footer pool through
 * the same SWRR expansion, picked fresh when the loading kind changes — the
 * kimi working-tips semantics), `composing` shows the braille `working…`
 * row, `thinking` clears the pane entirely (the spinner belongs to the
 * transcript's thinking block), and `idle` keeps a one-row placeholder once
 * anything has run, so the dock does not jump when the spinner disappears.
 * A dialog panel occupying the editor slot (`'blue/editor-slot-swapped'`)
 * hides the pane outright — below an open panel only the footer stays (the
 * S16 dogfood ruling).
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

/** The rendered `working…` row's visible width: one frame cell, a space, the label. */
const SPINNER_LINE_WIDTH = 10

/** The joiner between the moon frame and the teaching tip (kimi format). */
const TIP_LEAD = ' · Tip: '

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
  /** The teaching tip riding the spinner row; absent in non-loading modes. */
  tip: string | undefined
  /** Whether any spinner ever ran — the idle placeholder's ratchet. */
  everActive: boolean
  /** Whether a dialog panel occupies the editor slot. */
  dialog: boolean
}

/**
 * The activity pane: one row while a spinner state is live, a blank
 * placeholder row once anything has run, and none otherwise.
 */
class ActivityPaneComponent implements BlueComponent {
  /**
   * @param colors - the semantic color table (primary frame, muted label).
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
        return this.state.everActive ? [''] : []
      case 'waiting':
      case 'tool': {
        const frame = MOON_SPINNER_FRAMES[this.state.frame % MOON_SPINNER_FRAMES.length]!
        /* v8 ignore next -- the pool is never empty, so a moon row always carries a tip */
        const row = this.state.tip === undefined
          ? frame
          : frame + this.colors.muted(`${TIP_LEAD}${this.state.tip}`)
        // The tip rides along only while the whole row fits (the moon is
        // two cells wide — measured, never assumed); a row not even the
        // frame fits renders nothing.
        if (this.components.visibleWidth(row) <= width) return [row]
        return this.components.visibleWidth(frame) <= width ? [frame] : []
      }
      case 'composing': {
        if (width < SPINNER_LINE_WIDTH) return []
        const frame = BRAILLE_SPINNER_FRAMES[this.state.frame % BRAILLE_SPINNER_FRAMES.length]!
        return [`${this.colors.primary(frame)} ${this.colors.muted('working…')}`]
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
 * the attached session's events. The timer runs only while a spinner state
 * is live, at the frame style's interval; each tick advances the shared
 * frame counter and requests a redraw. `sync` requests a redraw only when
 * the mode or the tip actually changed. Unloading the fiber unmounts the
 * pane and stops the timer.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const screen = ctx.blueScreen
  const components = ctx.blueComponents
  const state: ActivityState = {
    mode: 'idle', frame: 0, tip: undefined, everActive: false, dialog: false,
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
        state.tip = undefined
      } else {
        state.tip = rotation[tipIndex % rotation.length]!.text
        tipIndex += 1
      }
      tipChanged = true
    }
    const spinner = kind !== undefined
    if (spinner) state.everActive = true
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
