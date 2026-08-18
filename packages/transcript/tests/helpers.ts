/**
 * Shared builders for transcript tests: valid `SessionEvent` literals over
 * hand-made message objects, without booting any harness service.
 */

import {
  CallId,
  MessageId,
  type AssistantMessage,
  type ContentBlock,
  type ToolResultMessage,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

let seq = 0

/** Reset the synthetic seq counter so each spec starts at 0. */
export function resetSeq(): void {
  seq = 0
}

/** Build one event envelope with the next synthetic seq. */
export function event<T extends SessionEvent['type']>(type: T, data: SessionEvent<T>['data']): SessionEvent<T> {
  seq += 1
  return { type, seq, time: 1_700_000_000_000 + seq, data } as SessionEvent<T>
}

/** A user message with the given content blocks. */
function userMessage(text: string, extra: ContentBlock[] = []): UserMessage {
  return {
    id: MessageId(`m-${seq}`),
    role: 'user',
    content: [{ type: 'text', text }, ...extra],
    source: { kind: 'user' },
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

/** A `user/message` event. */
export function userEvent(text: string, extra: ContentBlock[] = []): SessionEvent<'user/message'> {
  return event('user/message', userMessage(text, extra))
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
  options: { isError?: boolean; meta?: SessionEvent<'tool/result'>['data']['meta']; error?: { name: string; code: string } } = {},
): SessionEvent<'tool/result'> {
  return event('tool/result', {
    turn,
    step,
    message: toolResultMessage(callId, text, options.isError ?? false),
    ...(options.meta !== undefined ? { meta: options.meta } : {}),
    ...(options.error !== undefined ? { error: options.error } : {}),
  })
}
