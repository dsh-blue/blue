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
 * The phase comes from the `blueSessionFacts` bridge over the official
 * `blueConversationFacts` projection, so replay and live updates share one
 * whole value. The moon glyph is two cells wide; row width math goes through
 * the live `blueComponents.visibleWidth`.
 *
 * @module @dsh-blue/blue-transcript/pane-activity
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueUiNode } from '@dsh-blue/blue-api'
// Empty type import carries the app-owned opaque binding event merge.
import type {} from '@dsh-blue/blue-app'
import type { ConversationFacts } from '@dsh-blue/blue-conversation'
import type { SessionFactsService } from './session-facts.ts'
import { formatTokens } from './status-context.ts'
import { buildTipRotation } from './status-tips.ts'
import { STATUS_TIPS } from './tips-content.ts'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import {
  ACTIVITY_LOCALE,
  mountTranscriptLocale,
  observeTranscriptLocale,
  transcriptTranslator,
} from './locale.ts'
import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  MOON_SPINNER_FRAMES,
  MOON_SPINNER_INTERVAL_MS,
} from './spinners.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-activity'

/** Services required before the pane can mount. */
export const inject = ['bluePanes', 'blueSessionFacts']

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
  /** The live turn-flow counter riding the spinner row; '' before any data. */
  flow: string
  /** Whether a dialog panel occupies the editor slot. */
  dialog: boolean
  /** Whether the dedicated Agents pane currently owns the bottom lane. */
  agents: boolean
}

/**
 * The per-turn token-flow fold behind the spinner row (the round-5 ruling):
 * `↑` is the input side of the latest completed response's usage — the
 * context that went up; `↓` is the streamed text and reasoning this turn,
 * chars over the harness tokenMeter's fixed 4-chars/token heuristic. A
 * frozen `↓` while the spinner animates reads as waiting on the wire; a
 * climbing one reads as streaming.
 */
interface TurnFlow {
  /** Context tokens of the latest `assistant/message` usage this turn. */
  up: number | undefined
  /** Streamed text + reasoning characters this turn. */
  downChars: number
}

/** Fold one event into the turn flow. */
/** The spinner row's counter text: `↑30.2k ↓4.1k`, parts omitted at zero. */
function flowCounter(flow: TurnFlow): string {
  const down = Math.floor(flow.downChars / 4)
  const parts: string[] = []
  if (flow.up !== undefined) parts.push(`↑${formatTokens(flow.up)}`)
  if (down > 0) parts.push(`↓${formatTokens(down)}`)
  return parts.join(' ')
}

/** Build the one-row canonical activity node for the current state. */
function activityNode(state: ActivityState, t: BlueTranslate): BlueUiNode {
  if (state.mode === 'idle') return { kind: 'spacer' }
  const moon = state.mode === 'waiting' || state.mode === 'tool'
  const frame = moon
    ? MOON_SPINNER_FRAMES[state.frame % MOON_SPINNER_FRAMES.length]!
    : BRAILLE_SPINNER_FRAMES[state.frame % BRAILLE_SPINNER_FRAMES.length]!
  return {
    kind: 'rich-text',
    spans: [
      { text: frame, tone: 'accent', emphasis: 'strong' },
      ...(!moon ? [{ text: t(WORKING_LABEL) } as const] : []),
      ...(state.flow === '' ? [] : [{ text: ` ${state.flow}`, tone: 'muted' as const }]),
      { text: `${t(TIP_LEAD)}${t(state.tip)}`, tone: 'muted' },
    ],
  }
}

/** Resolve the pane mode from editor occupancy, projection activity, and Agent status. */
function activityMode(state: ActivityState, facts: ConversationFacts, statusActive: boolean): ActivityPaneMode {
  if (state.dialog || state.agents) return 'hidden'
  if (facts.active) return facts.phase
  return statusActive ? 'waiting' : 'idle'
}

/**
 * Mount the activity pane. The row reconciles against three facts: the
 * editor-slot occupancy (dialogs hide the pane), the current session's
 * admitted status (idle parks the placeholder), and the projection-backed phase. The
 * frame timer runs only while a spinner
 * state is live, at the style's interval (moon 120 ms, braille 80 ms); each
 * tick advances the shared frame counter and requests a redraw. `sync`
 * requests a redraw only when the mode or the tip actually changed.
 * Unloading the fiber unmounts the pane and stops the timer.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  mountTranscriptLocale(ctx, 'transcript.activity', ACTIVITY_LOCALE)
  const t = transcriptTranslator(ctx, 'transcript.activity')
  const state: ActivityState = {
    mode: 'idle', frame: 0, tip: '', flow: '', dialog: false, agents: false,
  }
  const factsService = ctx.get('blueSessionFacts') as SessionFactsService | undefined
  /* v8 ignore next -- blueSessionFacts is an injected service; the fallback
     keeps direct thin-host construction renderer-neutral but cannot occur in
     a Cordis activation that satisfies this plugin's contract. */
  let facts: ConversationFacts = factsService?.current ?? {
    phase: 'idle', active: false, turn: 0, flowDownChars: 0, todos: [], contextTokens: 0, agentCalls: [],
  }
  let statusActive = factsService?.currentAgent?.status === 'running'
  let timer: ReturnType<typeof setInterval> | undefined
  let timerMs = 0
  let tipKind: TipKind | undefined
  const rotation = buildTipRotation(STATUS_TIPS)
  let tipIndex = 0
  const pane = ctx.bluePanes.register({
    id: 'blue.pane.activity',
    title: 'Activity',
    placement: 'bottom',
    priority: 10,
    size: { preferred: 1, max: 1 },
    narrow: 'bottom',
    render: () => state.mode === 'hidden' || state.mode === 'thinking'
      ? null
      : activityNode(state, t),
  })

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
      pane.refresh()
    }, ms)
  }

  /** Reconcile the row (mode, tip, timer) with the pane's three facts. */
  const sync = (): void => {
    const mode = activityMode(state, facts, statusActive)
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
    const nextFlow = flowCounter({ up: facts.flowUp, downChars: facts.flowDownChars })
    const changed = mode !== state.mode || tipChanged || nextFlow !== state.flow
    state.mode = mode
    state.flow = nextFlow
    if (changed) pane.refresh()
  }

  const offFacts = factsService?.subscribe(next => {
    facts = next
    if (!next.active && next.turn > 0) statusActive = false
    sync()
  })
  const offAgent = factsService?.subscribeAgent((agent) => {
    statusActive = agent?.status === 'running'
    sync()
  })
  ctx.effect(() => () => offFacts?.())
  ctx.effect(() => () => offAgent?.())
  const offPanes = ctx.bluePanes.subscribe(entries => {
    state.agents = entries.some(entry => entry.id === 'blue.pane.agents' && !entry.hidden)
    sync()
  })
  ctx.effect(() => offPanes)
  ctx.on('blue/editor-slot-swapped', (occupied) => {
    state.dialog = occupied
    sync()
  })

  const offLocale = observeTranscriptLocale(ctx, () => {
    pane.refresh()
  })
  ctx.effect(() => offLocale)
  // Effect-bound so unloading this fiber stops the animation.
  ctx.effect(() => () => {
    stopTimer()
    pane.dispose()
  })
}
