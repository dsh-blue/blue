/**
 * `blue-pane-todo` plugin: a bottom pane rendering the attached session's
 * todo list. The list comes from the whole-list `todo/write` snapshots
 * (last-write-wins): the durable `agent.session.events` snapshot is scanned
 * first on every attach, then the live `session/event` feed — filtered by
 * session object, as in the transcript plugin — carries the increments.
 * The fold hides the `todo_write` tool calls from the stream (this pane owns
 * the presentation), so the pane is the list's only surface.
 *
 * Rendering is the kimi todo panel (S13 dogfood rulings): a flat full-width
 * `─` rule, a bold `primary` `  Todo` title, two-column-indented rows with
 * the three-state markers — `✓` success with muted strikethrough content,
 * `●` bold primary, `○` dim — and no side bars, rounded corners, or bottom
 * border (the btw panel keeps the rounded chrome). Long lists fold by the
 * kimi selector: at most {@link MAX_VISIBLE} rows show, every in-progress
 * item first, then the earliest pending and the latest completed filling the
 * rest (one slot reserved for the completed side when both exist), plus a
 * muted `… +N more (counts) · ctrl+t to expand` footer. Ctrl-T toggles to
 * the full list with an `all N items · ctrl+t to collapse` footer; the
 * expansion persists across writes (kimi `setTodos` semantics) and resets on
 * a session change or a settled list. A list whose every entry is completed
 * closes the pane automatically (the kimi session-event-handler rule).
 * A session without any `todo/write` renders zero rows, so the pane occupies
 * nothing.
 *
 * @module @dsh-blue/blue-transcript/pane-todo
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  GutterComponent,
  mountDockChild,
  type BlueComponent,
  type BlueComponents,
  type BlueSemanticColors,
} from '@dsh-blue/blue-core'
import type { TodoItem } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-todo'

/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents']

/** The global action toggling the todo panel's expansion (Ctrl-T). */
export const ACTION_TOGGLE_TODO = 'blue.todo.toggle'

/** Below this viewport width the pane renders nothing rather than overflow. */
const TODO_MIN_WIDTH = 4

/** The folded view's row cap: longer lists fold to the kimi selection. */
const MAX_VISIBLE = 5

/** Bold SGR, wrapped around the title and the in-progress marker (the ITALIC precedent). */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** Strikethrough SGR, wrapped around completed content (the kimi done treatment). */
const STRIKE_OPEN = '\x1b[9m'
const STRIKE_CLOSE = '\x1b[29m'

/** The folded view's answer: the rows that show and what the footer counts. */
export interface VisibleTodos {
  /** The selected rows, in their original list order. */
  readonly rows: readonly TodoItem[]
  /** How many entries the fold hides. */
  readonly hidden: number
  /** The hidden entries counted by status (the footer's distribution). */
  readonly hiddenCounts: Record<TodoItem['status'], number>
}

/**
 * Pick which todos render when the list exceeds {@link MAX_VISIBLE} (the
 * kimi selector, `completed` where kimi says `done`). The selector is
 * order-agnostic — the model keeps whatever order it produced, so an
 * interleaved sequence like `pending, completed, pending, …` must still
 * yield MAX_VISIBLE rows when enough exist.
 *
 * Strategy:
 * 1. Include every `in_progress` item (capped at MAX_VISIBLE).
 * 2. Fill remaining slots with "what's next" — the earliest `pending` items
 *    in their original positions — while reserving one slot for "what just
 *    finished" — the latest `completed` item — when both kinds exist. If one
 *    side has too few candidates, the other expands.
 *
 * @param todos - the whole list.
 * @returns the selected rows and the hidden count per status.
 */
