/**
 * `blue-pane-todo` plugin: a bottom pane rendering the attached session's
 * todo list. The list comes from the replay/live whole value exposed by
 * `blueSessionFacts`, backed by the official `blueConversationFacts`
 * projection. The conversation projection routes `todo_write` calls away
 * from transcript presentation, so this pane is the list's only surface.
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
 * nothing. A dialog taking the editor slot also hides the pane temporarily,
 * preserving its todo snapshot and expansion choice until the editor returns.
 *
 * @module @dsh-blue/blue-transcript/pane-todo
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueInlineSpan, BlueUiNode } from '@dsh-blue/blue-api'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import type { ConversationFacts } from '@dsh-blue/blue-conversation'
import type { SessionFactsService } from './session-facts.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-todo'

/** Services required before the pane can mount. */
export const inject = ['bluePanes', 'blueKeymap', 'blueSessionFacts']

/** The global action toggling the todo panel's expansion (Ctrl-T). */
export const ACTION_TOGGLE_TODO = 'blue.todo.toggle'

/** The folded view's row cap: longer lists fold to the kimi selection. */
const MAX_VISIBLE = 5

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

/** Build semantic spans for one todo row. */
function todoSpans(todo: TodoItem): readonly BlueInlineSpan[] {
  switch (todo.status) {
    case 'completed':
      return [{ text: '  ✓ ', tone: 'success' }, { text: todo.content, tone: 'muted' }]
    case 'in_progress':
      return [{ text: '  ● ', tone: 'accent', emphasis: 'strong' }, { text: todo.content }]
    case 'pending':
      return [{ text: '  ○ ', tone: 'muted' }, { text: todo.content }]
  }
}

/** The pane's render state, mutated by the subscriptions in `apply`. */
interface TodoState {
  /** The latest whole-list snapshot; empty until the first `todo/write`. */
  todos: readonly TodoItem[]
  /** Whether the pane renders the full list instead of the folded selection. */
  expanded: boolean
  /** Whether a dialog temporarily occupies the editor slot. */
  dialog: boolean
}

/**
 * The render signature: redraws are skipped when neither the list nor the
 * layout changed since the last requested render.
 * @param state - the pane state to fingerprint.
 * @returns a string that changes exactly when the rendered rows may change.
 */
function signature(state: TodoState): string {
  const list = state.todos.map(todo => `${todo.status}:${todo.content}`).join('\n')
  return `${state.dialog ? 'dialog' : 'visible'}\n${state.expanded ? 'expanded' : 'folded'}\n${list}`
}

/** Build the canonical todo tree; the core compiler owns paint and width. */
function todoNode(state: TodoState): BlueUiNode {
  const children: { readonly node: BlueUiNode }[] = [
    { node: { kind: 'divider' } },
    { node: { kind: 'rich-text', spans: [{ text: '  Todo', tone: 'accent', emphasis: 'strong' }] } },
  ]
  if (state.expanded) {
    for (const todo of state.todos) children.push({ node: { kind: 'rich-text', spans: todoSpans(todo) } })
    if (state.todos.length > MAX_VISIBLE) {
      children.push({ node: { kind: 'text', content: `  all ${state.todos.length} items · ctrl+t to collapse`, tone: 'muted' } })
    }
  } else {
    const { rows, hidden, hiddenCounts } = selectVisibleTodos(state.todos)
    for (const todo of rows) children.push({ node: { kind: 'rich-text', spans: todoSpans(todo) } })
    if (hidden > 0) {
      children.push({ node: { kind: 'text', content: `  … +${hidden} more (${formatHiddenCounts(hiddenCounts)}) · ctrl+t to expand`, tone: 'muted' } })
    }
  }
  return { kind: 'stack', direction: 'column', gap: 0, children }
}

/**
 * Mount the todo pane over the current projection-backed facts. A current
 * session identity change clears the previous list and expansion before the
 * new whole-value facts arrive. A settled list (every entry completed) closes the pane and resets
 * the expansion; the expansion otherwise persists across writes (kimi
 * `setTodos` semantics). Redraws are requested only when the render
 * signature changed. Also registers the global Ctrl-T action whose handler
 * flips the expansion and forces a redraw. Unloading the fiber unmounts the
 * pane and unregisters the action. An editor-slot dialog suppresses rendering
 * without detaching the session feed or resetting expansion.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const state: TodoState = { todos: [], expanded: false, dialog: false }
  let rendered = signature(state)
  const pane = ctx.bluePanes.register({
    id: 'blue.pane.todo',
    title: 'Todo',
    placement: 'bottom',
    priority: 30,
    narrow: 'bottom',
    render: () => state.dialog || state.todos.length === 0 ? null : todoNode(state),
  })

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
    pane.refresh()
  }

  const facts = ctx.get('blueSessionFacts') as SessionFactsService | undefined
  let sessionId = facts?.currentAgent?.id
  const offAgent = facts?.subscribeAgent((agent) => {
    if (agent?.id === sessionId) return
    sessionId = agent?.id
    state.expanded = false
    update([])
  })
  const offFacts = facts?.subscribe((next: ConversationFacts) => update(next.todos))
  ctx.effect(() => () => offAgent?.())
  ctx.effect(() => () => offFacts?.())
  ctx.on('blue/editor-slot-swapped', (occupied) => {
    if (state.dialog === occupied) return
    state.dialog = occupied
    rendered = signature(state)
    pane.refresh()
  })

  // Effect-bound so unloading this fiber unregisters the action.
  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_TOGGLE_TODO,
    keys: 'ctrl+t',
    description: 'Toggle todo list expansion',
    handler: () => {
      state.expanded = !state.expanded
      rendered = signature(state)
      pane.refresh()
    },
  }]))

  ctx.effect(() => () => pane.dispose())
}
