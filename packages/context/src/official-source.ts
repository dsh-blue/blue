/**
 * Narrow adapter over the official Harness session-projection read face.
 * It consumes only `snapshot()` and `onChanged()` and never exposes the
 * Session object outside this compatibility boundary.
 *
 * @module @dsh-blue/blue-context/official-source
 */

import type { ContextEvent, ContextSource, ContextTimelineCurrent, ContextTimelineEvent, ContextTimelineFacts, ContextTimelineRequest, OfficialContextProjection } from './types.ts'

const CONTEXT_KEYS = new Set(['contextTimeline', 'contextPressure', 'contextBreakdown', 'tokenUsage'])

/** Official session-projection service surface consumed by this adapter. */
export interface OfficialSessionProjectionService {
  snapshot(session: unknown): { readonly asOfSeq: number; readonly values: Readonly<Record<string, unknown>> }
  onChanged(listener: (session: unknown, key: string, value: unknown, seq: number) => void): () => void
}

/** Resolve a renderer-independent session id to the opaque Harness handle. */
export type ContextSessionResolver = (sessionId: string) => unknown | undefined

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function integer(value: unknown): number | undefined {
  const parsed = number(value)
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function usageOf(value: unknown): OfficialContextProjection['usage'] | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const input = number(row.uncachedInputTokens)
  const output = number(row.outputTokens)
  const cacheRead = number(row.cacheReadTokens)
  const cacheWrite = number(row.cacheWriteTokens)
  return input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined
    ? undefined
    : { input, output, cacheRead, cacheWrite }
}

function pressureOf(value: unknown): OfficialContextProjection['pressure'] | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const projectedTokens = number(row.projectedTokens)
  const pressureTokens = number(row.pressureTokens)
  const contextWindow = number(row.contextWindow)
  if (projectedTokens === undefined && pressureTokens === undefined && contextWindow === undefined) return undefined
  return {
    ...(projectedTokens === undefined ? {} : { projectedTokens }),
    ...(pressureTokens === undefined ? {} : { pressureTokens }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  }
}

function breakdownOf(value: unknown): OfficialContextProjection['breakdown'] | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const system = number(row.systemTokens)
  const tools = number(row.toolsTokens)
  const messages = number(row.messageTokens)
  return system === undefined || tools === undefined || messages === undefined
    ? undefined
    : { system, tools, messages }
}

function currentOf(value: unknown): ContextTimelineCurrent | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const system = number(row.system)
  const tools = number(row.tools)
  const user = number(row.user)
  const inject = number(row.inject)
  const assistant = number(row.assistant)
  const tool = number(row.tool)
  const total = number(row.total)
  return system === undefined || tools === undefined || user === undefined || inject === undefined || assistant === undefined || tool === undefined || total === undefined
    ? undefined
    : { system, tools, user, inject, assistant, tool, total }
}

function requestOf(value: unknown): ContextTimelineRequest | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const time = number(row.time)
  const seq = integer(row.seq)
  const total = number(row.total)
  if (time === undefined || seq === undefined || total === undefined) return undefined
  const turn = integer(row.turn)
  const step = integer(row.step)
  const prompt = number(row.prompt)
  const output = number(row.output)
  return {
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
    time,
    seq,
    total,
    ...(prompt === undefined ? {} : { prompt }),
    ...(output === undefined ? {} : { output }),
  }
}

