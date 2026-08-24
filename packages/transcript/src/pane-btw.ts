/**
 * `blue-pane-btw` plugin: a side-question bottom pane plus the `/btw`
 * command that drives it. `/btw <question>` forks the live session into a
 * throwaway side agent — `agents.create` with the full event log as seed,
 * the parent's model route as `agentOptions`, and the fork-lineage meta
 * (cwd, `parentSession`, `seedLength`), the same construction as the app
 * driver's fork switch — posts the question as a
 * follow-up, and renders the exchange in the pane. The pane is the kimi
 * btw-panel port (single-turn): a rounded top border with the in-border
 * title ` BTW ─ Esc close · ↑↓ scroll `, the question line in `roleUser`
 * (`› question`), the answer rendered through the Markdown component as it
 * streams, a muted `thinking…` row until the side agent returns to idle,
 * and a tail-following body fitted to `max(3, floor(rows/3)) - 1` rows with
 * manual ↑/↓ scrolling — the kimi `fitBodyLines` mechanics (min-body-height
 * ratchet, tail-follow reset on manual scroll, per-question scroll reset).
 * The pane fills the same full-width frame as the input editor, whose top
 * corners splice to `├┤` while the pane is open: the pane emits
 * `'blue/editor-connected-above'` (true on open, false on dismiss or
 * unload) and `blue-input` mirrors it onto the editor. While a dialog
 * panel occupies the editor slot the splice claim would point at an
 * off-tree editor, so the pane drops it for the panel's lifetime and
 * re-asserts it on `'blue/editor-slot-swapped'` when the editor returns.
 * The pane is a passive bottom child — it renders zero rows while closed
 * and never consumes keyboard input — so closing and scrolling live in
 * `blue-input`'s editor key chain, which routes Esc and ↑/↓ through the
 * `'blue/btw-command'` event while the splice is connected (the keymap
 * claims `escape`/`up`/`down` for the list surfaces, so the pane cannot
 * register its own keys).
 *
 * `/btw` without input dismisses the panel and disposes the side agent; a
 * new question while one is open disposes the previous side agent first
 * (single slot). Creation is async and the fiber may unload mid-flight
 * (theme swap): an `unloaded` flag armed by an effect disposer makes the
 * continuation dispose the fresh handle instead of publishing it, and
 * unloading also disposes the live slot.
 *
 * @module @dsh-blue/blue-transcript/pane-btw
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {
  BlueComponent,
  BlueComponents,
  BlueMarkdown,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import { clampRowsToWidth, padColumns, topRule } from '@dsh-blue/blue-core/chrome'
// The named import also carries the `commands` Context merge.
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge this
// plugin reads through `ctx.get` (never `inject`, as the app plugin may
// activate after this one).
import type {} from '@dsh-blue/blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-btw'

/** Services required before the pane and command can register. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'commands', 'agents']

/** The pane never renders shorter than this panel height (kimi value). */
const BTW_MIN_PANEL_LINES = 3

/** Below this viewport width the pane renders nothing rather than overflow. */
const BTW_MIN_WIDTH = 4

/** Bold SGR, wrapped around in-border titles (the ITALIC precedent). */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** One question/answer exchange inside the pane. */
interface BtwTurn {
  /** The question that started this exchange. */
  question: string
  /** The accumulated (then finalized) side reply text. */
  reply: string
  /** Whether the side agent has yet to return to idle for this turn. */
  thinking: boolean
  /** A terminal side-agent failure, if this turn ended unsuccessfully. */
  error?: string
}

/** The pane's render state, mutated by the command handler and subscriptions. */
interface BtwState {
  /** Whether an exchange is open; a closed pane renders zero rows. */
  open: boolean
  /** The exchanges so far; continuation turns append to the same slot. */
  turns: BtwTurn[]
  /** Height ratchet: the panel never shrinks while open (kimi port). */
  minBodyLines: number
  /** Tail-follow: new content pins the viewport to the bottom until the user scrolls up. */
  followTail: boolean
  /** Current body scroll offset; 0 with nothing above the viewport. */
  scrollTop: number
  /** The largest offset the current body can scroll to. */
  maxScrollTop: number
}

/** The live side agent plus its subscription unbinder. */
interface BtwSlot {
  handle: AgentHandle
  unbind: () => void
}

/**
 * The joined text of one assistant message's text blocks (reasoning and
 * other block kinds do not render in the pane).
 * @param message - the finalized assistant message.
 * @returns the concatenated text.
 */