export function selectVisibleTodos(todos: readonly TodoItem[]): VisibleTodos {
  if (todos.length <= MAX_VISIBLE) {
    return {
      rows: [...todos],
      hidden: 0,
      hiddenCounts: { completed: 0, in_progress: 0, pending: 0 },
    }
  }

  const inProgress: number[] = []
  const pending: number[] = []
  const completed: number[] = []
  for (const [index, todo] of todos.entries()) {
    if (todo.status === 'in_progress') inProgress.push(index)
    else if (todo.status === 'pending') pending.push(index)
    else completed.push(index)
  }

  const picked = new Set<number>()
  for (const index of inProgress.slice(0, MAX_VISIBLE)) picked.add(index)

  if (picked.size < MAX_VISIBLE) {
    // Most recent completed first; earliest pending first.
    const doneCandidates = completed.toReversed()
    const pendingCandidates = pending

    const remaining = MAX_VISIBLE - picked.size
    let doneCount: number
    let pendingCount: number
    if (doneCandidates.length === 0) {
      doneCount = 0
      pendingCount = Math.min(remaining, pendingCandidates.length)
    } else if (pendingCandidates.length === 0) {
      pendingCount = 0
      doneCount = Math.min(remaining, doneCandidates.length)
    } else {
      doneCount = 1
      pendingCount = Math.min(remaining - 1, pendingCandidates.length)
      if (pendingCount < remaining - 1) {
        doneCount = Math.min(doneCandidates.length, remaining - pendingCount)
      }
    }

    for (let index = 0; index < doneCount; index += 1) picked.add(doneCandidates[index] as number)
    for (let index = 0; index < pendingCount; index += 1) picked.add(pendingCandidates[index] as number)
  }

  const sortedIdx = [...picked].toSorted((a, b) => a - b)

  const hiddenCounts: Record<TodoItem['status'], number> = { completed: 0, in_progress: 0, pending: 0 }
  for (const [index, todo] of todos.entries()) {
    if (!picked.has(index)) {
      hiddenCounts[todo.status] += 1
    }
  }

  return {
    rows: sortedIdx.map(index => todos[index] as TodoItem),
    hidden: todos.length - sortedIdx.length,
    hiddenCounts,
  }
}

/** The footer's label per status, in display order (kimi's wording). */
const STATUS_LABELS: readonly { status: TodoItem['status'], label: string }[] = [
  { status: 'completed', label: 'done' },
  { status: 'in_progress', label: 'in progress' },
  { status: 'pending', label: 'pending' },
]

/**
 * Render the hidden-count distribution as `2 done · 1 pending`, empty when
 * nothing is hidden.
 * @param counts - the hidden entries counted by status.
 * @returns the parenthesized footer segment without the parentheses.
 */
export function formatHiddenCounts(counts: Record<TodoItem['status'], number>): string {
  return STATUS_LABELS
    .filter(({ status }) => counts[status] > 0)
    .map(({ status, label }) => `${counts[status]} ${label}`)
    .join(' · ')
}

/**
 * One content row: two-column indent, the status marker, the styled content
 * (pre-truncated so the composed row fits the viewport without clipping
 * through the painted SGR).
 * @param todo - the entry to render.
 * @param colors - the semantic color table.
 * @param components - the component factory providing width truncation.
 * @param width - current viewport width in columns.
 * @returns the composed row, at most `width` visible columns.
 */
function renderRow(
  todo: TodoItem,
  colors: BlueSemanticColors,
  components: BlueComponents,
  width: number,
): string {
  // Two indent columns, the marker, one gap: the content budget.
  const content = components.truncateToWidth(todo.content, Math.max(0, width - 4))
  switch (todo.status) {
    case 'completed':
      // `✓` success marker, content muted with strikethrough (the kimi
      // done treatment).
      return `  ${colors.success('✓')} ${colors.muted(`${STRIKE_OPEN}${content}${STRIKE_CLOSE}`)}`
    case 'in_progress':
      // `●` bold primary marker, content plain.
      return `  ${colors.primary(`${BOLD_OPEN}●${BOLD_CLOSE}`)} ${content}`
    case 'pending':
      // `○` dim marker, content plain.
      return `  ${colors.textMuted('○')} ${content}`
  }
}

/** The pane's render state, mutated by the subscriptions in `apply`. */
interface TodoState {
  /** The latest whole-list snapshot; empty until the first `todo/write`. */
  todos: readonly TodoItem[]
  /** Whether the pane renders the full list instead of the folded selection. */
  expanded: boolean
}

/**
 * The render signature: redraws are skipped when neither the list nor the
 * layout changed since the last requested render.
 * @param state - the pane state to fingerprint.
 * @returns a string that changes exactly when the rendered rows may change.
 */
function signature(state: TodoState): string {
  const list = state.todos.map(todo => `${todo.status}:${todo.content}`).join('\n')
  return `${state.expanded ? 'expanded' : 'folded'}\n${list}`
}

/**
 * The todo pane: zero rows without a list, the folded selection with its
 * footer by default, the full list with its footer when expanded.
 */