function eventOf(value: unknown): ContextTimelineEvent | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const seq = integer(row.seq)
  const time = number(row.time)
  const kind = row.kind
  if (seq === undefined || time === undefined || (kind !== 'compaction' && kind !== 'prune' && kind !== 'inject' && kind !== 'model')) return undefined
  const form = text(row.form)
  const tokens = number(row.tokens)
  const count = integer(row.count)
  const name = text(row.name)
  const from = text(row.from)
  const to = text(row.to)
  return {
    seq,
    time,
    kind,
    ...(form === undefined ? {} : { form }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(count === undefined ? {} : { count }),
    ...(name === undefined ? {} : { name }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  }
}

function timelineOf(value: unknown): ContextTimelineFacts | undefined {
  const row = record(value)
  const current = currentOf(row?.current)
  if (row === undefined || current === undefined) return undefined
  const requests = Array.isArray(row.requests) ? row.requests.flatMap(item => {
    const request = requestOf(item)
    return request === undefined ? [] : [request]
  }) : []
  const events = Array.isArray(row.events) ? row.events.flatMap(item => {
    const event = eventOf(item)
    return event === undefined ? [] : [event]
  }) : []
  const model = text(row.model)
  const provider = text(row.provider)
  return {
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    current,
    requests,
    events,
    droppedNodes: integer(row.droppedNodes) ?? 0,
    images: integer(row.images) ?? 0,
  }
}

/**
 * Map the official whole-value projection table to one idempotent Blue event.
 * Invalid or absent keys degrade independently so one plugin cannot poison the
 * token-meter values owned by another plugin.
 *
 * @param values - official projection values at one consistent cut.
 * @returns a Blue event, or undefined when no context value is available.
 */
export function officialContextEvent(values: Readonly<Record<string, unknown>>): ContextEvent | undefined {
  const usage = usageOf(values.tokenUsage)
  const pressure = pressureOf(values.contextPressure)
  const breakdown = breakdownOf(values.contextBreakdown)
  const timeline = timelineOf(values.contextTimeline)
  if (usage === undefined && pressure === undefined && breakdown === undefined && timeline === undefined) return undefined
  return {
    type: 'official',
    official: {
      complete: true,
      ...(usage === undefined ? {} : { usage }),
      ...(pressure === undefined ? {} : { pressure }),
      ...(breakdown === undefined ? {} : { breakdown }),
      ...(timeline === undefined ? {} : { timeline }),
    },
  }
}

interface Listener {
  readonly afterWatermark: number
  readonly accept: (event: { readonly seq: number; readonly sessionId: string; readonly event: ContextEvent }) => void
}

/**
 * Context source over the official projection registry. Change notifications
 * are microtask-coalesced per session because the registry emits once per key
 * while driving one committed event; the delayed snapshot is the consistent
 * whole-value cut after every unit has advanced.
 */
export class OfficialContextSource implements ContextSource {
  readonly capabilities = ['context', 'breakdown', 'status'] as const
  private readonly sessionIds = new Map<unknown, string>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly buffered = new Map<string, { readonly seq: number; readonly event: ContextEvent }>()
  private readonly scheduled = new Map<unknown, number>()
  private readonly offChanged: () => void
  private disposed = false

  constructor(private readonly service: OfficialSessionProjectionService, private readonly resolveSession: ContextSessionResolver) {
    this.offChanged = service.onChanged((session, key, _value, seq) => {
      if (!this.disposed && CONTEXT_KEYS.has(key)) this.schedule(session, seq)
    })
  }

  async snapshot(sessionId: string, signal: AbortSignal): Promise<{ readonly watermark: number; readonly events: readonly ContextEvent[] }> {
    if (signal.aborted) throw new Error('Context projection attach aborted')
    const session = this.resolveSession(sessionId)
    if (session === undefined) throw new Error(`Context session ${JSON.stringify(sessionId)} is unavailable`)
    this.sessionIds.set(session, sessionId)
    const snapshot = this.service.snapshot(session)
    const event = officialContextEvent(snapshot.values)
    return { watermark: snapshot.asOfSeq, events: event === undefined ? [] : [event] }
  }

  subscribe(sessionId: string, afterWatermark: number, accept: Listener['accept']): () => void {
    const listener: Listener = { afterWatermark, accept }
    const listeners = this.listeners.get(sessionId) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(sessionId, listeners)
    const buffered = this.buffered.get(sessionId)
    if (buffered !== undefined) {
      this.buffered.delete(sessionId)
      if (buffered.seq > afterWatermark) accept({ sessionId, seq: buffered.seq, event: buffered.event })
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(sessionId)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.offChanged()
    this.sessionIds.clear()
    this.listeners.clear()
    this.buffered.clear()
    this.scheduled.clear()
  }

  private schedule(session: unknown, seq: number): void {
    const previous = this.scheduled.get(session)
    this.scheduled.set(session, previous === undefined ? seq : Math.max(previous, seq))
    if (previous !== undefined) return
    queueMicrotask(() => {
      const scheduledSeq = this.scheduled.get(session)
      this.scheduled.delete(session)
      if (this.disposed || scheduledSeq === undefined) return
      const sessionId = this.sessionIds.get(session)
      if (sessionId === undefined) return
      const snapshot = this.service.snapshot(session)
      const event = officialContextEvent(snapshot.values)
      if (event === undefined) return
      this.publish(sessionId, Math.max(scheduledSeq, snapshot.asOfSeq), event)
    })
  }

  private publish(sessionId: string, seq: number, event: ContextEvent): void {
    const listeners = this.listeners.get(sessionId)
    if (listeners === undefined || listeners.size === 0) {
      const previous = this.buffered.get(sessionId)
      if (previous === undefined || seq >= previous.seq) this.buffered.set(sessionId, { seq, event })
      return
    }
    for (const listener of listeners) {
      if (seq > listener.afterWatermark) listener.accept({ sessionId, seq, event })
    }
  }
}
