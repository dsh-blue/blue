/**
 * The pure fold: event sequences to transcript items — streaming
 * accumulation, message finalization, tool pairing, and ignored events.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolResultView } from '@deepseek-ai/dsh-tools'
import { foldSessionEvents, TranscriptFolder } from '../src/fold.ts'
import type {
  TranscriptAssistantItem,
  TranscriptStepSummaryItem,
  TranscriptToolItem,
  TranscriptUserItem,
} from '../src/types.ts'
import { setStepFoldingEnabled } from '../src/window.ts'
import {
  assistantEvent,
  event,
  imageBlock,
  imageRef,
  reasoningDelta,
  resetSeq,
  stepEnd,
  stepStart,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  turnEnd,
  turnStart,
  userEvent,
} from './helpers.ts'

beforeEach(() => {
  resetSeq()
  setStepFoldingEnabled(undefined)
})

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

  it('suppresses todo_write calls and their results entirely', () => {
    // The todo pane owns the list's presentation, so the call and its
    // paired result render nothing — not even the unpaired fallback.
    const folder = new TranscriptFolder()
    expect(folder.apply(toolCallEvent(1, 1, 't1', 'todo_write', '{"todos":[]}'))).toBeNull()
    expect(folder.apply(toolResultEvent(1, 1, 't1', 'ok'))).toBeNull()
    // A result whose call id was never seen still renders unpaired; only a
    // suppressed call id suppresses its result.
    expect(folder.apply(toolResultEvent(1, 1, 'other', 'late'))?.isNew).toBe(true)
    expect(folder.items).toHaveLength(1)
    expect((folder.items[0] as TranscriptToolItem).name).toBe('tool')

    // Other tools pair as before, distinguished by name.
    const paired = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolCallEvent(1, 1, 't2', 'todo_write', '{}'),
      toolResultEvent(1, 1, 't2', 'ok'),
      toolResultEvent(1, 1, 'c1', 'out'),
    ])
    expect(paired).toHaveLength(1)
    expect((paired[0] as TranscriptToolItem).name).toBe('bash')
  })

  it('runs the result presenter for an unpaired result too', () => {
    const orphanView = { card: 'diff' }
    const folder = new TranscriptFolder({
      present: { result: () => orphanView as never },
    })
    const update = folder.apply(toolResultEvent(1, 1, 'orphan', 'done'))
    expect(update?.isNew).toBe(true)
    expect((folder.items[0] as TranscriptToolItem).view).toBe(orphanView)

    // A declining presenter leaves the unpaired item view-less.
    const declining = new TranscriptFolder({
      present: { result: () => undefined },
    })
    declining.apply(toolResultEvent(1, 1, 'orphan2', 'done'))
    expect('view' in (declining.items[0] as TranscriptToolItem)).toBe(false)
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

describe('turn and step tagging', () => {
  it('tags items with the current turn and step', () => {
    const items = foldSessionEvents([
      userEvent('before anything'),
      turnStart(1),
      stepStart(1, 1),
      userEvent('hi'),
      assistantEvent(1, 1, [{ type: 'text', text: 'answer' }]),
      toolCallEvent(1, 2, 'c1', 'bash', '{}'),
    ])
    expect(items.map(item => [item.turn, item.step])).toEqual([
      [0, undefined],
      [1, undefined],
      [1, 1],
      [1, 2],
    ])
  })

  it('tracks the turn across turn/start boundaries', () => {
    const items = foldSessionEvents([
      turnStart(1),
      userEvent('first'),
      turnEnd(1),
      turnStart(2),
      userEvent('second'),
    ])
    expect(items.map(item => item.turn)).toEqual([1, 2])
  })
})

describe('parsedArguments and view resolution', () => {
  it('sets parsedArguments for valid JSON and omits it for invalid', () => {
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'bash', '{"command":"ls"}'),
      toolCallEvent(1, 1, 'c2', 'bash', 'not json'),
    ])
    expect((items[0] as TranscriptToolItem).parsedArguments).toEqual({ command: 'ls' })
    expect('parsedArguments' in (items[1] as TranscriptToolItem)).toBe(false)
  })

  it('sets the view at call and replaces it at result, keeping it when the presenter declines', () => {
    const callView = { card: 'terminal' }
    const resultView = { card: 'terminal-done' } as ToolResultView
    const folder = new TranscriptFolder({
      present: {
        call: () => callView as never,
        result: (_name, args, result) => (args !== undefined && result.isError ? resultView as never : undefined),
      },
    })
    const call = folder.apply(toolCallEvent(1, 1, 'c1', 'bash', '{}'))
    expect(call && (call.item as TranscriptToolItem).view).toBe(callView)

    folder.apply(toolResultEvent(1, 1, 'c1', 'boom', { isError: true }))
    expect((folder.items[0] as TranscriptToolItem).view).toBe(resultView)

    // A declining result presenter keeps the call view.
    const keep = new TranscriptFolder({
      present: {
        call: () => callView as never,
        result: () => undefined,
      },
    })
    keep.apply(toolCallEvent(1, 1, 'c1', 'bash', '{}'))
    keep.apply(toolResultEvent(1, 1, 'c1', 'ok'))
    expect((keep.items[0] as TranscriptToolItem).view).toBe(callView)
  })
})

describe('rawResult reconstruction', () => {
  it('carries content, isError, and meta', () => {
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'edit', '{}'),
      toolResultEvent(1, 1, 'c1', 'text', { meta: '+1 -0' }),
    ])
    const raw = (items[0] as TranscriptToolItem).rawResult
    expect(raw?.isError).toBe(false)
    expect(raw?.meta).toBe('+1 -0')
    expect(JSON.stringify(raw?.content)).toContain('text')
  })

  it('omits meta when the event has none', () => {
    const items = foldSessionEvents([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', 'out'),
    ])
    const raw = (items[0] as TranscriptToolItem).rawResult
    expect(raw?.meta).toBeUndefined()
    expect(raw?.isError).toBe(false)
  })
})

describe('user images', () => {
  it('extracts image refs in block order and [] when none', () => {
    const plain = foldSessionEvents([userEvent('no images')])
    expect((plain[0] as TranscriptUserItem).images).toEqual([])

    const withImages = foldSessionEvents([
      userEvent('look', [
        imageBlock(imageRef('b1')),
        { type: 'text', text: 'and' },
        imageBlock(imageRef('b2', 'image/jpeg')),
      ]),
    ])
    const item = withImages[0] as TranscriptUserItem
    expect(item.images.map(ref => ref.id)).toEqual(['b1', 'b2'])
  })

  it('prunes only the owning callId entry when folding re-used ids', () => {
    const folder = new TranscriptFolder()
    for (const e of [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'dup', 'Read', '{}'),
      toolCallEvent(1, 1, 'dup', 'Edit', '{}'),
      stepStart(1, 2),
    ]) folder.apply(e)
    // The second call overwrote the first's mapping; folding must prune the
    // entry exactly once (only when it maps to the folded item itself).
    expect(folder.items.map(item => item.kind)).toEqual(['step-summary'])
    expect((folder.items[0] as TranscriptStepSummaryItem).toolNames).toEqual(['Read', 'Edit'])
  })
})

describe('evictThrough', () => {
  it('returns items at or below the turn, in session order, and prunes them', () => {
    const folder = new TranscriptFolder()
    folder.apply(turnStart(1))
    folder.apply(userEvent('one'))
    folder.apply(turnEnd(1))
    folder.apply(turnStart(2))
    folder.apply(userEvent('two'))
    const evicted = folder.evictThrough(1)
    expect(evicted.map(item => item.turn)).toEqual([1])
    expect(folder.items.map(item => item.turn)).toEqual([2])
    // Repeated eviction of the same frontier returns nothing.
    expect(folder.evictThrough(1)).toEqual([])
  })

  it('prunes toolsByCallId so an evicted call renders as an unpaired fallback', () => {
    const folder = new TranscriptFolder()
    folder.apply(turnStart(1))
    folder.apply(toolCallEvent(1, 1, 'c1', 'bash', '{}'))
    folder.evictThrough(1)
    const update = folder.apply(toolResultEvent(1, 1, 'c1', 'late result'))
    expect(update?.isNew).toBe(true)
    const item = folder.items.at(-1) as TranscriptToolItem
    expect(item.name).toBe('tool')
    expect(item.result?.text).toBe('late result')
  })

  it('prunes a streaming item evicted mid-step', () => {
    const folder = new TranscriptFolder()
    folder.apply(turnStart(1))
    folder.apply(textDelta(1, 1, 'partial'))
    folder.evictThrough(1)
    // The streaming slot is gone, so a later finalize for that step mounts a
    // fresh finalized item instead of mutating the evicted one.
    const update = folder.apply(assistantEvent(1, 1, [{ type: 'text', text: 'final' }]))
    expect(update?.isNew).toBe(true)
    expect(folder.items).toHaveLength(1)
  })
})

describe('in-turn step folding', () => {
  /** A turn with two tool-using steps and one final assistant-only step. */
  function foldTurn(events?: SessionEvent[]): TranscriptFolder {
    const folder = new TranscriptFolder()
    for (const e of events ?? [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'a1', 'Read', '{}'),
      toolCallEvent(1, 1, 'a2', 'Edit', '{}'),
      toolResultEvent(1, 1, 'a1', 'r1'),
      stepEnd(1, 1),
      stepStart(1, 2),
      toolCallEvent(1, 2, 'b1', 'Read', '{}'),
      stepEnd(1, 2),
      stepStart(1, 3),
      assistantEvent(1, 3, [{ type: 'text', text: 'done' }]),
      turnEnd(1),
    ]) folder.apply(e)
    return folder
  }

  it('folds the prior step tool items into one summary at the first item position', () => {
    const folder = foldTurn()
    const summary = folder.items.find(item => item.kind === 'step-summary') as TranscriptStepSummaryItem
    expect(summary).toBeDefined()
    expect(summary.step).toBe(1)
    // The summary sits where the first folded tool item was: before step 2's
    // remaining tool item and the final assistant item.
    expect(folder.items.indexOf(summary)).toBe(0)
    expect(summary.toolNames).toEqual(['Read', 'Edit'])
    // Step 2 also folded (step 3 followed it); its tools are gone too.
    expect(folder.items.filter(item => item.kind === 'tool')).toEqual([])
    const summaries = folder.items.filter(item => item.kind === 'step-summary') as TranscriptStepSummaryItem[]
    expect(summaries.map(item => item.step)).toEqual([1, 2])
  })

  it('keeps duplicate tool names in call order', () => {
    const folder = new TranscriptFolder()
    for (const e of [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'a1', 'Read', '{}'),
      toolCallEvent(1, 1, 'a2', 'Read', '{}'),
      toolCallEvent(1, 1, 'a3', 'Grep', '{}'),
      stepStart(1, 2),
    ]) folder.apply(e)
    const summary = folder.items[0] as TranscriptStepSummaryItem
    expect(summary.toolNames).toEqual(['Read', 'Read', 'Grep'])
  })

  it('returns null for a step with no tool items', () => {
    const folder = new TranscriptFolder()
    folder.apply(turnStart(1))
    folder.apply(stepStart(1, 1))
    folder.apply(assistantEvent(1, 1, [{ type: 'text', text: 'hi' }]))
    expect(folder.apply(stepStart(1, 2))).toBeNull()
    // The assistant item was not folded away.
    expect(folder.items.filter(item => item.kind === 'assistant')).toHaveLength(1)
  })

  it('excludes suppressed todo_write calls from the step summary', () => {
    const folder = new TranscriptFolder()
    for (const e of [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 't1', 'todo_write', '{}'),
      toolCallEvent(1, 1, 'a1', 'Read', '{}'),
      toolResultEvent(1, 1, 't1', 'ok'),
      stepStart(1, 2),
    ]) folder.apply(e)
    const summary = folder.items[0] as TranscriptStepSummaryItem
    expect(summary.kind).toBe('step-summary')
    expect(summary.toolNames).toEqual(['Read'])

    // A step whose every call was todo_write folds to nothing at all.
    const todoOnly = new TranscriptFolder()
    for (const e of [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 't2', 'todo_write', '{}'),
      toolResultEvent(1, 1, 't2', 'ok'),
      stepStart(1, 2),
    ]) todoOnly.apply(e)
    expect(todoOnly.items).toHaveLength(0)
  })

  it('never folds at step/end or turn/end — only the next step/start folds', () => {
    const folder = new TranscriptFolder()
    for (const e of [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'a1', 'Read', '{}'),
      stepEnd(1, 1),
      turnEnd(1),
    ]) folder.apply(e)
    // No next step/start arrived: the tool item survives both step/end and
    // turn/end; the turn's final step always stays expanded.
    const tools = folder.items.filter(item => item.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect((tools[0] as TranscriptToolItem).step).toBe(1)
  })

  it('does not fold across turns', () => {
    const folder = new TranscriptFolder()
    for (const e of [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'a1', 'Read', '{}'),
      turnEnd(1),
      turnStart(2),
      stepStart(2, 1),
    ]) folder.apply(e)
    expect(folder.items.filter(item => item.kind === 'step-summary')).toHaveLength(0)
    expect(folder.items.filter(item => item.kind === 'tool')).toHaveLength(1)
  })

  it('can be disabled via setStepFoldingEnabled(false)', () => {
    setStepFoldingEnabled(false)
    const folder = foldTurn()
    expect(folder.items.filter(item => item.kind === 'step-summary')).toHaveLength(0)
    expect(folder.items.filter(item => item.kind === 'tool')).toHaveLength(3)
  })

  it('prunes folded tools from toolsByCallId so late results render unpaired', () => {
    const folder = new TranscriptFolder()
    for (const e of [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'a1', 'Read', '{}'),
      stepStart(1, 2),
    ]) folder.apply(e)
    const update = folder.apply(toolResultEvent(1, 1, 'a1', 'late'))
    expect(update?.isNew).toBe(true)
    expect(folder.items.filter(item => item.kind === 'tool')).toHaveLength(1)
  })
})
