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
 * A trailing blank row separates the pane from the input editor, whose top
 * corners splice to `├┤` while the pane is open: the pane emits
 * `'blue/editor-connected-above'` (true on open, false on dismiss or
 * unload) and `blue-input` mirrors it onto the editor. The pane is a
 * passive bottom child — it renders zero rows while closed and never
 * consumes keyboard input — so closing and scrolling live in
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
 * @module @deepseek-ai/dsh-blue-transcript/pane-btw
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {
  BlueComponent,
  BlueComponents,
  BlueMarkdown,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
import { topRule } from '@deepseek-ai/dsh-blue-core/chrome'
// The named import also carries the `commands` Context merge.
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge this
// plugin reads through `ctx.get` (never `inject`, as the app plugin may
// activate after this one).
import type {} from '@deepseek-ai/dsh-blue-app'

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
    // One blank row separates the pane from the editor it splices into
    // (kimi's Spacer(1)); the pane draws no bottom border.
    lines.push('')
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
      if (turn.thinking) lines.push(this.colors.muted('thinking…'))
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
    if (slot === undefined) return { kind: 'error', text: 'no side question is open' }
    await clearSlot()
    // Release the editor splice before clearing, so a render never shows the
    // `├┤` corners over a vanished pane.
    ctx.emit('blue/editor-connected-above', false)
    state.open = false
    state.turns = []
    screen.requestRender()
    return { kind: 'success', text: 'dismissed the side question' }
  }

  const ask = async (question: string): Promise<CommandResult> => {
    if (question === '') return dismiss()
    const current = ctx.get('blueSession')?.current ?? null
    if (current === null) return { kind: 'error', text: 'no active session for a side question' }
    // Single slot: a fresh question replaces the previous side agent.
    await clearSlot()
    let handle: AgentHandle
    try {
      handle = await ctx.agents.create({
        sessionId: SessionId(`btw-${randomUUID()}`),
        seed: current.session.events,
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
          seedLength: current.session.events.length,
        },
      })
    } catch (error) {
      return {
        kind: 'error',
        text: `could not start the side session: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    // The fiber may have unloaded (e.g. a theme swap) while creation was in
    // flight: dispose the fresh handle instead of publishing a dead pane.
    if (unloaded) {
      await handle.dispose()
      return { kind: 'error', text: 'the side-question plugin was unloaded' }
    }
    const offEvent = ctx.on('session/event', (session, event) => {
      if (session !== handle.agent.session) return
      const turn = state.turns.at(-1)
      if (turn === undefined) return
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
        turn.reply += event.data.chunk.text
      } else if (event.type === 'assistant/message') {
        turn.reply = messageText(event.data.message)
      } else {
        return
      }
      screen.requestRender()
    })
    const offStatus = ctx.on('agent/status', (payload) => {
      if (payload.agent !== handle.agent) return
      if (payload.status !== 'idle') return
      const turn = state.turns.at(-1)
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
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: question }],
      source: { kind: 'user' },
    }))
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
  // Bottom panes render in mount order; a zero-row render occupies nothing.
  ctx.effect(() => screen.addBottomChild(pane))
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
      current.handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: question }],
        source: { kind: 'user' },
      }))
      screen.requestRender()
      return
    }
    if (pane.scroll(command === 'scroll-up' ? 'up' : 'down')) {
      screen.requestRender()
    }
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
