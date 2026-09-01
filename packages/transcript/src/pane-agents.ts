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
 * card is projected to canonical nodes with the same group summary, tree,
 * live metrics, and activity detail as the transcript-era component. A group that has fully
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
import type { BlueInlineSpan, BlueTone, BlueUiNode } from '@dsh-blue/blue-api'
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

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

function memberElapsed(member: PaneMember, live: AgentLiveLookup | undefined): number {
  const snapshot = live?.(member.item)
  const terminal = snapshot?.phase === 'completed' || snapshot?.phase === 'failed' || member.item.result !== undefined
  const end = terminal ? snapshot?.endedAt ?? member.item.result?.endedAt : undefined
  return Math.max(0, Math.floor(((end ?? paneAgentsNow()) - member.item.startedAt) / 1000))
}

function firstNonEmptyLine(text: string): string | undefined {
  return text.split('\n').find(line => line.trim() !== '')?.trim()
}

function agentLabel(item: TranscriptToolItem): { readonly label: string, readonly detail?: string } {
  const named = ['name', 'agent_name', 'agent', 'type', 'preset']
    .map(key => argument(item, key))
    .find(value => value !== undefined)
  const description = argument(item, 'description')
  if (named !== undefined) return { label: named, ...(description === undefined || description === named ? {} : { detail: description }) }
  if (description !== undefined) return { label: description }
  return { label: item.name, ...(item.arguments === '' ? {} : { detail: item.arguments }) }
}

function agentsNode(members: readonly PaneMember[], live: AgentLiveLookup | undefined): BlueUiNode | null {
  if (members.length === 0) return null
  const phases = members.map(member => agentPhase(member, live))
  const counts = new Map<string, number>()
  for (const phase of phases) counts.set(phase.label, (counts.get(phase.label) ?? 0) + 1)
  const maxElapsed = Math.max(...members.map(member => memberElapsed(member, live)))
  const settled = phases.every(phase => phase.label === 'done' || phase.label === 'failed')
  const noun = members.length === 1 ? 'agent' : 'agents'
  const summary: BlueInlineSpan[] = settled
    ? [
        { text: '✓ ', tone: 'success' },
        { text: `${String(members.length)} ${noun} finished`, tone: 'accent', emphasis: 'strong' },
        { text: ` · ${formatElapsed(maxElapsed)}`, tone: 'muted' },
      ]
    : [
        { text: '● ', tone: 'accent' },
        { text: `Running ${String(members.length)} ${noun}`, tone: 'accent', emphasis: 'strong' },
        { text: ` (${['done', 'failed', 'running', 'waiting'].flatMap(label => {
          const count = counts.get(label) ?? 0
          return count === 0 ? [] : [`${String(count)} ${label}`]
        }).join(', ')}) · ${formatElapsed(maxElapsed)}`, tone: 'muted' },
      ]
  const children: { readonly node: BlueUiNode }[] = [
    { node: { kind: 'divider' } },
    { node: { kind: 'rich-text', spans: summary } },
  ]
  members.forEach((member, index) => {
    const snapshot = live?.(member.item)
    const phase = phases[index]!
    const { label, detail } = agentLabel(member.item)
    const metrics = [
      snapshot?.model,
      snapshot?.effort,
      snapshot?.toolCount === undefined ? undefined : `${String(snapshot.toolCount)} ${snapshot.toolCount === 1 ? 'tool' : 'tools'}`,
      formatElapsed(memberElapsed(member, live)),
      snapshot?.tokens === undefined ? undefined : `${String(snapshot.tokens)} tokens`,
    ].filter((value): value is string => value !== undefined)
    children.push({
      node: {
        kind: 'rich-text',
        spans: [
          { text: `  ${index === members.length - 1 ? '└─' : '├─'} `, tone: 'muted' },
          { text: `${phase.label} `, tone: phase.tone, emphasis: 'strong' },
          { text: label, tone: 'accent' },
          { text: ` · ${[...(detail === undefined ? [] : [detail]), ...metrics].join(' · ')}`, tone: 'muted' },
        ],
      },
    })
    const detailLine = phase.label === 'failed'
      ? member.item.result?.isError === true
        ? firstNonEmptyLine(member.item.result.text)
        : 'Failed'
      : snapshot?.activity
    if (detailLine !== undefined) {
      children.push({ node: { kind: 'text', content: `  ${index === members.length - 1 ? '   ' : '│  '}    ${phase.label === 'failed' ? `Error: ${detailLine}` : detailLine}`, tone: phase.label === 'failed' ? 'danger' : 'muted' } })
    }
  })
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
  refresh = () => {
    pane.setHidden(members.length === 0)
    if (members.length > 0) pane.refresh()
  }
  refresh()
  ctx.effect(() => {
    return () => {
      tracker?.dispose()
      for (const id of waitingSince.keys()) clearWaiting(id)
      pane.dispose()
    }
  })
}
