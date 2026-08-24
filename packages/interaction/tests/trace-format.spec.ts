/** Tests for the official session-query event presentation and clipboard format. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventRecord, SessionEventTraceObservation, SessionEventWindow } from '@deepseek-ai/dsh-session-query'
import { formatTraceAll, formatTraceItem, toTraceItem, traceSummary, traceTitle, traceTime } from '../src/trace-format.ts'

const event = (type: string, data: unknown): SessionEvent => ({ type, seq: 3, time: 1000, data } as SessionEvent)
const record: SessionEventRecord = { sessionId: 'session' as never, seq: 3, time: 1000, type: 'user/message', surface: 'current' }

describe('trace-format', () => {
  it('labels known and unknown event types', () => {
    expect(traceTitle('user/message')).toBe('User request')
    expect(traceTitle('assistant/chunk')).toBe('Thinking')
    expect(traceTitle('assistant/message')).toBe('Assistant answer')
    expect(traceTitle('tool/call')).toBe('Tool call')
    expect(traceTitle('tool/result')).toBe('Tool result')
    expect(traceTitle('turn/start')).toBe('Turn started')
    expect(traceTitle('turn/end')).toBe('Turn ended')
    expect(traceTitle('request/header')).toBe('Model configuration')
    expect(traceTitle('subagent/descriptor')).toBe('Subagent')
    expect(traceTitle('custom/event')).toBe('custom/event')
  })

  it('extracts semantic text, falls back to data, and handles empty data', () => {
    expect(traceSummary(event('user/message', { content: [{ type: 'text', text: ' hello  world ' }] }))).toBe('hello world')
    expect(traceSummary(event('custom/event', 'raw text'))).toBe('raw text')
    expect(traceSummary(event('custom/event', { value: 1 }))).toBe('{"value":1}')
    expect(traceSummary(event('custom/event', null))).toBe('')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(traceSummary(event('custom/event', cyclic))).toBe('[unserializable event payload]')
  })

  it('builds items and serializes relations and raw payload', () => {
    const item = toTraceItem(record, event('user/message', { content: [{ type: 'text', text: 'hello' }] }))
    expect(item).toMatchObject({ seq: 3, title: 'User request', summary: 'hello' })
    expect(traceTime(1000)).toBe('00:00:01')
    expect(traceTime(Number.NaN)).toBe('??:??:??')
    const relation = {
      session: { id: 'session' },
      target: record,
      replacedBy: 4,
      replacementChain: [4, 5],
      replacedEventSeqs: [1],
      sourceEventSeqs: [2],
      derivedEventSeqs: [6],
    } as unknown as SessionEventTraceObservation
    const window = { session: { id: 'session' }, target: event('user/message', {}), events: [], startSeq: 3, endSeq: 3 } as unknown as SessionEventWindow
    const text = formatTraceItem(item, window, relation)
    expect(text).toContain('replaced by: #4')
    expect(text).toContain('replacement chain: #4 -> #5')
    expect(text).toContain('sources: #2')
    expect(text).toContain('raw event:')
    expect(formatTraceAll([item], 'session')).toContain('# Trace\n\nSession: session')
    expect(formatTraceItem({ ...item, summary: '' }, undefined, undefined)).not.toContain('raw event:')
    expect(formatTraceAll([{ ...item, summary: '' }], 'session')).not.toContain('\n\nhello')
  })

  it('supports an item without an event payload', () => {
    expect(toTraceItem(record).summary).toBe('')
  })
})
