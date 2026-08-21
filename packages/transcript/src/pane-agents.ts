/**
 * `blue-pane-agents` — the S33 subagent pane (the acceptance-ruling form,
 * the kimi `AgentSwarmProgressComponent` semantics): the running subagent
 * group renders as a dock pane pinned directly above the input editor —
 * always visible while agents run, never scrolling into history — and the
 * spawn-class tool calls (`subagent` / `subagent_fork`) render nothing in
 * the stream (the fold suppresses them, the `todo_write` precedent): this
 * pane is their only presentation surface.
 *
 * The pane is self-hosted like the todo pane: on every
 * `'blue/session-changed'` it re-attaches — scanning the snapshot for
 * spawn-class calls, then subscribing the live feed — and owns its
 * child-session tracker (`agent-live.ts`) for the live overlay. The group
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
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { GutterComponent, type BlueComponent } from '@dsh-blue/blue-core'
// Empty type import carries the app-owned `blueSession` Context merge and
// the `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'
import { AgentGroupComponent, type AgentLiveLookup } from './agent-group.ts'
import { trackChildAgents } from './agent-live.ts'
import { parseToolArguments } from './present.ts'
import type { TranscriptToolItem, TranscriptToolResult } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-agents'

/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents']

/** The spawn-class tool names this pane presents (the fold's suppression set). */
const SUBAGENT_SPAWN_TOOL_NAMES: ReadonlySet<string> = new Set(['subagent', 'subagent_fork'])

/** The display text of a `tool/result` payload (the fold's content rule). */
function resultText(data: Record<string, unknown>): string {
  const message = data['message'] as { content?: Array<{ content?: Array<{ type?: string; text?: string }> }> } | undefined
  const blocks = message?.content?.[0]?.content ?? []
  const parts: string[] = []
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/** One pane-local member: the fold-item shape the group card renders over. */
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
  let detach: (() => void) | undefined
  let tracker: ReturnType<typeof trackChildAgents> | undefined
  let liveLookup: AgentLiveLookup | undefined

  /** Rebuild the card over the current members (they change rarely). */
  const rebuild = (): void => {
    card?.dispose()
    card = undefined
    if (members.length === 0) return
    card = new AgentGroupComponent(
      members[0]!.item, colors, components,
      () => { screen.requestRender() },
      liveLookup,
    )
    for (const member of members.slice(1)) card.attach(member.item)
  }

  /** Pair a result into its member item (the fold's callId rule). */
  const settle = (callId: string, result: TranscriptToolResult): void => {
    for (const member of members) {
      if (member.item.callId === callId) {
        member.item.result = result
        return
      }
    }
  }

  /**
   * Whether every current member truly finished: the fold result alone
   * settles a foreground call, but a background ack lands within
   * milliseconds while the child still runs — the live overlay is the
   * authority there (a running member keeps the pane across turns).
   */
  const allSettled = (): boolean =>
    members.length > 0 && members.every(member => {
      if (member.item.result === undefined) return false
      const live = tracker?.snapshot(member.item)
      return live?.phase !== 'running' && live?.phase !== 'waiting'
    })

  /**
   * Ingest one parent-session event: spawn calls join the group, results
   * pair in, and a turn boundary clears a settled group (kimi's rule — the
   * summary stays readable between turns, then goes without a trace).
   */
  const ingest = (event: SessionEvent): void => {
    const data = event.data as Record<string, unknown>
    switch (event.type) {
      case 'tool/call': {
        if (typeof data['name'] !== 'string' || !SUBAGENT_SPAWN_TOOL_NAMES.has(data['name'])) return
        const item: TranscriptToolItem = {
          kind: 'tool',
          seq: event.seq,
          turn: Number(data['turn']),
          step: Number(data['step']),
          callId: String(data['callId']),
          name: data['name'],
          arguments: String(data['arguments']),
          startedAt: event.time,
        }
        const parsed = parseToolArguments(item.arguments)
        if (parsed !== undefined) item.parsedArguments = parsed
        members.push({ item })
        rebuild()
        return
      }
      case 'tool/result': {
        const block = (data['message'] as { content?: Array<{ toolCallId?: string; isError?: boolean }> } | undefined)?.content?.[0]
        if (block?.toolCallId === undefined) return
        // Pane members suppress like the fold: the ack text (or the
        // foreground result) is the display text; fullText keeps the tail.
        const text = resultText(data)
        settle(String(block.toolCallId), {
          text,
          fullText: text,
          isError: block.isError === true || data['error'] !== undefined,
          endedAt: event.time,
        })
        rebuild()
        return
      }
      case 'turn/start': {
        // A settled group clears at the next turn begin; a still-running
        // group (continuable background agents) persists across it.
        if (allSettled()) {
          members = []
          rebuild()
        }
        return
      }
      default:
        return
    }
  }

  /** Attach to one agent: snapshot scan, live feed, child tracker. */
  const attach = (agent: Agent): void => {
    detach?.()
    tracker?.dispose()
    tracker = undefined
    liveLookup = undefined
    members = []
    rebuild()
    tracker = trackChildAgents(ctx, agent, () => { screen.requestRender() })
    liveLookup = tracker.snapshot
    for (const event of agent.session.events) ingest(event)
    rebuild()
    detach = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      ingest(event)
    })
    screen.requestRender()
  }

  const pane: BlueComponent = {
    invalidate(): void {
      card?.invalidate()
    },
    render(width: number): string[] {
      return card === undefined ? [] : card.render(width)
    },
  }

  const current = ctx.get('blueSession')?.current
  if (current) attach(current)
  ctx.on('blue/session-changed', attach)
  ctx.effect(() => {
    const dispose = screen.addBottomChild(new GutterComponent(pane))
    return () => {
      detach?.()
      tracker?.dispose()
      card?.dispose()
      dispose()
    }
  })
}