function messageText(message: AssistantMessage): string {
  let text = ''
  for (const block of message.content) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/**
 * Keep only a balanced, completed-turn prefix for a side-session seed. The
 * command runtime records `command/run` before invoking `/btw`, and the main
 * agent may still be inside a turn, so blindly copying `session.events` can
 * seed an open turn or a half-paired command lifecycle.
 * @param events - the parent's current immutable event snapshot.
 * @returns a contiguous prefix that ends at the latest closed turn boundary.
 */
function stableSeed(events: readonly SessionEvent[]): readonly SessionEvent[] {
  let lastBoundary = -1
  let lastBoundaryType: SessionEvent['type'] | undefined
  for (const [index, event] of events.entries()) {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      lastBoundary = index
      lastBoundaryType = event.type
    }
  }
  if (lastBoundaryType === 'turn/start') return events.slice(0, lastBoundary)
  if (lastBoundary >= 0) return events.slice(0, lastBoundary + 1)
  // A brand-new session may have context events but no turn boundary yet.
  // Preserve those, while excluding a command/run that the command runtime
  // has appended immediately before entering this handler.
  const lastCommand = events.findLastIndex(event => event.type === 'command/run' || event.type === 'command/done')
  if (lastCommand >= 0 && events[lastCommand]?.type === 'command/run') return events.slice(0, lastCommand)
  return events
}

/** Extract a useful message from a harness turn-end failure payload. */
function turnError(reason: { error?: unknown }): string {
  const value = reason
  if (typeof value.error === 'object' && value.error !== null) {
    const error = value.error as { message?: unknown, code?: unknown }
    if (typeof error.message === 'string') return error.message
    if (typeof error.code === 'string') return error.code
  }
  return 'the side session ended with an error'
}

/** Structural view of the optional preset roster; avoids a runtime dependency. */
interface AgentPresetRoster {
  mount(agentCtx: Context, preset?: string): Promise<void> | void
}

/** Resolve the preset selected by the parent session's durable history. */
function sessionPreset(agent: AgentHandle['agent']): string | undefined {
  const header = agent.session.header as { agentPreset?: string }
  let preset = header.agentPreset
  for (const event of agent.session.events) {
    const candidate = event as unknown as { type: string, data?: { agentPreset?: string } }
    if (candidate.type === 'agent-preset/selected') preset = candidate.data?.agentPreset
  }
  return preset
}

/**
 * The side-question pane: the kimi btw-panel port — a `topRule` border with
 * the in-border title and hint, the question line, the Markdown-rendered
 * reply, and a `thinking…` row, fitted to a row budget from the terminal
 * height with tail-follow scrolling. Closed renders zero rows.
 */
class BtwPaneComponent implements BlueComponent {
  private readonly rows: () => number
  private readonly markdown: BlueMarkdown

