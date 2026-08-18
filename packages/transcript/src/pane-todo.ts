/**
 * `blue-pane-todo` plugin: a bottom pane rendering the attached session's
 * todo list. The list comes from the whole-list `todo/write` snapshots
 * (last-write-wins): the durable `agent.session.events` snapshot is scanned
 * first on every attach, then the live `session/event` feed — filtered by
 * session object, as in the transcript plugin — carries the increments.
 * Collapsed, the pane renders one muted `todos N/M` line (completed over
 * total); expanded, one line per entry: `☑` muted for completed, `◐` accent
 * for in-progress, `☐` plain for pending, with the content truncated to the
 * viewport. The expansion state follows a simple default rule — every
 * incoming list containing an in-progress entry starts expanded, any other
 * list starts collapsed — and the global Ctrl-T action
 * (`blue.todo.toggle`, handler-carrying like the transcript's Ctrl-O) flips
 * it manually until the next write re-derives it. A session without any
 * `todo/write` renders zero rows, so the pane occupies nothing.
 *
 * @module @deepseek-ai/dsh-blue-transcript/pane-todo
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  BlueComponent,
  BlueComponents,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
import type { TodoItem } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@deepseek-ai/dsh-blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-todo'

/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents']

/** The global action toggling the todo panel's expansion (Ctrl-T). */
export const ACTION_TOGGLE_TODO = 'blue.todo.toggle'

/** Below this viewport width the pane renders nothing rather than overflow. */
const TODO_MIN_WIDTH = 4

/** The pane's render state, mutated by the subscriptions in `apply`. */
interface TodoState {
  /** The latest whole-list snapshot; empty until the first `todo/write`. */
  todos: readonly TodoItem[]
  /** Whether the pane renders the one-line summary instead of the list. */
  collapsed: boolean
}

/**
 * The render signature: redraws are skipped when neither the list nor the
 * layout changed since the last requested render.
 * @param state - the pane state to fingerprint.
 * @returns a string that changes exactly when the rendered rows may change.
 */
function signature(state: TodoState): string {
  const list = state.todos.map(todo => `${todo.status}:${todo.content}`).join('\n')
  return `${state.collapsed ? 'collapsed' : 'expanded'}\n${list}`
}

/**
 * The todo pane: zero rows without a list, the muted summary when collapsed,
 * one styled line per entry when expanded.
 */
class TodoPaneComponent implements BlueComponent {
  /**
   * @param colors - the semantic color table.
   * @param components - the component factory providing width truncation.
   * @param state - the shared todo/collapse state.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly state: TodoState,
  ) {}

  /**
   * @param width - current viewport width in columns.
   * @returns the summary or per-entry rows; none when there is no list.
   */
  render(width: number): string[] {
    const todos = this.state.todos
    if (todos.length === 0) return []
    if (width < TODO_MIN_WIDTH) return []
    if (this.state.collapsed) {
      const completed = todos.filter(todo => todo.status === 'completed').length
      return [this.colors.muted(this.components.truncateToWidth(`todos ${completed}/${todos.length}`, width))]
    }
    const lines: string[] = []
    for (const todo of todos) {
      const content = this.components.truncateToWidth(todo.content, width - 2)
      switch (todo.status) {
        case 'completed':
          lines.push(this.colors.muted(`☑ ${content}`))
          break
        case 'in_progress':
          lines.push(`${this.colors.accent('◐')} ${content}`)
          break
        case 'pending':
          lines.push(`☐ ${content}`)
          break
      }
    }
    return lines
  }

  /** Stateless render; nothing to drop. */
  invalidate(): void {}
}

/**
 * Mount the todo pane. Attaches to `blueSession.current` when present and
 * re-attaches on every `'blue/session-changed'` (the stale session's
 * subscription is dropped first, as in `status-context`); each attach scans
 * the snapshot for the latest `todo/write` and then subscribes the live
 * feed. Redraws are requested only when the render signature changed. Also
 * registers the global Ctrl-T action whose handler flips the collapse state
 * and forces a redraw. Unloading the fiber unmounts the pane and
 * unregisters the action.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  const state: TodoState = { todos: [], collapsed: true }
  let rendered = signature(state)
  let detach: (() => void) | undefined

  /**
   * Install a new whole-list snapshot and re-derive the default expansion:
   * a list with work in progress opens expanded, any other list collapses.
   * @param todos - the incoming list.
   */
  const update = (todos: readonly TodoItem[]): void => {
    state.todos = todos
    state.collapsed = !todos.some(todo => todo.status === 'in_progress')
    const next = signature(state)
    if (next === rendered) return
    rendered = next
    screen.requestRender()
  }

  const attach = (agent: Agent): void => {
    // Drop the previous session's subscription first: its session filter
    // matches the old session, not the new one.
    detach?.()
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
    description: 'Toggle todo panel',
    handler: () => {
      state.collapsed = !state.collapsed
      rendered = signature(state)
      screen.requestRender(true)
    },
  }]))

  const pane = new TodoPaneComponent(colors, components, state)
  // Bottom panes render in mount order; a zero-row render occupies nothing.
  ctx.effect(() => screen.addBottomChild(pane))
}
