/**
 * Presentation helpers for the `/trace` session timeline. The data remains
 * owned by the official session-query service; this module only labels and
 * serializes one observation for terminal display or clipboard text.
 *
 * @module @dsh-blue/blue-interaction/trace-format
 */

import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventRecord, SessionEventTrace, SessionEventWindow } from '@deepseek-ai/dsh-session-query'

/** One display-ready event in the trace timeline. */
export interface TraceItem {
  readonly seq: number
  readonly lastSeq: number
  readonly eventSeqs: readonly number[]
  readonly time: number
  readonly type: string
  readonly surface: SessionEventRecord['surface']
  readonly title: string
  readonly summary: string
}

/** Convert an event type into a compact user-facing label. */
export function traceTitle(type: string): string {
  switch (type) {
    case 'user/message': return 'User request'
    case 'assistant/chunk': return 'Thinking'
    case 'assistant/message': return 'Assistant answer'
    case 'tool/call': return 'Tool call'
    case 'tool/result': return 'Tool result'
    case 'turn/start': return 'Turn started'
    case 'turn/end': return 'Turn ended'
    case 'request/header': return 'Model configuration'
    case 'subagent/descriptor': return 'Subagent'
    default: return type
  }
}

/** Build a one-line summary from the official semantic text extractor. */
export function traceSummary(event: SessionEvent): string {
  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (chunk.type === 'reasoning-delta' || chunk.type === 'text-delta') return chunk.text
  }
  const text = extractSessionEventText(event).replaceAll(/\s+/g, ' ').trim()
  if (text.length > 0) return text
  const data = event.data
  if (data === undefined || data === null) return ''
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch {
    return '[unserializable event payload]'
  }
}

/** Convert official event metadata into a display item. */
export function toTraceItem(record: SessionEventRecord, event?: SessionEvent): TraceItem {
  return {
    seq: record.seq,
    lastSeq: record.seq,
    eventSeqs: [record.seq],
    time: record.time,
    type: record.type,
    surface: record.surface,
    title: traceTitle(record.type),
    summary: event === undefined ? '' : traceSummary(event),
  }
}

/** Format a timestamp consistently across the panel and clipboard output. */
export function traceTime(time: number): string {
  const date = new Date(time)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 19) : '??:??:??'
}

/** Serialize one event and its official relationship trace for clipboard use. */
export function formatTraceItem(item: TraceItem, window: SessionEventWindow | undefined, relation: SessionEventTrace | undefined, rawEvents: readonly SessionEvent[] = []): string {
  const sequence = item.lastSeq === item.seq ? `#${String(item.seq)}` : `#${String(item.seq)}-${String(item.lastSeq)}`
  const lines = [`[${traceTime(item.time)}] ${sequence} ${item.title} (${item.type})`, `surface: ${item.surface}`]
  if (item.summary.length > 0) lines.push('', item.summary)
  if (relation !== undefined) {
    if (relation.replacedBy !== undefined) lines.push('', `replaced by: #${String(relation.replacedBy)}`)
    if (relation.replacementChain.length > 0) lines.push(`replacement chain: ${relation.replacementChain.map(seq => `#${String(seq)}`).join(' -> ')}`)
    if (relation.replacedEventSeqs.length > 0) lines.push(`replaces: ${relation.replacedEventSeqs.map(seq => `#${String(seq)}`).join(', ')}`)
    if (relation.sourceEventSeqs.length > 0) lines.push(`sources: ${relation.sourceEventSeqs.map(seq => `#${String(seq)}`).join(', ')}`)
    if (relation.derivedEventSeqs.length > 0) lines.push(`derived: ${relation.derivedEventSeqs.map(seq => `#${String(seq)}`).join(', ')}`)
  }
  if (window !== undefined) {
    lines.push('', 'raw event:', JSON.stringify(window.target, null, 2))
  } else if (rawEvents.length > 0) {
    lines.push('', 'raw events:', JSON.stringify(rawEvents, null, 2))
  }
  return lines.join('\n')
}

/** Serialize the complete timeline as stable Markdown for clipboard use. */
export function formatTraceAll(items: readonly TraceItem[], sessionId: string): string {
  const lines = [`# Trace`, '', `Session: ${sessionId}`, '']
  for (const item of items) {
    const sequence = item.lastSeq === item.seq ? `#${String(item.seq)}` : `#${String(item.seq)}-${String(item.lastSeq)}`
    lines.push(`## [${traceTime(item.time)}] ${sequence} ${item.title}`, '', `Type: ${item.type}`, `Surface: ${item.surface}`)
    if (item.summary.length > 0) lines.push('', item.summary)
    lines.push('')
  }
  return lines.join('\n')
}