  /**
   * @param colors - the semantic color table.
   * @param components - the component factory (Markdown + width truncation).
   * @param state - the shared exchange state.
   * @param rows - the live terminal height, read at every render so a
   *   terminal resize re-fits the panel.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly state: BtwState,
    rows: () => number,
  ) {
    this.rows = rows
    this.markdown = this.components.createMarkdown({ text: '' })
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Scroll the body by one row; returns whether the pane moved (kimi
   * semantics — a scroll call with nothing to scroll is a no-op).
   * @param direction - the scroll direction.
   * @returns whether the viewport moved.
   */
  scroll(direction: 'up' | 'down'): boolean {
    if (this.state.maxScrollTop <= 0) return false
    const current = this.state.followTail ? this.state.maxScrollTop : this.state.scrollTop
    const next = direction === 'up'
      ? Math.max(0, current - 1)
      : Math.min(this.state.maxScrollTop, current + 1)
    this.state.scrollTop = next
    this.state.followTail = next === this.state.maxScrollTop
    return true
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the framed exchange rows; none while closed.
   */
  render(width: number): string[] {
    if (!this.state.open) return []
    if (width < BTW_MIN_WIDTH) return []
    const safeWidth = Math.max(4, width)
    const contentWidth = Math.max(1, safeWidth - 4)
    const body = this.fitBodyLines(this.renderBody(contentWidth))
    const lines = [topRule(safeWidth, {
      title: this.colors.primary(`${BOLD_OPEN} BTW ${BOLD_CLOSE}`),
      hint: this.colors.textMuted(body.truncated ? 'Esc close · ↑↓ scroll ' : 'Esc close '),
      paint: this.colors.border,
    })]
    for (const line of body.lines) {
      lines.push(this.renderBodyLine(line, contentWidth))
    }
    return lines
  }

  /**
   * Render the exchange rows — each turn's question and Markdown reply, plus
   * a thinking row while the current turn is still running — at the content
   * width.
   * @param width - the content width (viewport minus the border columns).
   * @returns the unfitted body rows.
   */
  private renderBody(width: number): string[] {
    const lines: string[] = []
    const turns = this.state.turns
    for (const [index, turn] of turns.entries()) {
      if (index > 0) lines.push('')
      lines.push(this.colors.roleUser(this.components.truncateToWidth(`› ${turn.question}`, width)))
      if (turn.reply !== '') {
        this.markdown.setText(turn.reply)
        lines.push(...this.markdown.render(width))
      }
      if (turn.error !== undefined) lines.push(this.colors.error(`error: ${turn.error}`))
      else if (turn.thinking) lines.push(this.colors.muted('thinking…'))
    }
    return lines
  }

  /**
   * Fit the body to the row budget (kimi port): the panel never shrinks
   * below its high-water mark, overflow pins to the tail until the user
   * scrolls up, and short bodies pad with blank rows to the target.
   * @param lines - the unfitted body rows.
   * @returns the fitted rows plus whether the body overflowed.
   */
  private fitBodyLines(lines: string[]): { lines: string[], truncated: boolean } {
    const bodyLimit = this.bodyLimit()
    const targetUncapped = Math.max(this.state.minBodyLines, lines.length)
    const target = bodyLimit === undefined ? targetUncapped : Math.min(bodyLimit, targetUncapped)
    this.state.minBodyLines = Math.max(this.state.minBodyLines, target)

    if (lines.length > target) {
      this.state.maxScrollTop = lines.length - target
      if (this.state.followTail) {
        this.state.scrollTop = this.state.maxScrollTop
      } else {
        this.state.scrollTop = Math.min(this.state.scrollTop, this.state.maxScrollTop)
      }
      const start = this.state.scrollTop
      return { lines: lines.slice(start, start + target), truncated: true }
    }

    this.state.followTail = true
    this.state.scrollTop = 0
    this.state.maxScrollTop = 0
    const padded = [...lines]
    while (padded.length < target) {
      padded.push('')
    }
    return { lines: padded, truncated: false }
  }

  /**
   * The body row budget: `max(3, floor(rows/3)) - 1`, uncapped when the
   * terminal height is unknown (kimi's guard).
   * @returns the budget, or `undefined` when rows are unknown.
   */
  private bodyLimit(): number | undefined {
    const terminalRows = this.rows()
    if (!Number.isFinite(terminalRows) || terminalRows <= 0) return undefined
    const maxPanelLines = Math.max(BTW_MIN_PANEL_LINES, Math.floor(terminalRows / 3))
    return Math.max(1, maxPanelLines - 1)
  }

  /**
   * Frame one body row with the border columns: `│` + gap + content +
   * gap + `│` (kimi's row shape, ANSI-safe truncation).
   * @param line - the fitted content row.
   * @param width - the content width.
   * @returns the bordered row.
   */
  private renderBodyLine(line: string, width: number): string {
    const clipped = this.components.truncateToWidth(line, width, '…')
    const padding = Math.max(0, width - this.components.visibleWidth(clipped))
    return this.colors.border('│') + ' ' + clipped + ' '.repeat(padding) + ' ' + this.colors.border('│')
  }
}

/**
 * Inset the connected pane by the editor's one-column left border slot while
 * matching pi-tui's editor width cap. The root renderer can provide one extra
 * column during a resize; consuming two columns here leaves one leading slot
 * and produces the same visible frame width as the editor.
 */
class ConnectedPaneComponent implements BlueComponent {
  constructor(
    private readonly child: BlueComponent,
    private readonly components: BlueComponents,
  ) {}

  /** @param width - full terminal width. @returns the connected pane rows. */
  render(width: number): string[] {
    const inner = Math.max(1, width - 2)
    const rows = padColumns(this.child.render(inner), 1)
    return width >= 2 ? rows : clampRowsToWidth(rows, Math.max(1, width), this.components.truncateToWidth)
  }

