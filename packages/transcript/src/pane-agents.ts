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
 * @module @dsh-blue/blue-transcript/pane-agents
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueTone, BlueUiNode } from '@dsh-blue/blue-api'
import type { ConversationFacts } from '@dsh-blue/blue-conversation'
import type { SessionFactsService } from './session-facts.ts'
import type { AgentLiveLookup } from './agent-group.ts'
import { trackChildAgentModels } from './child-agent-model.ts'
import { parseToolArguments } from './present.ts'
import type { TranscriptToolItem } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-agents'

/** Services required before the pane can mount. */
export const inject = ['bluePanes', 'blueSessionFacts']

/** A fresh child must remain waiting for this long before the badge changes. */
const WAITING_HOLD_MS = 1000

let paneAgentsNow: () => number = Date.now

/** Replace the pane clock for deterministic tests. */
export function setPaneAgentsClock(now: (() => number) | undefined): void {
  paneAgentsNow = now ?? Date.now
}

/** One pane-local member shaped for the existing group-card renderer. */
interface PaneMember {
  readonly item: TranscriptToolItem
}

function argument(item: TranscriptToolItem, key: string): string | undefined {
  const args = item.parsedArguments
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function agentPhase(member: PaneMember, live: AgentLiveLookup | undefined): {
  readonly label: string
  readonly tone: BlueTone
} {
  const phase = live?.(member.item)?.phase
  if (phase === 'failed' || member.item.result?.isError === true) return { label: 'failed', tone: 'danger' }
  if (phase === 'waiting') return { label: 'waiting', tone: 'warning' }
  if (phase === 'running' || member.item.result === undefined) return { label: 'running', tone: 'accent' }
  return { label: 'done', tone: 'success' }
}

function agentsNode(members: readonly PaneMember[], live: AgentLiveLookup | undefined): BlueUiNode | null {
  if (members.length === 0) return null
  const children: { readonly node: BlueUiNode }[] = [{
    node: { kind: 'rich-text', spans: [{ text: `Agents (${String(members.length)})`, tone: 'accent', emphasis: 'strong' }] },
  }]
  for (const member of members) {
    const snapshot = live?.(member.item)
    const phase = agentPhase(member, live)
    const label = argument(member.item, 'name') ?? argument(member.item, 'description') ?? member.item.name
    const detail = argument(member.item, 'description')
    const metrics = [
      snapshot?.model,
      snapshot?.effort,
      snapshot?.toolCount === undefined ? undefined : `${String(snapshot.toolCount)} tools`,
      snapshot?.tokens === undefined ? undefined : `${String(snapshot.tokens)} tokens`,
    ].filter((value): value is string => value !== undefined)
    children.push({
      node: {
        kind: 'rich-text',
        spans: [
          { text: `${phase.label} `, tone: phase.tone, emphasis: 'strong' },
          { text: label },
          ...(detail === undefined || detail === label ? [] : [{ text: ` · ${detail}`, tone: 'muted' as const }]),
          ...(metrics.length === 0 ? [] : [{ text: ` · ${metrics.join(' · ')}`, tone: 'muted' as const }]),
        ],
      },
    })
    if (snapshot?.activity !== undefined) children.push({ node: { kind: 'text', content: `  ${snapshot.activity}`, tone: 'muted' } })
  }
  return { kind: 'stack', direction: 'column', gap: 0, children }
}

/**
 * Mount the agents pane bottom-pinned; unloading the fiber unmounts it and
 * releases the current session's subscription and tracker.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let members: PaneMember[] = []
  let tracker: ReturnType<typeof trackChildAgentModels> | undefined
  let liveLookup: AgentLiveLookup | undefined
  let refresh = (): void => undefined
  const waitingSince = new Map<string, number>()
  const waitingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const clearWaiting = (id: string): void => {
    waitingSince.delete(id)
    const timer = waitingTimers.get(id)
    if (timer !== undefined) clearTimeout(timer)
    waitingTimers.delete(id)
  }
  const displayLookup: AgentLiveLookup = (member) => {
    const live = liveLookup?.(member)
    if (live?.phase !== 'waiting') {
      clearWaiting(member.callId)
      return live
    }
    const since = waitingSince.get(member.callId)
    if (since === undefined) {
      waitingSince.set(member.callId, paneAgentsNow())
      const timer = setTimeout(() => {
        waitingTimers.delete(member.callId)
        refresh()
      }, WAITING_HOLD_MS)
      timer.unref()
      waitingTimers.set(member.callId, timer)
      return { ...live, phase: 'running' }
    }
    return paneAgentsNow() - since >= WAITING_HOLD_MS ? live : { ...live, phase: 'running' }
  }

  /**
   * Whether every current member truly finished: the parent projection alone
   * settles a foreground call, but a background ack lands within
   * milliseconds while the child still runs — the live overlay is the
   * authority there (a running member keeps the pane across turns).
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
    refresh()
  }
  tracker = trackChildAgentModels(facts, () => {
    refresh()
  })
  liveLookup = tracker.snapshot
  const offFacts = facts.subscribe(sync)
  ctx.effect(() => () => offFacts())
  let sessionId = facts.currentAgent?.id
  const offAgent = facts.subscribeAgent((agent) => {
    if (agent?.id === sessionId) return
    sessionId = agent?.id
    lastTurn = -1
    members = []
    for (const id of waitingSince.keys()) clearWaiting(id)
    refresh()
  })
  ctx.effect(() => () => offAgent())

  const pane = ctx.bluePanes.register({
    id: 'blue.pane.agents',
    title: 'Agents',
    placement: 'bottom',
    priority: 50,
    narrow: 'bottom',
    render: () => agentsNode(members, displayLookup),
  })
  refresh = () => pane.refresh()
  ctx.effect(() => {
    return () => {
      tracker?.dispose()
      for (const id of waitingSince.keys()) clearWaiting(id)
      pane.dispose()
    }
  })
}