class TodoPaneComponent implements BlueComponent {
  /**
   * @param colors - the semantic color table.
   * @param components - the component factory providing width truncation.
   * @param state - the shared todo/expansion state.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly state: TodoState,
  ) {}

  /**
   * @param width - current viewport width in columns.
   * @returns the frame — rule, title, rows, and the fold footer — truncated
   *   to the viewport; none when there is no list.
   */
  render(width: number): string[] {
    const todos = this.state.todos
    if (todos.length === 0) return []
    if (width < TODO_MIN_WIDTH) return []
    const lines = [
      this.colors.border('─'.repeat(width)),
      this.colors.primary(`${BOLD_OPEN}  Todo${BOLD_CLOSE}`),
    ]
    if (this.state.expanded) {
      for (const todo of todos) lines.push(renderRow(todo, this.colors, this.components, width))
      if (todos.length > MAX_VISIBLE) {
        const footer = `  all ${todos.length} items · ctrl+t to collapse`
        lines.push(this.colors.muted(this.components.truncateToWidth(footer, width)))
      }
    } else {
      const { rows, hidden, hiddenCounts } = selectVisibleTodos(todos)
      for (const todo of rows) lines.push(renderRow(todo, this.colors, this.components, width))
      if (hidden > 0) {
        // hidden > 0 guarantees a non-empty distribution (every hidden
        // entry counts toward some status), so the suffix is unconditional.
        const footer = `  … +${hidden} more (${formatHiddenCounts(hiddenCounts)}) · ctrl+t to expand`
        lines.push(this.colors.muted(this.components.truncateToWidth(footer, width)))
      }
    }
    return lines.map(line => this.components.truncateToWidth(line, width))
  }

  /** Stateless render; nothing to drop. */
  invalidate(): void {}
}

/**
 * Mount the todo pane. Attaches to `blueSession.current` when present and
 * re-attaches on every `'blue/session-changed'` (the stale session's
 * subscription is dropped first, as in `status-context`); each attach scans
 * the snapshot for the latest `todo/write` and then subscribes the live
 * feed. A settled list (every entry completed) closes the pane and resets
 * the expansion; the expansion otherwise persists across writes (kimi
 * `setTodos` semantics). Redraws are requested only when the render
 * signature changed. Also registers the global Ctrl-T action whose handler
 * flips the expansion and forces a redraw. Unloading the fiber unmounts the
 * pane and unregisters the action.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  const state: TodoState = { todos: [], expanded: false }
  let rendered = signature(state)
  let detach: (() => void) | undefined

  /**
   * Install a new whole-list snapshot. A list whose every entry completed
   * has nothing left to track: close the pane and reset the expansion (the
   * kimi session-event-handler rule, applied to snapshot and live writes
   * alike). The expansion otherwise persists — a mid-run list rewrites every
   * few steps, and re-folding under an explicit expand would fight the user.
   * @param todos - the incoming list.
   */
  const update = (todos: readonly TodoItem[]): void => {
    const settled = todos.length > 0 && todos.every(todo => todo.status === 'completed')
    state.todos = settled ? [] : todos
    if (settled) state.expanded = false
    const next = signature(state)
    if (next === rendered) return
    rendered = next
    screen.requestRender()
  }

  const attach = (agent: Agent): void => {
    // Drop the previous session's subscription first: its session filter
    // matches the old session, not the new one.
    detach?.()
    // A new session starts from the folded default (kimi clears the panel).
    state.expanded = false
    // Snapshot first, last write wins; the subscription then carries newer
    // writes. Both happen in one synchronous turn, so no committed write can
    // fall between them.
    let latest: readonly TodoItem[] = []
    for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = agent.session.events[index]!
      if (event.type === 'todo/write') {
        latest = event.data.todos
        break
      }
    }
    detach = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type !== 'todo/write') return
      update(event.data.todos)
    })
    update(latest)
  }

  const current = ctx.get('blueSession')?.current
  if (current) attach(current)
  ctx.on('blue/session-changed', attach)

  // Effect-bound so unloading this fiber unregisters the action.
  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_TOGGLE_TODO,
    keys: 'ctrl+t',
    description: 'Toggle todo list expansion',
    handler: () => {
      state.expanded = !state.expanded
      rendered = signature(state)
      screen.requestRender(true)
    },
  }]))

  const pane = new TodoPaneComponent(colors, components, state)
  // Bottom panes render in mount order; a zero-row render occupies nothing.
  ctx.effect(() => mountDockChild(screen, new GutterComponent(pane), {
    priority: 60,
    minRows: 0,
    preferredRows: MAX_VISIBLE + 3,
  }))
}
