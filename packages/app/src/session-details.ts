/**
 * App-owned folding for the renderer-neutral session details snapshot. Raw
 * Harness events and projection registry values stay inside blue-app; the
 * interaction layer receives only immutable counts and usage facts.
 *
 * @module @dsh-blue/blue-app/session-details
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  BlueSessionCompositionFacts,
  BlueSessionDetails,
  BlueSessionModelSelection,
  BlueSessionTokenBuckets,
} from './types.ts'

/** Counts, usage, and optional official composition behind one snapshot. */
interface SessionDetailFacts {
  readonly turns: number
  readonly steps: number
  readonly usage: BlueSessionDetails['usage']
  readonly composition?: BlueSessionCompositionFacts | undefined
}

/** Structural current Agent surface needed by the details projection. */
export interface SessionDetailsAgent {
  readonly id: unknown
  readonly status: unknown
  readonly session: {
    readonly header: { readonly id?: unknown, readonly cwd?: string, readonly createdAt?: number }
    readonly events: readonly SessionEvent[]
    requestContext(): { readonly contextWindow?: number } | undefined
  }
}

/** Structural values from one official session-projection snapshot. */
export type SessionProjectionValues = Readonly<Record<string, unknown>>

/** The zero provider-usage buckets. */
const NO_USAGE: BlueSessionTokenBuckets = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

/** Read one assistant usage sample and its replace-per-step identity. */
function usageOf(event: SessionEvent):
  | { turn: number, step: number, usage: { inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number } }
  | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/**
 * Fold provider usage with the official replace-per-step semantics.
 * @param events - complete current-session event log.
 * @returns cumulative disjoint token buckets.
 */
export function foldSessionTokenBuckets(events: readonly SessionEvent[]): BlueSessionTokenBuckets {
  const last = new Map<string, BlueSessionTokenBuckets>()
  for (const event of events) {
    const record = usageOf(event)
    if (record === undefined) continue
    last.set(`${String(record.turn)}/${String(record.step)}`, {
      input: record.usage.inputTokens,
      cacheRead: record.usage.cacheReadTokens ?? 0,
      cacheWrite: record.usage.cacheWriteTokens ?? 0,
      output: record.usage.outputTokens,
    })
  }
  let input = 0
  let cacheRead = 0
  let cacheWrite = 0
  let output = 0
  for (const buckets of last.values()) {
    input += buckets.input
    cacheRead += buckets.cacheRead
    cacheWrite += buckets.cacheWrite
    output += buckets.output
  }
  return { input, cacheRead, cacheWrite, output }
}

/** Build fallback counts and context facts directly inside the app boundary. */
function fallbackFacts(agent: SessionDetailsAgent): SessionDetailFacts {
  let turns = 0
  let steps = 0
  let used: number | undefined
  for (const event of agent.session.events) {
    if (event.type === 'turn/start') turns += 1
    else if (event.type === 'step/end') steps += 1
    const record = usageOf(event)
    if (record !== undefined) {
      used = record.usage.inputTokens
        + (record.usage.cacheReadTokens ?? 0)
        + (record.usage.cacheWriteTokens ?? 0)
    }
  }
  const window = agent.session.requestContext()?.contextWindow
  return {
    turns,
    steps,
    usage: {
      buckets: foldSessionTokenBuckets(agent.session.events),
      context: {
        ...(used === undefined ? {} : { used }),
        ...(window === undefined ? {} : { window }),
      },
    },
  }
}

/** Build counts and usage from official projection values. */
function projectedFacts(values: SessionProjectionValues, fallback: SessionDetailFacts): SessionDetailFacts {
  const usage = values.tokenUsage as {
    readonly uncachedInputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly cacheWriteTokens: number
  } | undefined
  const pressure = values.contextPressure as {
    readonly pressureTokens?: number
    readonly projectedTokens?: number
    readonly contextWindow?: number
  } | undefined
  const stats = values.sessionStats as { readonly turns: number, readonly steps: number } | undefined
  const breakdown = values.contextBreakdown as {
    readonly systemTokens: number
    readonly toolsTokens: number
    readonly messageTokens: number
  } | undefined
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const window = pressure?.contextWindow
  return {
    turns: stats?.turns ?? fallback.turns,
    steps: stats?.steps ?? fallback.steps,
    usage: {
      buckets: usage === undefined
        ? NO_USAGE
        : {
            input: usage.uncachedInputTokens,
            cacheRead: usage.cacheReadTokens,
            cacheWrite: usage.cacheWriteTokens,
            output: usage.outputTokens,
          },
      context: {
        ...(used === undefined ? {} : { used }),
        ...(window === undefined ? {} : { window }),
      },
    },
    ...(breakdown === undefined
      ? {}
      : {
          composition: {
            system: breakdown.systemTokens,
            tools: breakdown.toolsTokens,
            messages: breakdown.messageTokens,
          },
        }),
  }
}

/**
 * Create the immutable session-details value consumed by interaction.
 * @param agent - current Agent, retained inside blue-app.
 * @param selection - current renderer-neutral model route.
 * @param values - official projection values, absent on degraded hosts.
 * @returns the renderer-neutral detail snapshot.
 */
export function sessionDetails(
  agent: SessionDetailsAgent,
  selection: BlueSessionModelSelection | undefined,
  values: SessionProjectionValues | undefined,
): BlueSessionDetails {
  const fallback = fallbackFacts(agent)
  const facts = values === undefined ? fallback : projectedFacts(values, fallback)
  const header = agent.session.header
  return {
    header: {
      id: String(header.id ?? agent.id),
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
    },
    turns: facts.turns,
    steps: facts.steps,
    status: String(agent.status),
    ...(selection === undefined ? {} : { model: selection }),
    usage: facts.usage,
    ...facts.composition === undefined ? {} : { composition: facts.composition },
  }
}
