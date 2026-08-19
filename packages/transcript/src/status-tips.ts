/**
 * `blue-status-tips` plugin: the footer's rotating teaching tip — up to two
 * tips joined by ` | ` when the width allows, otherwise the one that fits —
 * right-aligned on band 1 in `textMuted` (priority 30), the kimi footer's
 * faintest tier. The rotation sequence expands the {@link STATUS_TIPS} pool
 * with smooth weighted round-robin (the nginx SWRR algorithm, as kimi-code:
 * higher-`priority` tips appear more often while staying evenly spread), and
 * `solo` tips never pair — neither as the pairing initiator nor as a
 * neighbour — and a tip never pairs with its own duplicate at the wrap
 * boundary. kimi advances its index from the wall clock and leans on
 * unrelated redraws to refresh; Blue's renders are strictly event-driven,
 * so this plugin runs an explicit 10 s ticker that advances the index and
 * requests a redraw — the ticker lives for the fiber's whole life (tips are
 * session-independent chrome) behind a module-level replaceable holder (the
 * `pane-activity` timers precedent) so tests inject fakes. A `/theme`
 * reload restarts the ticker with the index back at zero, the same accepted
 * reset as the activity pane's frame. Under width pressure the entry yields
 * like any other: the left cluster keeps its budget and the tip is dropped
 * for the frame.
 *
 * @module @deepseek-ai/dsh-blue-transcript/status-tips
 */

import type { Context } from '@deepseek-ai/cordis'
// The named import also carries this package's `blueStatus` Context merge.
import type { BlueStatusEntry } from './types.ts'
import { STATUS_TIPS, type StatusTip } from './tips-content.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-tips'

/** Services required before the tips entry can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme']

/** Tip rotation interval in milliseconds. */
export const TIPS_ROTATE_INTERVAL_MS = 10_000

/** The joiner between two paired tips. */
const TIP_SEPARATOR = ' | '

/** The timer primitives behind the rotation; replaceable in tests. */
export interface TipsTimers {
  /** Start a repeating callback; mirrors the global `setInterval`. */
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  /** Stop a repeating callback; mirrors the global `clearInterval`. */
  clearInterval: (handle: ReturnType<typeof setInterval>) => void
}

/** The process timer primitives. */
const defaultTipsTimers: TipsTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: handle => clearInterval(handle),
}

let tipsTimers: TipsTimers = defaultTipsTimers

/**
 * Replace the rotation timers (tests inject fakes here).
 * @param timers - the replacement, or `undefined` to restore the defaults.
 */
export function setTipsTimers(timers: TipsTimers | undefined): void {
  tipsTimers = timers ?? defaultTipsTimers
}

/**
 * Expand tips into a rotation sequence with smooth weighted round-robin
 * (the nginx algorithm, as kimi-code): each tip's `priority` (clamped to at
 * least 1) is its weight, and one pass of `total` picks spreads the weight
 * while keeping neighbours apart. All-equal weights degenerate to the
 * identity sequence. Deterministic, so it is built once per apply and can
 * be asserted directly.
 * @param tips - the rotation pool.
 * @returns the expanded rotation, one tip per slot.
 */
export function buildTipRotation(tips: readonly StatusTip[]): readonly StatusTip[] {
  const items = tips.map(tip => ({
    tip,
    weight: Math.max(1, Math.trunc(tip.priority ?? 1)),
    current: 0,
  }))
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  const sequence: StatusTip[] = []
  for (let pick = 0; pick < total; pick += 1) {
    let best = items[0]!
    for (const item of items) {
      item.current += item.weight
      if (item.current > best.current) best = item
    }
    best.current -= total
    sequence.push(best.tip)
  }
  return sequence
}

/**
 * The tip offer for one rotation index: `primary` is always the slot's tip;
 * `pair` offers primary plus the next slot's tip joined by the separator for
 * wide clusters. Pairing is skipped when either tip is `solo` or when the
 * neighbour is a duplicate of the current tip (possible at the wrap
 * boundary), keeping long tips on their own and avoiding `X | X`.
 * @param rotation - the expanded rotation.
 * @param index - the rotation index (wrapped, negative indexes allowed).
 * @returns the offer; empty strings over an empty pool.
 */
export function tipOffer(
  rotation: readonly StatusTip[],
  index: number,
): { primary: string, pair: string | null } {
  const length = rotation.length
  if (length === 0) return { primary: '', pair: null }
  const offset = ((index % length) + length) % length
  const current = rotation[offset]!
  if (length === 1 || current.solo) return { primary: current.text, pair: null }
  const next = rotation[(offset + 1) % length]!
  if (next.solo || next.text === current.text) return { primary: current.text, pair: null }
  return { primary: current.text, pair: current.text + TIP_SEPARATOR + next.text }
}

/**
 * Register the tips entry and start the rotation ticker.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const screen = ctx.blueScreen
  const rotation = buildTipRotation(STATUS_TIPS)
  let index = 0

  const handle = tipsTimers.setInterval(() => {
    index += 1
    screen.requestRender()
  }, TIPS_ROTATE_INTERVAL_MS)
  ctx.effect(() => () => tipsTimers.clearInterval(handle))

  const entry: BlueStatusEntry = {
    id: 'blue.status.tips',
    priority: 30,
    align: 'right',
    render(width: number): string {
      const offer = tipOffer(rotation, index)
      // The pair when it fits, else the single tip, else nothing: width is
      // the final arbiter.
      const text = offer.pair !== null && offer.pair.length <= width
        ? offer.pair
        : offer.primary.length <= width
          ? offer.primary
          : ''
      if (text === '') return ''
      return colors.textMuted(text)
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
