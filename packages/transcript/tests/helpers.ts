/**
 * Shared builders for transcript tests: valid `SessionEvent` literals over
 * hand-made message objects, without booting any harness service.
 */

import {
  CallId,
  MessageId,
  type AssistantMessage,
  type ContentBlock,
  type ImageBlock,
  type ToolResultMessage,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { BlueComponents, BlueImage, BlueMarkdown } from '@dsh-blue/blue-core'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

// Width truth is pi-tui itself (D48): the fake codepoint counters that used
// to live here were exact only for ASCII fixtures, so a CJK mis-budget that
// would trip the real width guard stayed green in tests (the D39 lesson).
// Tests now measure and truncate through the same implementations the
// renderer runs.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../../core/src/width.ts'
import { topRule } from '../../core/src/chrome.ts'

/**
 * Build a fake `BlueComponents` for transcript tests. `createMarkdown`
 * returns a minimal `BlueMarkdown`: `setText` stores the source, `render`
 * wraps it with the real `wrapTextWithAnsi` (no Markdown transform). The
 * editor and list factories are out of scope for the transcript and throw.
 */
export function fakeBlueComponents(): BlueComponents {
  return {
    createMarkdown(options = {}): BlueMarkdown {
      let text = options.text ?? ''
      return {
        setText(next: string): void {
          text = next
        },
        render(width: number): string[] {
          return wrapTextWithAnsi(text, width)
        },
        invalidate(): void {},
      }
    },
    createEditor(): never {
      throw new Error('fake createEditor is out of scope for transcript tests')
    },
    createImage(options: { data: Uint8Array }): BlueImage {
      return {
        render: () => [`<image ${options.data.length}B>`],
        invalidate(): void {},
      }
    },
    createSelectList(): never {
      throw new Error('fake createSelectList is out of scope for transcript tests')
    },
    createSettingsList(): never {
      throw new Error('fake createSettingsList is out of scope for transcript tests')
    },
    visibleWidth,
    wrapText: wrapTextWithAnsi,
    truncateToWidth,
    topRule,
  }
}

let seq = 0

/** Reset the synthetic seq counter so each spec starts at 0. */
export function resetSeq(): void {
  seq = 0
}

/** Build one event envelope with the next synthetic seq. */
export function event<T extends SessionEvent['type']>(
  type: T,
  data: SessionEvent<T>['data'],
  time?: number,
): SessionEvent<T> {
  seq += 1
  return { type, seq, time: time ?? 1_700_000_000_000 + seq, data } as SessionEvent<T>
}

/** A user message with the given content blocks. */
function userMessage(text: string, extra: ContentBlock[] = [], source?: UserMessage['source']): UserMessage {
  return {
    id: MessageId(`m-${seq}`),
    role: 'user',
    content: [{ type: 'text', text }, ...extra],
    source: source ?? { kind: 'user' },
  }
}

/** An assistant message with the given content blocks. */
function assistantMessage(content: ContentBlock[]): AssistantMessage {
  return {
    id: MessageId(`m-${seq}`),
    role: 'assistant',
    content,
    source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
  }
}

/** A tool-result message for `callId`. */
function toolResultMessage(callId: string, text: string, isError = false): ToolResultMessage {
  return {
    id: MessageId(`m-${seq}`),
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: CallId(callId), content: [{ type: 'text', text }], isError }],
    source: { kind: 'tool', callId: CallId(callId) },
  }
}

/** A `user/message` event; pass a source to fake a synthetic injection. */
export function userEvent(text: string, extra: ContentBlock[] = [], source?: UserMessage['source']): SessionEvent<'user/message'> {
  return event('user/message', userMessage(text, extra, source))
}

/** A `turn/start` event. */
export function turnStart(turn: number): SessionEvent<'turn/start'> {
  return event('turn/start', { turn })
}

/** A `step/start` event. */
export function stepStart(turn: number, step: number): SessionEvent<'step/start'> {
  return event('step/start', { turn, step })
}

/** A `step/end` event. */
export function stepEnd(turn: number, step: number): SessionEvent<'step/end'> {
  return event('step/end', { turn, step })
}

/**
 * A `turn/end` event.
 * @param turn - the turn closing.
 * @param reason - why it closed; defaults to `completed` (use
 *   `{ kind: 'aborted' }` for the Esc-interrupt shape).
 */
export function turnEnd(
  turn: number,
  reason: SessionEvent<'turn/end'>['data']['reason'] = { kind: 'completed' },
): SessionEvent<'turn/end'> {
  return event('turn/end', { turn, reason })
}

/** An image content block over an attachment ref. */
export function imageBlock(attachment: ImageBlock['attachment']): ContentBlock {
  return { type: 'image', attachment }
}

/** A minimal image attachment ref with just the id and media type. */
export function imageRef(id: string, mediaType = 'image/png'): ImageBlock['attachment'] {
  return { id, mediaType } as ImageBlock['attachment']
}

/** An `assistant/chunk` text-delta event. */
export function textDelta(turn: number, step: number, text: string): SessionEvent<'assistant/chunk'> {
  return event('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } })
}

/** An `assistant/chunk` reasoning-delta event. */
export function reasoningDelta(turn: number, step: number, text: string): SessionEvent<'assistant/chunk'> {
  return event('assistant/chunk', { turn, step, chunk: { type: 'reasoning-delta', index: 0, text } })
}

/** An `assistant/message` finalize event. */
export function assistantEvent(turn: number, step: number, content: ContentBlock[]): SessionEvent<'assistant/message'> {
  return event('assistant/message', { turn, step, message: assistantMessage(content) })
}

/** Blue's durable empty surface replacement for one retracted turn. */
export function retractionEvent(turn: number, step: number, start: number, end: number): SessionEvent<'assistant/message'> {
  const base = assistantEvent(turn, step, [])
  return {
    ...base,
    data: { ...base.data, interrupted: true },
    surfaceOp: { op: 'replace', start, end },
    sourceEventSeqs: [start, end].filter((seq, index, values) => values.indexOf(seq) === index),
  }
}

/** A `tool/call` event. */
export function toolCallEvent(turn: number, step: number, callId: string, name: string, args: string): SessionEvent<'tool/call'> {
  return event('tool/call', { turn, step, callId: CallId(callId), name, arguments: args })
}

/** A `tool/result` event. */
export function toolResultEvent(
  turn: number,
  step: number,
  callId: string,
  text: string,
  options: { isError?: boolean; meta?: SessionEvent<'tool/result'>['data']['meta']; error?: { name: string; code: string }; time?: number } = {},
): SessionEvent<'tool/result'> {
  return event('tool/result', {
    turn,
    step,
    message: toolResultMessage(callId, text, options.isError ?? false),
    ...(options.meta !== undefined ? { meta: options.meta } : {}),
    ...(options.error !== undefined ? { error: options.error } : {}),
  }, options.time)
}

/**
 * A spawn-class subagent `tool/call` with the harness arg shape (the S33
 * dogfood-verified `description` + `prompt` pair).
 */
export function subagentCallEvent(
  turn: number,
  step: number,
  callId: string,
  name: 'subagent' | 'subagent_fork',
  description: string,
  prompt: string,
  options: { time?: number } = {},
): SessionEvent<'tool/call'> {
  return event('tool/call', {
    turn,
    step,
    callId: CallId(callId),
    name,
    arguments: JSON.stringify({ description, prompt }),
  }, options.time)
}
