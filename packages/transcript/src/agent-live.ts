/**
 * `agent-live` — the S33 child-session tracker: the live overlay that lifts
 * the agent group card from the fold baseline (A+) to kimi-level depth.
 *
 * One global `session/event` listener admits this agent's subagent children
 * by their session headers (`origin === 'subagent'` &&
 * `parentSession === agent.session.id` — the dogfood-verified admission
 * keys; a raw `Session` carrier does no cordis isolation filtering, so the
 * unscoped plugin ctx receives every session's events — the pane-btw
 * side-session precedent). Each admitted child reduces to the kimi
 * agent-group stats: per-step token usage (replace-per-step, the
 * `foldTokenBuckets` rule), dispatched tool count, the latest activity
 * marker, and the model/effort from `request/header`. The child's own
 * `turn/end` is the phase authority (the harness's own epoch stop-reason
 * mapping); a continuable child woken by a later `turn/start` flips back to
 * running with per-epoch counters.
 *
 * Member correlation (D37): spawn-class acks carry the child session id
 * (`started subagent <id>`), looked up exactly; fork acks carry only a job
 * name, so the delegation prompt is the fallback key — the child's first
 * live `user/message` text equals the parent call's `parsedArguments.prompt`
 * (the driver followups the prompt verbatim; constructor seeds never emit).
 *
 * The ephemeral `subagent/start|end` events are deliberately not subscribed
 * (D37): their carrier is the SubagentsService, whose isolation filter is a
 * composition-dependent contract, and the child stream subsumes them. Replay
 * never constructs this tracker — the live argument is absent on the replay
 * path, so grouped cards degrade to the A+ form structurally. The
 * construction seed (`ctx.get('sessions')`, soft) covers in-process remounts
 * (`/theme`): each still-live child replays from `firstLiveSeq`, which
 * drops the fork child's seeded parent-turn prefix whose usage records
 * would otherwise inflate child tokens.
 *
 * @module @dsh-blue/blue-transcript/agent-live
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AgentMemberLive } from './agent-group.ts'
import type { TranscriptToolItem } from './types.ts'

/** One child's per-step token buckets (the TokenUsage fields we sum). */
interface ChildUsageBuckets {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** The reduce state for one admitted child session. */
export interface ChildAgentState {
  /** The child session id (the fork/spawn ack's exact key). */
  readonly id: string
  /** Wall clock of the first admitted event (envelope time on seeds). */
  readonly startedAt: number
  /** The delegation prompt — the child's first live user/message text. */
  promptText?: string
  /** The epoch phase; `turn/start` re-enters running with fresh counters. */
  phase: 'starting' | 'running' | 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'
  /** Wall clock of the epoch's closing `turn/end`, while terminal. */
  epochEndedAt?: number | undefined
  /** Dispatched `tool/call` count this epoch. */
  toolCount: number
  /** Per-step usage (replace semantics; `${turn}/${step}` keyed). */
  readonly usageByStep: Map<string, ChildUsageBuckets>
  /** Latest `request/header` model. */
  model?: string
  /** Latest `request/header` reasoning effort. */
  effort?: string
  /** The latest activity marker, for the running second line. */
  lastMarker?: { kind: 'reasoning' | 'text' | 'tool'; name?: string | undefined } | undefined
}

/** Terminal phase per `turn/end` reason kind (the lifecycle.ts mapping). */
const TURN_END_PHASE: Record<SessionEvent<'turn/end'>['data']['reason']['kind'], ChildAgentState['phase']> = {
  completed: 'completed',
  aborted: 'aborted',
  interrupted: 'aborted',
  error: 'error',
  'max-tokens': 'max-tokens',
  blocked: 'refusal',
}

/** Terminal phase from a child `turn/end` reason (lifecycle.ts mapping). */
export function phaseOfTurnEnd(
  reason: SessionEvent<'turn/end'>['data']['reason'],
): ChildAgentState['phase'] {
  return TURN_END_PHASE[reason.kind]
}

/** Buckets from a usage record; absent fields count as zero. */
function usageBuckets(usage: Record<string, unknown>): ChildUsageBuckets {
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return {
    input: num(usage['inputTokens']),
    cacheRead: num(usage['cacheReadTokens']),
    cacheWrite: num(usage['cacheWriteTokens']),
    output: num(usage['outputTokens']),
  }
}

/** Join an event content-block array's text (the user/message payload). */
function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'text' in block
      && typeof (block as { text: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/**
 * Reduce one child event into the state — O(1), no string building beyond
 * the marker fields. `now` stamps `epochEndedAt` (envelope time on seeds).
 */
export function deriveChildEvent(state: ChildAgentState, event: SessionEvent, now: number): void {
  const data = event.data as Record<string, unknown>
  switch (event.type) {
    case 'turn/start': {
      // A new epoch (first turn or a continuable re-wake): fresh counters.
      state.phase = 'running'
      state.epochEndedAt = undefined
      state.toolCount = 0
      state.usageByStep.clear()
      state.lastMarker = undefined
      return
    }
    case 'user/message': {
      const source = data['source'] as { kind?: string } | undefined
      if (source?.kind !== 'user') return
      const text = contentText(data['content'])
      if (text !== undefined && text !== '' && state.promptText === undefined) {
        state.promptText = text
      }
      return
    }
    case 'request/header': {
      const header = data['header'] as { config?: { model?: unknown; reasoningEffort?: unknown } } | undefined
      const config = header?.config
      if (config === undefined) return
      if (typeof config.model === 'string' && config.model !== '') state.model = config.model
      if (typeof config.reasoningEffort === 'string' && config.reasoningEffort !== '') {
        state.effort = config.reasoningEffort
      }
      return
    }
    case 'tool/call': {
      state.toolCount += 1
      const name = typeof data['name'] === 'string' ? data['name'] : undefined
      state.lastMarker = { kind: 'tool', name }
      return
    }
    case 'assistant/chunk': {
      const chunk = data['chunk'] as { type?: string } | undefined
      if (chunk?.type === 'reasoning-delta') state.lastMarker = { kind: 'reasoning' }
      else if (chunk?.type === 'text-delta') state.lastMarker = { kind: 'text' }
      return
    }
    case 'assistant/message': {
      const usage = data['usage'] as Record<string, unknown> | undefined
      if (usage === undefined) return
      state.usageByStep.set(`${String(data['turn'])}/${String(data['step'])}`, usageBuckets(usage))
      return
    }
    case 'turn/end': {
      state.phase = phaseOfTurnEnd(data['reason'] as SessionEvent<'turn/end'>['data']['reason'])
      state.epochEndedAt = now
      return
    }
    default:
      return
  }
}

/** Total tokens: the replace-per-step sum (the foldTokenBuckets rule). */
export function sumChildTokens(state: ChildAgentState): number {
  let total = 0
  for (const bucket of state.usageByStep.values()) {
    total += bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output
  }
  return total
}

/** The kimi-style activity line for non-terminal states. */
export function activityLine(state: ChildAgentState): string {
  const marker = state.lastMarker
  if (marker === undefined) return 'Starting…'
  if (marker.kind === 'tool') return `Using ${marker.name ?? 'tool'}`
  if (marker.kind === 'reasoning') return 'Thinking…'
  return 'Writing…'
}

/** The child session id a spawn-class ack text carries, when it does. */
export function childIdOfResult(item: TranscriptToolItem): string | undefined {
  if (item.result === undefined) return undefined
  const match = /started subagent ([a-f0-9-]{8,})/.exec(item.result.fullText ?? item.result.text)
  return match?.[1]
}

/** Whether a member correlates with a child: exact id first, then prompt. */
export function correlate(state: ChildAgentState, member: TranscriptToolItem): boolean {
  const id = childIdOfResult(member)
  if (id !== undefined) return id === state.id
  // Unparsed/null/scalar arguments all read as "no prompt key" here.
  const prompt = (member.parsedArguments as Record<string, unknown> | undefined)?.['prompt']
  return state.promptText !== undefined && prompt === state.promptText
}

/** The display phase over the child's epoch phase. */
function displayPhase(state: ChildAgentState): AgentMemberLive['phase'] {
  switch (state.phase) {
    case 'starting': return 'waiting'
    case 'running': return 'running'
    case 'completed': return 'completed'
    case 'aborted':
    case 'error':
    case 'max-tokens':
    case 'refusal': return 'failed'
  }
}

/** The live snapshot one group member renders from, or none. */
export function memberLiveSnapshot(state: ChildAgentState): AgentMemberLive {
  const phase = displayPhase(state)
  const tokens = sumChildTokens(state)
  return {
    phase,
    ...(state.epochEndedAt !== undefined ? { endedAt: state.epochEndedAt } : {}),
    ...(tokens > 0 ? { tokens } : {}),
    toolCount: state.toolCount,
    ...(phase === 'running' || phase === 'waiting' ? { activity: activityLine(state) } : {}),
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.effort !== undefined ? { effort: state.effort } : {}),
  }
}

/** The soft `ctx.get('sessions')` shape the seed reads (usage.ts precedent). */
interface SessionsServiceShape {
  list(): Iterable<{ id: string; header: { origin?: string; parentSession?: string } }>
}

/** The `Session` surface the seed reduces (structural, soft-typed). */
interface SeedSession {
  id: string
  header: { origin?: string; parentSession?: string }
  events: readonly SessionEvent[]
  firstLiveSeq: number
}

/**
 * Track this agent's subagent children. One global listener reduces every
 * admitted child's stream; `snapshot(member)` correlates a group member to
 * its child (exact ack id first, delegation prompt second). `dispose`
 * unsubscribes — the mounter wires it into the session disposer.
 */
export function trackChildAgents(
  ctx: Context,
  agent: { session: { id: string } },
  requestRender: () => void,
): { snapshot(member: TranscriptToolItem): AgentMemberLive | undefined; dispose(): void } {
  const children = new Map<string, ChildAgentState>()
  // The callers check `children` first; admission is create-or-reject.
  const admit = (
    id: string,
    header: { origin?: string; parentSession?: string },
    startedAt: number,
  ): ChildAgentState | undefined => {
    if (header.origin !== 'subagent' || header.parentSession !== agent.session.id) return undefined
    const state: ChildAgentState = { id, startedAt, phase: 'starting', toolCount: 0, usageByStep: new Map() }
    children.set(id, state)
    return state
  }
  // Seed from still-live children so an in-process remount (/theme) keeps
  // its stats: reduce each child's log from firstLiveSeq, which drops the
  // fork child's seeded parent-turn prefix.
  const sessions = ctx.get('sessions') as SessionsServiceShape | undefined
  if (sessions !== undefined) {
    for (const listed of sessions.list()) {
      const seed = listed as SeedSession
      if (seed.events === undefined || typeof seed.firstLiveSeq !== 'number') continue
      const seedLive = seed.events.filter(event => event.seq >= seed.firstLiveSeq)
      if (seedLive.length === 0) continue
      const state = admit(seed.id, seed.header, seedLive[0]!.time)
      if (state === undefined) continue
      for (const event of seedLive) deriveChildEvent(state, event, event.time)
    }
  }
  const off = ctx.on('session/event', (session, event) => {
    let state = children.get(session.id)
    if (state === undefined) {
      const header = session.header as { origin?: string; parentSession?: string }
      state = admit(session.id, header, event.time)
      if (state === undefined) return
    }
    deriveChildEvent(state, event, event.time)
    requestRender()
  })
  return {
    snapshot(member: TranscriptToolItem): AgentMemberLive | undefined {
      const id = childIdOfResult(member)
      if (id !== undefined) {
        const state = children.get(id)
        if (state === undefined) return undefined
        return memberLiveSnapshot(state)
      }
      for (const state of children.values()) {
        if (correlate(state, member)) return memberLiveSnapshot(state)
      }
      return undefined
    },
    dispose(): void {
      off()
      children.clear()
    },
  }
}
