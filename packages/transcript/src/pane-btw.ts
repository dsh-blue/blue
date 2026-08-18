/**
 * `blue-pane-btw` plugin: a side-question bottom pane plus the `/btw`
 * command that drives it. `/btw <question>` forks the live session into a
 * throwaway side agent — `agents.create` with the full event log as seed,
 * the parent's model route as `agentOptions`, and the fork-lineage meta
 * (cwd, `parentSession`, `seedLength`), the same construction as the app
 * driver's fork switch — posts the question as a
 * follow-up, and renders the exchange in the pane: a `roleUser`
 * `› question` line, the assistant text as it streams in (text chunk deltas
 * append; the closing `assistant/message` rewrites the accumulation
 * authoritatively, mirroring the transcript fold), and a muted `thinking…`
 * row until the side agent returns to idle. The pane renders at most the
 * latest {@link BTW_MAX_LINES} rows and truncates every row to the viewport.
 *
 * `/btw` without input dismisses the panel and disposes the side agent; a
 * new question while one is open disposes the previous side agent first
 * (single slot). The pane is a passive bottom child: it renders zero rows
 * while closed and never consumes keyboard input, so dismissal lives
 * entirely in the command. Creation is async and the fiber may unload
 * mid-flight (theme swap): an `unloaded` flag armed by an effect disposer
 * makes the continuation dispose the fresh handle instead of publishing it,
 * and unloading also disposes the live slot.
 *
 * @module @deepseek-ai/dsh-blue-transcript/pane-btw
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {
  BlueComponent,
  BlueComponents,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
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

/** The pane's row budget: only the latest rows of the exchange render. */
export const BTW_MAX_LINES = 20

/** Below this viewport width the pane renders nothing rather than overflow. */
const BTW_MIN_WIDTH = 4

/** The pane's render state, mutated by the command handler and subscriptions. */
interface BtwState {
  /** Whether an exchange is open; a closed pane renders zero rows. */
  open: boolean
  /** The question that opened the current exchange. */
  question: string
  /** The accumulated (then finalized) side reply text. */
  reply: string
  /** Whether the side agent has yet to return to idle. */
  thinking: boolean
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
 * The side-question pane: the question line, the reply lines, and a
 * `thinking…` row while the side agent runs, capped at the latest
 * {@link BTW_MAX_LINES} rows. Closed renders zero rows.
 */
class BtwPaneComponent implements BlueComponent {
  /**
   * @param colors - the semantic color table.
   * @param components - the component factory providing width truncation.
   * @param state - the shared exchange state.
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly state: BtwState,
  ) {}

  /**
   * @param width - current viewport width in columns.
   * @returns the exchange rows; none while closed.
   */
  render(width: number): string[] {
    if (!this.state.open) return []
    if (width < BTW_MIN_WIDTH) return []
    const lines: string[] = [
      this.colors.roleUser(this.components.truncateToWidth(`› ${this.state.question}`, width)),
    ]
    if (this.state.reply !== '') {
      for (const line of this.state.reply.split('\n')) {
        lines.push(this.components.truncateToWidth(line, width))
      }
    }
    if (this.state.thinking) lines.push(this.colors.muted('thinking…'))
    return lines.slice(-BTW_MAX_LINES)
  }

  /** Stateless render; nothing to drop. */
  invalidate(): void {}
}

/**
 * Mount the side-question pane and register `/btw`. The command handler owns
 * the whole lifecycle: validate the target session, replace the previous
 * slot, create the seeded side agent, subscribe its session's event feed and
 * status, then post the question as a follow-up. Every registration is
 * effect-bound; unloading the fiber unregisters the command, unmounts the
 * pane, disposes the live side agent, and arms the in-flight-creation guard.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  const state: BtwState = { open: false, question: '', reply: '', thinking: false }
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
    state.open = false
    state.reply = ''
    state.thinking = false
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
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
        state.reply += event.data.chunk.text
      } else if (event.type === 'assistant/message') {
        state.reply = messageText(event.data.message)
      } else {
        return
      }
      screen.requestRender()
    })
    const offStatus = ctx.on('agent/status', (payload) => {
      if (payload.agent !== handle.agent) return
      if (payload.status !== 'idle') return
      state.thinking = false
      screen.requestRender()
    })
    slot = {
      handle,
      unbind: () => {
        offEvent()
        offStatus()
      },
    }
    state.open = true
    state.question = question
    state.reply = ''
    state.thinking = true
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

  const pane = new BtwPaneComponent(colors, components, state)
  // Bottom panes render in mount order; a zero-row render occupies nothing.
  ctx.effect(() => screen.addBottomChild(pane))
  // Disposers may be async and are awaited: unload disposes the side agent
  // and arms the guard any in-flight creation checks before publishing.
  ctx.effect(() => async () => {
    unloaded = true
    await clearSlot()
  })
}