  /** Forward cache invalidation to the pane. */
  invalidate(): void {
    this.child.invalidate()
  }
}

/**
 * Mount the side-question pane and register `/btw`. The command handler owns
 * the whole lifecycle: validate the target session, replace the previous
 * slot, create the seeded side agent, subscribe its session's event feed and
 * status, then post the question as a follow-up. Every registration is
 * effect-bound; unloading the fiber unregisters the command, unmounts the
 * pane, disposes the live side agent, releases the editor splice, and arms
 * the in-flight-creation guard.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  const state: BtwState = {
    open: false,
    turns: [],
    minBodyLines: 0,
    followTail: true,
    scrollTop: 0,
    maxScrollTop: 0,
  }
  let slot: BtwSlot | undefined
  let unloaded = false
  // Only the latest ask may publish a newly-created side agent. Older creates
  // still get disposed when they settle, so a fast double `/btw` cannot leak a
  // handle or resurrect an obsolete pane.
  let askGeneration = 0

  /** Unsubscribe and dispose the live side agent, if any. */
  const clearSlot = async (): Promise<void> => {
    const current = slot
    slot = undefined
    if (current === undefined) return
    current.unbind()
    await current.handle.dispose()
  }

  /** Close the panel and dispose the side agent. */
  const dismiss = async (): Promise<CommandResult> => {
    const wasOpen = state.open || slot !== undefined
    askGeneration += 1
    await clearSlot()
    // Release the editor splice before clearing, so a render never shows the
    // `├┤` corners over a vanished pane.
    ctx.emit('blue/editor-connected-above', false)
    state.open = false
    state.turns = []
    state.minBodyLines = 0
    state.followTail = true
    state.scrollTop = 0
    state.maxScrollTop = 0
    screen.requestRender()
    return wasOpen
      ? { kind: 'success', text: 'dismissed the side question' }
      : { kind: 'error', text: 'no side question is open' }
  }

