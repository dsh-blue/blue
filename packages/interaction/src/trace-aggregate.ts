/**
 * Canonical trace grouping over the official session event snapshot. This is
 * the read-only equivalent of transcript/fold's per-turn/step streaming
 * slots: reasoning and text deltas become one display item per stream.
 *
 * @module @dsh-blue/blue-interaction/trace-aggregate
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventRecord } from '@deepseek-ai/dsh-session-query'
import { traceSummary, traceTitle, type TraceItem } from './trace-format.ts'

/** Build timeline items, merging assistant chunks by turn, step, and stream type. */
export function aggregateTraceItems(records: readonly SessionEventRecord[], events: readonly SessionEvent[]): TraceItem[] {
  const items: TraceItem[] = []
  const streams = new Map<string, TraceItem>()
  const finalized = new Set<string>()
  for (const [index, record] of records.entries()) {
    const event = events[index]
    if (event?.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type !== 'reasoning-delta' && chunk.type !== 'text-delta') continue
      const key = `${String(event.data.turn)}:${String(event.data.step)}:${chunk.type}`
      if (finalized.has(`${String(event.data.turn)}:${String(event.data.step)}`)) continue
      const existing = streams.get(key)
      if (existing !== undefined) {
        const next = { ...existing, lastSeq: record.seq, eventSeqs: [...existing.eventSeqs, record.seq], summary: `${existing.summary}${chunk.text}` }
        items[items.indexOf(existing)] = next
        streams.set(key, next)
      } else {
        const item = { ...recordItem(record, event), summary: chunk.text }
        items.push(item)
        streams.set(key, item)
      }
      continue
    }
    if (event?.type === 'assistant/message') {
      finalized.add(`${String(event.data.turn)}:${String(event.data.step)}`)
    }
    items.push(recordItem(record, event))
  }
  return items
}

function recordItem(record: SessionEventRecord, event: SessionEvent | undefined): TraceItem {
  const summary = event === undefined ? '' : traceSummary(event)
  const title = event?.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta' ? 'Assistant draft' : traceTitle(record.type)
  return {
    seq: record.seq,
    lastSeq: record.seq,
    eventSeqs: [record.seq],
    time: record.time,
    type: record.type,
    surface: record.surface,
    title,
    summary,
  }
}

