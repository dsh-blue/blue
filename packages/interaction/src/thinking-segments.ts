/**
 * The shared thinking-effort segment chrome — the kimi horizontal segments
 * (`[ Low ]  High  Max`) used both by the `/model` panel's footer control
 * and by the `/effort` panel. Pure rendering and cursor math over styled
 * strings; the owning components keep the state and dispatch the keys.
 *
 * @module @dsh-blue/blue-interaction/thinking-segments
 */

import type { BlueTheme } from '@dsh-blue/blue-core'

/** One selectable segment. */
export interface ThinkingSegment {
  /** The committed value the segment stands for (an effort id, or `default`). */
  readonly id: string
  /** The rendered label. */
  readonly label: string
}

/** Bold SGR pair composed around the palette color, the kimi `boldFg` shape. */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/**
 * Step a segment cursor one position with wraparound.
 * @param index - the current segment index.
 * @param count - the number of segments.
 * @param direction - `-1` for left, `1` for right.
 * @returns the next segment index, wrapping at both ends; `index` when `count` is zero.
 */
export function cycleSegment(index: number, count: number, direction: -1 | 1): number {
  if (count === 0) return index
  return (index + direction + count) % count
}

/**
 * Render one segment row in the kimi shape: the active segment as
 * `bold primary [ Label ]`, the rest as plain-text `  Label  ` cells joined
 * by a single space. Callers that need a wider gap concatenate the row into
 * their own layout.
 * @param segments - the segments to render, in order.
 * @param activeIndex - the active segment's index, or `-1` when none is selectable.
 * @param theme - theme supplying the active and plain colors.
 * @returns the styled single-row segment line.
 */
export function renderSegments(
  segments: readonly ThinkingSegment[],
  activeIndex: number,
  theme: BlueTheme,
): string {
  const cells = segments.map((segment, index) => {
    const active = index === activeIndex
    const label = active ? `[ ${segment.label} ]` : `  ${segment.label}  `
    const painted = active
      ? `${BOLD_OPEN}${theme.colors.primary(label)}${BOLD_CLOSE}`
      : theme.colors.text(label)
    return index === 0 ? painted : ` ${painted}`
  })
  return cells.join('')
}

/** The dim label above a segment row: the kimi `Thinking  (←→ to switch)` caption. */
export const SEGMENT_CAPTION = 'Thinking  (←→ to switch)'

/** The dim placeholder when the highlighted model exposes no reasoning efforts. */
export const SEGMENT_UNSUPPORTED = 'Off (Unsupported)'
