/**
 * The footer's rotating teaching tips — the content module the
 * `blue-status-tips` entry rotates through (and the S16 welcome banner's
 * right column reuses). Every tip is ASCII-only so width math never sees a
 * double-width surprise, describes a feature Blue actually ships, and may
 * carry a `solo` flag (renders alone, never pairs) and a `priority` weight
 * (recurs more often in the rotation).
 *
 * @module @deepseek-ai/dsh-blue-transcript/tips-content
 */

/** One rotatable teaching tip. */
export interface StatusTip {
  /** The tip's display text (ASCII-only). */
  readonly text: string
  /**
   * Long or important tips render on their own: they never pair with a
   * neighbour and never appear as the second half of someone else's pair.
   */
  readonly solo?: boolean
  /**
   * Rotation weight: a higher value makes the tip recur more often.
   * Defaults to 1.
   */
  readonly priority?: number
}

/** The rotation pool. */
export const STATUS_TIPS: readonly StatusTip[] = [
  { text: '/help: show commands' },
  { text: '/sessions to browse and resume earlier sessions' },
  { text: '/fork to branch the conversation and explore safely' },
  { text: '/btw <question>: ask a side question without disturbing the run', solo: true },
  { text: '/theme to switch the terminal UI theme' },
  { text: '! to run a shell command', priority: 2 },
  { text: '@: mention files', priority: 2 },
  { text: 'ctrl+v to paste an image' },
  { text: 'ctrl+o to hide or reveal tool output' },
  { text: 'ctrl+t to show the todo list' },
  { text: 'ctrl+s to steer while a turn is running', solo: true, priority: 2 },
  { text: 'esc to interrupt the agent' },
  { text: 'type / to browse commands; matching is fuzzy', solo: true },
]
