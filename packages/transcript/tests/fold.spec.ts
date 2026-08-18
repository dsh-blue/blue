/**
 * The pure fold: event sequences to transcript items — streaming
 * accumulation, message finalization, tool pairing, and ignored events.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionEvents, TranscriptFolder } from '../src/fold.ts'
import type { TranscriptAssistantItem, TranscriptToolItem, TranscriptUserItem } from '../src/types.ts'
import {
  assistantEvent,
  event,
  reasoningDelta,
  resetSeq,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  userEvent,
} from './helpers.ts'

beforeEach(resetSeq)

describe('foldSessionEvents', () => {
  it('folds a user message into a user item', () => {
    const items = foldSessionEvents([userEvent('hello world')])
    expect(items).toHaveLength(1)
    const item = items[0] as TranscriptUserItem
    expect(item.kind).toBe('user')
    expect(item.text).toBe('hello world')
    expect(item.seq).toBe(1)
  })

  it('folds non-text user content to placeholders and skips empty messages', () => {
    const withImage = userEvent('look', [{ type: 'image', attachment: { id: 'a1' } as never }])
    const imageOnly = userEvent('', [{ type: 'image', attachment: { id: 'a2' } as never }])
    const empty = userEvent('   ')
    const items = foldSessionEvents([withImage, imageOnly, empty])
    expect(items).toHaveLength(2)
    expect((items[0] as TranscriptUserItem).text).toBe('look\n[image]')
    expect((items[1] as TranscriptUserItem).text).toBe('[image]')
  })

  it('accumulates streaming chunks into one assistant item per step', () => {
    const folder = new TranscriptFolder()
    const first = folder.apply(textDelta(1, 1, 'Hello'))
    expect(first?.isNew).toBe(true)
    const second = folder.apply(textDelta(1, 1, ', world'))
    expect(second?.isNew).toBe(false)
    const item = second?.item as TranscriptAssistantItem
    expect(item.text).toBe('Hello, world')
    expect(item.streaming).toBe(true)
    expect(folder.items).toHaveLength(1)
  })

  it('starts a new assistant item when the step changes', () => {
    const folder = new TranscriptFolder()
    folder.apply(textDelta(1, 1, 'one'))
    const next = folder.apply(textDelta(1, 2, 'two'))
    expect(next?.isNew).toBe(true)
    expect(folder.items).toHaveLength(2)
    expect((folder.items[0] as TranscriptAssistantItem).text).toBe('one')
    expect((folder.items[1] as TranscriptAssistantItem).text).toBe('two')
  })

  it('accumulates reasoning deltas separately from visible text', () => {
    const folder = new TranscriptFolder()
    folder.apply(reasoningDelta(1, 1, 'thinking'))
    const update = folder.apply(textDelta(1, 1, 'answer'))
    const item = update?.item as TranscriptAssistantItem
    expect(item.reasoning).toBe('thinking')
    expect(item.text).toBe('answer')
  })

  it('ignores non-delta chunk types', () => {
    const folder = new TranscriptFolder()
    const update = folder.apply(event('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }))
    expect(update).toBeNull()
    expect(folder.items).toHaveLength(0)
  })

  it('finalizes a streaming item from the authoritative assistant message', () => {
    const folder = new TranscriptFolder()
    folder.apply(textDelta(1, 1, 'partial'))
    folder.apply(reasoningDelta(1, 1, 'draft'))
    const update = folder.apply(assistantEvent(1, 1, [
      { type: 'reasoning', text: 'final thought' },
      { type: 'text', text: 'final text' },
      { type: 'tool-call', id: 'c1' as never, name: 'bash', arguments: '{}' },
    ]))
    expect(update?.isNew).toBe(false)
    const item = update?.item as TranscriptAssistantItem
    expect(item.text).toBe('final text')
    expect(item.reasoning).toBe('final thought')
    expect(item.streaming).toBe(false)
    expect(folder.items).toHaveLength(1)
  })

  it('creates a finalized assistant item when no chunks were seen', () => {
    const update = new TranscriptFolder().apply(assistantEvent(2, 1, [{ type: 'text', text: 'from history' }]))
    expect(update?.isNew).toBe(true)
    const item = update?.item as TranscriptAssistantItem
    expect(item.text).toBe('from history')
    expect(item.streaming).toBe(false)
  })

  it('ignores chunks arriving after the step finalized', () => {
    const folder = new TranscriptFolder()
    folder.apply(assistantEvent(1, 1, [{ type: 'text', text: 'done' }]))
    expect(folder.apply(textDelta(1, 1, 'late'))).toBeNull()
    expect((folder.items[0] as TranscriptAssistantItem).text).toBe('done')
  })

  it('pairs tool/call and tool/result by callId', () => {
    const folder = new TranscriptFolder()
    const call = folder.apply(toolCallEvent(1, 1, 'call-1', 'bash', '{"command":"ls"}'))
    expect(call?.isNew).toBe(true)
    const result = folder.apply(toolResultEvent(1, 1, 'call-1', 'file.txt'))
    expect(result?.isNew).toBe(false)
    const item = result?.item as TranscriptToolItem
    expect(item.name).toBe('bash')
    expect(item.arguments).toBe('{"command":"ls"}')
    expect(item.result?.text).toBe('file.txt')
    expect(item.result?.isError).toBe(false)
    expect(folder.items).toHaveLength(1)
  })

  it('marks error results from the block flag or the error identity', () => {
    const byFlag = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', 'boom', { isError: true }),
    ])
    expect((byFlag[0] as TranscriptToolItem).result?.isError).toBe(true)

    const byError = foldSessionEvents([
      toolCallEvent(1, 1, 'c2', 'bash', '{}'),
      toolResultEvent(1, 1, 'c2', 'boom', { error: { name: 'ToolError', code: 'X' } }),
    ])
    expect((byError[0] as TranscriptToolItem).result?.isError).toBe(true)
  })

  it('prefers a string meta payload as the result summary', () => {
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'edit', '{}'),
      toolResultEvent(1, 1, 'c1', 'model-facing text', { meta: '+3 -1 lines in src/a.ts' }),
    ])
    expect((items[0] as TranscriptToolItem).result?.text).toBe('+3 -1 lines in src/a.ts')
  })

  it('ignores structured meta and summarizes the result content', () => {
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'edit', '{}'),
      toolResultEvent(1, 1, 'c1', 'raw result', { meta: { diff: '...' } }),
    ])
    expect((items[0] as TranscriptToolItem).result?.text).toBe('raw result')
  })

  it('ellipsizes long result summaries to one line', () => {
    const long = `line one\n${'x'.repeat(200)}`
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', long),
    ])
    const text = (items[0] as TranscriptToolItem).result?.text ?? ''
    expect(text).not.toContain('\n')
    expect(text.length).toBe(160)
    expect(text.endsWith('…')).toBe(true)
    expect(text.startsWith('line one ')).toBe(true)
  })

  it('keeps the unsummarized result text as fullText for expansion', () => {
    const long = `line one\n${'x'.repeat(200)}`
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', long),
    ])
    const result = (items[0] as TranscriptToolItem).result
    expect(result?.fullText).toBe(long)
    expect(result?.text).not.toBe(result?.fullText)
  })

  it('keeps a winning string meta payload as fullText', () => {
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'edit', '{}'),
      toolResultEvent(1, 1, 'c1', 'model-facing text', { meta: '+3 -1 lines\nin src/a.ts' }),
    ])
    const result = (items[0] as TranscriptToolItem).result
    expect(result?.fullText).toBe('+3 -1 lines\nin src/a.ts')
    expect(result?.text).toBe('+3 -1 lines in src/a.ts')
  })

  it('renders an unpaired tool result as its own item', () => {
    const items = foldSessionEvents([toolResultEvent(1, 1, 'orphan', 'done')])
    expect(items).toHaveLength(1)
    const item = items[0] as TranscriptToolItem
    expect(item.kind).toBe('tool')
    expect(item.name).toBe('tool')
    expect(item.result?.text).toBe('done')
  })

  it('ignores boundary, log-only, and unknown event types', () => {
    const events = [
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      event('step/end', { turn: 1, step: 1 }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event('todo/write', { todos: [] }),
      event('session/end-seed', {}),
      { type: 'plugin/extension', seq: 99, time: 0, data: {} } as unknown as SessionEvent,
    ]
    expect(foldSessionEvents(events)).toHaveLength(0)
  })
})
