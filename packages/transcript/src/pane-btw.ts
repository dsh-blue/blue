/**
 * `blue-pane-btw` plugin: a side-question bottom pane plus the `/btw`
 * command that drives it. `/btw <question>` forks the live session into a
 * throwaway side session through the native Harness `agents` service,
 * posts the question as a follow-up, and renders the exchange from the native
 * `sessionProjections` service. Its canonical `surface` and `scroll` nodes
 * leave chrome, width, height allocation, and scrolling to Blue core.
 * The pane fills the same connected frame as the input editor, whose top
 * corners splice to `├┤` while the pane is open: the pane emits
 * `'blue/editor-connected-above'` (true on open, false on dismiss or
 * unload) and `blue-input` mirrors it onto the editor. While a dialog
 * panel occupies the editor slot the splice claim would point at an
 * off-tree editor, so the pane drops it for the panel's lifetime and
 * re-asserts it on `'blue/editor-slot-swapped'` when the editor returns.
 * The pane renders no node while closed. The input plugin routes close and
 * continuation-submit commands through `'blue/btw-command'` while the editor
 * splice is connected.
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
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { BlueUiNode } from '@dsh-blue/blue-api'
// The named import also carries the `commands` Context merge.
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { ConversationProjection } from '@dsh-blue/blue-conversation'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-btw'

/** Services required before the pane and command can register. */
export const inject = ['bluePanes', 'commands', 'blueCurrentAgent', 'agents', 'agentDefaultModel', 'agentPresets', 'sessionProjections']

/** One question/answer exchange inside the pane. */
interface BtwTurn {
  /** The question that started this exchange. */
  question: string
  /** The accumulated (then finalized) side reply text. */
  reply: string
  /** Whether the side agent has yet to return to idle for this turn. */
  thinking: boolean
  /** Projection sequence already present before this question was posted. */
  afterSeq: number
}

/** The pane's render state, mutated by the command handler and subscriptions. */
interface BtwState {
  /** Whether an exchange is open; a closed pane renders zero rows. */
  open: boolean
  /** The exchanges so far; continuation turns append to the same slot. */
  turns: BtwTurn[]
}

/** The live side session plus its projection/status subscription unbinders. */
interface BtwSlot {
  handle: AgentHandle
  unbind: () => void
}

interface ProjectionSource {
  snapshot(session: Session): { readonly asOfSeq: number, readonly values: Record<string, unknown> }
  onChanged(listener: (session: Session, key: string, value: unknown, seq: number) => void): () => void
}

function projectionReply(value: unknown, afterSeq: number): { reply: string, thinking: boolean } {
  if (value === null || typeof value !== 'object') return { reply: '', thinking: false }
  const row = value as { readonly entries?: unknown, readonly streaming?: unknown }
  if (!Array.isArray(row.entries)) return { reply: '', thinking: false }
  const projection = row as ConversationProjection
  const assistant = [...projection.entries].reverse().find(entry => typeof entry === 'object'
    && entry !== null
    && entry.kind === 'assistant'
    && entry.seq > afterSeq)
  return {
    reply: assistant?.kind === 'assistant' ? assistant.text : '',
    thinking: projection.streaming === true,
  }
}

/**
 * Canonical side-question content. Core owns the surface chrome, allocation,
 * narrow behavior, and the tail-following scroll viewport.
 */