  const ask = async (question: string): Promise<CommandResult> => {
    if (question === '') return dismiss()
    const current = ctx.get('blueSession')?.current ?? null
    if (current === null) return { kind: 'error', text: 'no active session for a side question' }
    const generation = ++askGeneration
    let handle: AgentHandle
    try {
      const seed = stableSeed(current.session.events)
      const parentPreset = sessionPreset(current)
      const roster = ctx.get('agentPresets') as AgentPresetRoster | undefined
      handle = await ctx.agents.create({
        sessionId: SessionId(`btw-${randomUUID()}`),
        seed,
        // The side agent answers on the same route as the session it forked
        // from: without agentOptions its requests would carry an empty
        // provider/model and fail at request assembly.
        agentOptions: {
          ...current.options.provider === undefined ? {} : { provider: current.options.provider },
          ...current.options.model === undefined ? {} : { model: current.options.model },
        },
        meta: {
          cwd: current.session.header.cwd ?? process.cwd(),
          parentSession: current.id,
          seedLength: seed.length,
          ...(parentPreset === undefined ? {} : { agentPreset: parentPreset }),
        },
        ...(roster === undefined ? {} : {
          setup: async (agentCtx: Context): Promise<void> => {
            await roster.mount(agentCtx, parentPreset)
          },
        }),
      })
    } catch (error) {
      return {
        kind: 'error',
        text: `could not start the side session: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    // The fiber may have unloaded (e.g. a theme swap) while creation was in
    // flight: dispose the fresh handle instead of publishing a dead pane.
    if (unloaded || generation !== askGeneration) {
      await handle.dispose()
      return {
        kind: 'error',
        text: unloaded ? 'the side-question plugin was unloaded' : 'the side question was superseded',
      }
    }
    // Commit replacement only after the new handle exists. A failed create
    // therefore leaves the previous pane fully usable instead of orphaning
    // its splice state.
    await clearSlot()
    if (unloaded || generation !== askGeneration) {
      await handle.dispose()
      return {
        kind: 'error',
        text: unloaded ? 'the side-question plugin was unloaded' : 'the side question was superseded',
      }
    }
    const offEvent = ctx.on('session/event', (session, event) => {
      if (session !== handle.agent.session) return
      const turn = state.turns.at(-1)
      /* v8 ignore next -- the listeners never outlive the turns they feed:
         dismiss unbinds before clearing, and no await separates registration
         from the first turn push */
      if (turn === undefined) return
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
        turn.reply += event.data.chunk.text
      } else if (event.type === 'assistant/message') {
        turn.reply = messageText(event.data.message)
      } else if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
        turn.error = turnError(event.data.reason)
        turn.thinking = false
      } else {
        return
      }
      screen.requestRender()
    })
    const offStatus = ctx.on('agent/status', (payload) => {
      if (payload.agent !== handle.agent) return
      if (payload.status !== 'idle') return
      const turn = state.turns.at(-1)
      /* v8 ignore next -- same invariant as the event listener above */
      if (turn === undefined) return
      turn.thinking = false
      // The busy flag gates the editor's Enter routing; report the flip.
      ctx.emit('blue/editor-connected-above', true, false)
      screen.requestRender()
    })
    slot = {
      handle,
      unbind: () => {
        offEvent()
        offStatus()
      },
    }
    // A fresh question starts the panel from the top: height ratchet and
    // scroll state reset, tail-following restored, the slot busy.
    state.open = true
    state.turns = [{ question, reply: '', thinking: true }]
    state.minBodyLines = 0
    state.followTail = true
    state.scrollTop = 0
    state.maxScrollTop = 0
    ctx.emit('blue/editor-connected-above', true, true)
    try {
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: question }],
        source: { kind: 'user' },
      }))
    } catch (error) {
      await clearSlot()
      state.open = false
      state.turns = []
      ctx.emit('blue/editor-connected-above', false)
      screen.requestRender()
      return {
        kind: 'error',
        text: `could not ask the side question: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    screen.requestRender(true)
    return { kind: 'success', text: 'asked the side question' }
  }

  // Effect-bound so unloading this fiber unregisters the command.
  ctx.effect(() => ctx.commands.register({
    name: 'btw',
    description: 'Ask a side question in a forked session',
    input: { hint: '<question>' },
    handler: invocation => ask(invocation.rawInput.trim()),
  }))

  const pane = new BtwPaneComponent(colors, components, state, () => screen.rows)
  // This pane is the editor's connected frame: it keeps the editor's one
  // leading border slot but renders one extra content column, so its right
  // edge reaches the same terminal column as the editor's `┤`. Other passive
  // panes use the global two-column gutter.
  ctx.effect(() => screen.addBottomChild(new ConnectedPaneComponent(pane, components)))
  // The editor key chain routes close/scroll/submit here while the pane is
  // open.
  ctx.on('blue/btw-command', (command, text) => {
    if (!state.open) return
    if (command === 'close') {
      void dismiss()
      return
    }
    if (command === 'submit') {
      // The editor already refuses a submit while busy; double-guard so a
      // stale busy flag cannot drop a question silently. The text trims
      // like the /btw command (kimi's `submit` normalizes the prompt).
      const current = slot
      const question = text?.trim()
      if (current === undefined || question === undefined || question === '') return
      const turn = state.turns.at(-1)
      if (turn?.thinking === true) return
      state.turns.push({ question, reply: '', thinking: true })
      state.followTail = true
      state.scrollTop = 0
      state.maxScrollTop = 0
      ctx.emit('blue/editor-connected-above', true, true)
      try {
        current.handle.agent.followup(createUserMessage({
          content: [{ type: 'text', text: question }],
          source: { kind: 'user' },
        }))
      } catch (error) {
        const failedTurn = state.turns.at(-1)!
        failedTurn.thinking = false
        failedTurn.error = error instanceof Error ? error.message : String(error)
        state.followTail = true
        ctx.emit('blue/editor-connected-above', true, false)
        screen.requestRender()
      }
      screen.requestRender()
      return
    }
    if (pane.scroll(command === 'scroll-up' ? 'up' : 'down')) {
      screen.requestRender()
    }
  })
  // While a dialog panel occupies the editor slot the splice flag would
  // point at an off-tree editor; drop the claim for the panel's lifetime
  // and re-assert it (still open, busy per the live turn) when the editor
  // returns (the S16 dogfood known boundary, closed here).
  ctx.on('blue/editor-slot-swapped', (occupied) => {
    if (occupied) {
      // Only an open pane has a claim to drop.
      if (state.open) ctx.emit('blue/editor-connected-above', false)
      return
    }
    if (!state.open) return
    const busy = state.turns.at(-1)?.thinking === true
    ctx.emit('blue/editor-connected-above', true, busy)
  })
  // A session switch invalidates the old side conversation. Keeping it open
  // would route Enter into a fork of a session that is no longer visible.
  ctx.on('blue/session-changed', () => {
    // Invalidate an in-flight create even when no slot has been published yet.
    askGeneration += 1
    if (state.open || slot !== undefined) void dismiss()
  })
  // Disposers may be async and are awaited: unload disposes the side agent,
  // releases the editor splice (idempotent), and arms the guard any
  // in-flight creation checks before publishing.
  ctx.effect(() => async () => {
    unloaded = true
    ctx.emit('blue/editor-connected-above', false)
    await clearSlot()
  })
}
