/**
 * `blue-pane-agents` — the S33 subagent pane (the acceptance-ruling form,
 * the kimi `AgentSwarmProgressComponent` semantics): the running subagent
 * group renders as a dock pane pinned directly above the input editor —
 * always visible while agents run, never scrolling into history — and the
 * spawn-class tool calls (`subagent` / `subagent_fork`) render nothing in
 * the stream (the conversation projection routes them to `agents`): this
 * pane is their only presentation surface.
 *
 * The pane is self-hosted like the todo pane: current-session and official
 * facts subscriptions rebuild it from spawn-class calls, and it owns its
 * projection-backed child-session tracker for the live overlay. The group
 * card itself is the shared `AgentGroupComponent` (the kimi agent-group
 * port) rendering over pane-local member items. A group that has fully
 * settled stays visible until the next `turn/start` (kimi deletes the
 * swarm pane at the next turn begin, so the settled summary is readable
 * between turns and vanishes without a trace); a group still running
 * (continuable background agents) persists across the boundary. A resumed
 * session rebuilds the settled card from the snapshot with no live overlay
 * — the A+ form — and the pane renders zero rows with no agents.
 *
 * The live overlay the card consults is wrapped in a waiting hysteresis:
 * every freshly spawned child sits in the projection's `waiting` phase until
 * its first model response, so a batch spawn flickered the header between
 * `N running` and `N-1 running, 1 waiting`. A raw `waiting` now presents as
 * running until it has held for `WAITING_HOLD_MS` (aligned with the card's
 * 1 Hz tick, which owns the promotion repaint); a child leaving waiting
 * inside the window never shows the state at all, while a genuinely queued
 * child still surfaces. The pane's own settled/cross-turn logic reads the
 * raw tracker phases — the hold is presentation-only.
 *
 * @module @dsh-blue/blue-transcript/pane-agents
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConversationFacts } from '@dsh-blue/blue-conversation'
import type { BlueBottomPaneNode } from './dock-model.ts'
import type { SessionFactsService } from './session-facts.ts'
import { AgentGroupComponent, type AgentLiveLookup } from './agent-group.ts'
import { trackChildAgentModels } from './child-agent-model.ts'
import { parseToolArguments } from './present.ts'
import type { TranscriptToolItem } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-agents'

/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueSessionFacts', 'blueBottomPanes']

/** How long a child must hold the raw `waiting` phase before it presents as
 * waiting — one card-tick period, so the spawn transient never flickers. */
const WAITING_HOLD_MS = 1000

/** The wall clock the waiting hold runs against; replaceable in tests (the
 * `setAgentGroupTimers` precedent). */
let paneAgentsNow: () => number = Date.now

/**
 * Replace the pane clock (tests inject a fake here).
 * @param now - the replacement, or `undefined` to restore `Date.now`.
 */
export function setPaneAgentsClock(now: (() => number) | undefined): void {
  paneAgentsNow = now ?? Date.now
}

/** One pane-local member shaped for the existing group-card renderer. */
interface PaneMember {
  readonly item: TranscriptToolItem
}

/**
 * Mount the agents pane bottom-pinned; unloading the fiber unmounts it and
 * releases the current session's subscription and tracker.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  let members: PaneMember[] = []
  let card: AgentGroupComponent | undefined
  let tracker: ReturnType<typeof trackChildAgentModels> | undefined
  let liveLookup: AgentLiveLookup | undefined

  /**
   * Per-child wall clock of the raw `waiting` phase's first observation. A
   * waiting younger than `WAITING_HOLD_MS` presents as running; leaving
   * waiting (any direction) drops the entry so the transient stays invisible.
   */
  const waitingSince = new Map<string, number>()
  const displayLookup: AgentLiveLookup = (member) => {
    const live = liveLookup?.(member)
    if (live?.phase !== 'waiting') {
      waitingSince.delete(member.callId)
      return live
    }
    const since = waitingSince.get(member.callId)
    if (since === undefined) {
      waitingSince.set(member.callId, paneAgentsNow())
      return { ...live, phase: 'running' }
    }
    return paneAgentsNow() - since >= WAITING_HOLD_MS ? live : { ...live, phase: 'running' }
  }

  /** Rebuild the card over the current members (they change rarely). */
  const rebuild = (): void => {
    card?.dispose()
    card = undefined
    if (members.length === 0) return
    card = new AgentGroupComponent(
      members[0]!.item, colors, components,
      () => { screen.requestRender() },
      displayLookup,
    )
    for (const member of members.slice(1)) card.attach(member.item)
  }

  /**
   * Whether every current member truly finished: the parent projection alone
   * settles a foreground call, but a background ack lands within
   * milliseconds while the child still runs — the live overlay is the
   * authority there (a running member keeps the pane across turns). These
   * checks read the RAW tracker phases, never the held display phases: the
   * hold is presentation-only and must not delay a settle.
   */
  let lastTurn = -1
  const facts = ctx.get('blueSessionFacts') as SessionFactsService
  const sync = (next: ConversationFacts): void => {
    const settled = members.length > 0 && members.every(member => {
      if (member.item.result === undefined) return false
      const phase = liveLookup?.(member.item)?.phase
      return phase !== 'running' && phase !== 'waiting'
    })
    if (next.turn > lastTurn && settled) {
      members = []
    }
    lastTurn = Math.max(lastTurn, next.turn)
    const calls = next.agentCalls.filter(call => {
      if (call.result === undefined || call.turn === next.turn) return true
      const existing = members.find(member => member.item.callId === call.callId)
      const phase = existing === undefined ? undefined : liveLookup?.(existing.item)?.phase
      return phase === 'running' || phase === 'waiting'
    })
    members = calls.map(call => {
      const item: TranscriptToolItem = {
        kind: 'tool', seq: call.seq, turn: call.turn, step: call.step, callId: call.callId,
        name: call.name, arguments: call.arguments, startedAt: call.startedAt,
        ...(call.result === undefined ? {} : { result: { ...call.result, fullText: call.result.text } }),
      }
      const parsed = parseToolArguments(item.arguments)
      if (parsed !== undefined) item.parsedArguments = parsed
      return { item }
    })
    rebuild()
    ctx.blueBottomPanes.refresh('blue.dock.agents')
  }
  tracker = trackChildAgentModels(facts, () => {
    card?.invalidate()
    screen.requestRender()
  })
  liveLookup = tracker.snapshot
  const offFacts = facts.subscribe(sync)
  ctx.effect(() => () => offFacts())
  let sessionId = facts.currentSession?.id
  const offSession = facts.subscribeSession((session) => {
    if (session?.id === sessionId) return
    sessionId = session?.id
    lastTurn = -1
    members = []
    waitingSince.clear()
    rebuild()
    ctx.blueBottomPanes.refresh('blue.dock.agents')
  })
  ctx.effect(() => () => offSession())

  // A non-empty model and its card are rebuilt synchronously before the
  // registry invokes this adapter.
  const renderPane = (width: number): string[] => card!.render(width)

  const model = (): BlueBottomPaneNode => ({
    id: 'blue.dock.agents', priority: 50,
    node: { kind: 'text', content: members.length === 0 ? '' : `Agents (${String(members.length)})`, tone: 'accent' },
    collapsed: members.length === 0,
  })
  ctx.effect(() => {
    const dispose = ctx.blueBottomPanes.register(model, (_node, width) => renderPane(width))
    return () => {
      card?.dispose()
      tracker?.dispose()
      dispose()
    }
  })
}