function btwNode(state: BtwState): BlueUiNode | null {
  if (!state.open) return null
  const children: { readonly node: BlueUiNode }[] = []
  for (const [index, turn] of state.turns.entries()) {
    if (index > 0) children.push({ node: { kind: 'divider' } })
    children.push({ node: { kind: 'rich-text', spans: [{ text: `> ${turn.question}`, tone: 'accent', emphasis: 'strong' }] } })
    if (turn.reply !== '') children.push({ node: { kind: 'text', content: turn.reply } })
    if (turn.thinking) children.push({ node: { kind: 'loader', message: 'thinking...', variant: 'braille' } })
  }
  return {
    kind: 'surface',
    chrome: 'surface',
    title: 'BTW',
    subtitle: 'Esc close',
    padding: 1,
    child: {
      kind: 'scroll',
      follow: 'end',
      scrollbar: true,
      child: { kind: 'stack', direction: 'column', gap: 0, children },
    },
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
  const state: BtwState = {
    open: false,
    turns: [],
  }
  let slot: BtwSlot | undefined
  let unloaded = false
  const projections = ctx.sessionProjections as ProjectionSource
  const pane = ctx.bluePanes.register({
    id: 'blue.pane.btw',
    title: 'BTW',
    placement: 'bottom',
    priority: 100,
    narrow: 'bottom',
    render: () => btwNode(state),
  })
  const refreshDock = (): void => {
    pane.refresh()
  }

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
    refreshDock()
    return { kind: 'success', text: 'dismissed the side question' }
  }

  const ask = async (question: string): Promise<CommandResult> => {
    if (question === '') return dismiss()
    // Replace the visible turn before either disposal or side creation can
    // yield. The fork may take long enough to otherwise leave the previous
    // answer painted as if it belonged to this question.
    state.open = true
    state.turns = [{ question, reply: '', thinking: true, afterSeq: Number.MAX_SAFE_INTEGER }]
    ctx.emit('blue/editor-connected-above', true, true)
    pane.refresh()
    // Single slot: a fresh question replaces the previous side agent.
    await clearSlot()
    let handle: AgentHandle | undefined
    try {
      const parent = ctx.blueCurrentAgent.current()
      if (parent !== null) {
        const seed = parent.session.events
        const selected = parent.session.requestHeader()?.config ?? ctx.agentDefaultModel.currentSelection()
        let preset = parent.session.header.agentPreset
        for (const event of parent.session.events) {
          if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
        }
        handle = await ctx.agents.create({
          sessionId: SessionId(`btw-${randomUUID()}`),
          meta: {
            cwd: parent.session.header.cwd ?? process.cwd(),
            parentSession: parent.id,
            seedLength: seed.length,
          },
          seed,
          agentOptions: {
            provider: selected.provider,
            model: selected.model,
            ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
          },
          setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) },
        })
      }
    } catch (error) {
      ctx.emit('blue/editor-connected-above', false)
      state.open = false
      state.turns = []
      refreshDock()
      return {
        kind: 'error',
        text: `could not start the side session: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    if (handle === undefined) {
      ctx.emit('blue/editor-connected-above', false)
      state.open = false
      state.turns = []
      refreshDock()
      return { kind: 'error', text: 'no active session for a side question' }
    }
    // The fiber may have unloaded (e.g. a theme swap) while creation was in
    // flight: dispose the fresh handle instead of publishing a dead pane.
    if (unloaded) {
      await handle.dispose()
      return { kind: 'error', text: 'the side-question plugin was unloaded' }
    }
    const updateFromProjection = (value: unknown): void => {
      const turn = state.turns.at(-1)
      /* c8 ignore next -- ask seeds the first turn before any projection callback is bound. */
      if (turn === undefined) return
      const next = projectionReply(value, turn.afterSeq)
      const thinking = next.thinking || turn.thinking
      if (turn.reply === next.reply && turn.thinking === thinking) return
      turn.reply = next.reply
      turn.thinking = thinking
      refreshDock()
    }
    // The fork snapshot contains the parent conversation. Its watermark is
    // the hard boundary between inherited history and this question.
    const initialSnapshot = projections.snapshot(handle.agent.session)
    const initial = initialSnapshot.values['blueConversation']
    state.turns[0]!.afterSeq = initialSnapshot.asOfSeq
    updateFromProjection(initial)
    const offProjection = projections.onChanged((session, key, value) => {
      if (session !== handle.agent.session || key !== 'blueConversation') return
      updateFromProjection(value)
    })
    const updateStatus = (status: string): void => {
      const turn = state.turns.at(-1)
      /* v8 ignore next -- an open slot always seeds one turn before status
         subscription; this guard protects a hostile host callback. */
      if (turn === undefined) return
      const thinking = status === 'running'
      if (turn.thinking === thinking) return
      turn.thinking = thinking
      if (!thinking) ctx.emit('blue/editor-connected-above', true, false)
      refreshDock()
    }
    const offStatus = ctx.on('agent/status', ({ agent, status }) => {
      if (agent === handle.agent) updateStatus(status)
    })
    updateStatus(handle.agent.status)
    slot = {
      handle,
      unbind: () => {
        offProjection()
        offStatus()
      },
    }
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
    pane.refresh()
    return { kind: 'success', text: 'asked the side question' }
  }

  // Effect-bound so unloading this fiber unregisters the command.
  ctx.effect(() => ctx.commands.register({
    name: 'btw',
    description: 'Ask a side question in a forked session',
    input: { hint: '<question>' },
    handler: invocation => ask(invocation.rawInput.trim()),
  }))

  // The editor key chain routes close and continuation submit here while the
  // pane is open.
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
      const snapshot = projections.snapshot(current.handle.agent.session)
      state.turns.push({
        question,
        reply: '',
        thinking: true,
        afterSeq: snapshot.asOfSeq,
      })
      ctx.emit('blue/editor-connected-above', true, true)
      current.handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: question }], source: { kind: 'user' } }))
      refreshDock()
      return
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
  // Disposers may be async and are awaited: unload disposes the side agent,
  // releases the editor splice (idempotent), and arms the guard any
  // in-flight creation checks before publishing.
  ctx.effect(() => async () => {
    unloaded = true
    ctx.emit('blue/editor-connected-above', false)
    pane.dispose()
    await clearSlot()
  })
}
