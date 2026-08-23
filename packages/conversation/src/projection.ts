/**
 * Pure, state-versioned projection from committed Harness session events to
 * an append-origin human conversation. The registry owns all subscription,
 * watermark, checkpoint, and Fiber lifecycle behavior.
 *
 * @module @dsh-blue/blue-conversation/projection
 */

import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import { isAppendSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type {
  ConversationAssistantEntry,
  ConversationEntry,
  ConversationImage,
  ConversationJson,
  ConversationProjection,
  ConversationProjectionState,
  ConversationThinkingEntry,
  ConversationToolEntry,
} from './types.ts'

const jsonSchema: z.ZodType<ConversationJson> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(jsonSchema),
  z.record(z.string(), jsonSchema),
]))

const imageSchema = z.object({
  attachmentId: z.string(),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.number().nonnegative(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  name: z.string().optional(),
  originalDimensions: z.object({ width: z.number().nonnegative(), height: z.number().nonnegative() }).optional(),
})

const entryBase = {
  id: z.string(),
  seq: z.number().int(),
  turn: z.number().int().nonnegative(),
}

const conversationEntriesSchema = z.array(z.discriminatedUnion('kind', [
  z.object({ ...entryBase, kind: z.literal('user'), text: z.string(), images: z.array(imageSchema) }),
  z.object({ ...entryBase, kind: z.literal('assistant'), step: z.number().int().nonnegative(), text: z.string(), streaming: z.boolean() }),
  z.object({ ...entryBase, kind: z.literal('thinking'), step: z.number().int().nonnegative(), text: z.string(), streaming: z.boolean() }),
  z.object({
    ...entryBase,
    kind: z.literal('tool'),
    step: z.number().int().nonnegative(),
    callId: z.string(),
    name: z.string(),
    arguments: z.string(),
    startedAt: z.number(),
    channel: z.union([z.literal('transcript'), z.literal('todo'), z.literal('agents')]),
    result: z.object({
      content: z.array(jsonSchema),
      text: z.string(),
      isError: z.boolean(),
      endedAt: z.number(),
      meta: jsonSchema.optional(),
    }).optional(),
  }),
  z.object({ ...entryBase, kind: z.literal('error'), message: z.string(), code: z.string().optional() }),
  z.object({ ...entryBase, kind: z.literal('interrupted') }),
]))

/** Runtime schema for the client-visible conversation value. */
export const conversationProjectionSchema = z.object({
  entries: conversationEntriesSchema,
  streaming: z.boolean(),
}) satisfies z.ZodType<ConversationProjection>

/** Runtime schema for persisted projection checkpoints. */
export const conversationProjectionStateSchema = z.object({
  entries: conversationEntriesSchema,
  currentTurn: z.number().int().nonnegative(),
  active: z.boolean(),
  streamingStep: z.string().nullable(),
  streamingAssistantId: z.string().nullable(),
  streamingThinkingId: z.string().nullable(),
  pendingReasoning: z.string(),
  finalizedSteps: z.array(z.string()),
  interruptedTurns: z.array(z.number().int().nonnegative()),
  toolEntryIds: z.record(z.string(), z.string()),
}) satisfies z.ZodType<ConversationProjectionState>

/** Empty-log state for the conversation projection. */
export function initialConversationState(): ConversationProjectionState {
  return {
    entries: [],
    currentTurn: 0,
    active: false,
    streamingStep: null,
    streamingAssistantId: null,
    streamingThinkingId: null,
    pendingReasoning: '',
    finalizedSteps: [],
    interruptedTurns: [],
    toolEntryIds: {},
  }
}

function visibleText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && block.text !== '') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
    else if (block.type === 'tool-result') parts.push(visibleText(block.content))
  }
  return parts.filter(Boolean).join('\n')
}

function reasoningText(content: readonly ContentBlock[]): string {
  return content.filter(block => block.type === 'reasoning').map(block => block.text).join('\n\n')
}

function imagesOf(content: readonly ContentBlock[]): ConversationImage[] {
  return content
    .filter((block): block is ImageBlock => block.type === 'image')
    .map(({ attachment }) => ({
      attachmentId: String(attachment.attachmentId),
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
      width: attachment.width,
      height: attachment.height,
      ...(attachment.name === undefined ? {} : { name: attachment.name }),
      ...(attachment.originalDimensions === undefined ? {} : { originalDimensions: { ...attachment.originalDimensions } }),
    }))
}

function stepKey(turn: number, step: number): string {
  return `${String(turn)}:${String(step)}`
}

function entryIndex(entries: readonly ConversationEntry[], id: string | null): number {
  return id === null ? -1 : entries.findIndex(entry => entry.id === id)
}

function replaceEntry(
  state: ConversationProjectionState,
  id: string,
  replace: (entry: ConversationEntry) => ConversationEntry,
): ConversationProjectionState {
  const index = entryIndex(state.entries, id)
  if (index < 0) return state
  const entries = [...state.entries]
  entries[index] = replace(entries[index]!)
  return { ...state, entries }
}

function settleStreaming(state: ConversationProjectionState): ConversationProjectionState {
  let next = state
  if (state.streamingThinkingId !== null) {
    next = replaceEntry(next, state.streamingThinkingId, entry => entry.kind === 'thinking' ? { ...entry, streaming: false } : entry)
  }
  if (state.streamingAssistantId !== null) {
    next = replaceEntry(next, state.streamingAssistantId, entry => entry.kind === 'assistant' ? { ...entry, streaming: false } : entry)
  }
  if (next.streamingStep === null && next.streamingAssistantId === null && next.streamingThinkingId === null && next.pendingReasoning === '') return next
  return {
    ...next,
    streamingStep: null,
    streamingAssistantId: null,
    streamingThinkingId: null,
    pendingReasoning: '',
  }
}

function toolChannel(name: string): ConversationToolEntry['channel'] {
  if (name === 'todo_write') return 'todo'
  if (name === 'subagent' || name === 'subagent_fork') return 'agents'
  return 'transcript'
}

function appendEntry(state: ConversationProjectionState, entry: ConversationEntry): ConversationProjectionState {
  return { ...state, entries: [...state.entries, entry] }
}

function openStreamingStep(state: ConversationProjectionState, turn: number, step: number): ConversationProjectionState {
  const key = stepKey(turn, step)
  if (state.streamingStep === key) return state
  const settled = settleStreaming(state)
  return {
    ...settled,
    currentTurn: turn,
    active: true,
    streamingStep: key,
    streamingAssistantId: null,
    streamingThinkingId: null,
    pendingReasoning: '',
  }
}

function applyReasoningChunk(
  state: ConversationProjectionState,
  event: SessionEvent<'assistant/chunk'>,
  text: string,
): ConversationProjectionState {
  if (state.streamingThinkingId !== null) {
    return replaceEntry(state, state.streamingThinkingId, entry => entry.kind === 'thinking'
      ? { ...entry, text: entry.text + text }
      : entry)
  }
  const pendingReasoning = state.pendingReasoning + text
  if (pendingReasoning.trim() === '') return { ...state, pendingReasoning }
  const id = `thinking:${stepKey(event.data.turn, event.data.step)}`
  const entry: ConversationThinkingEntry = {
    kind: 'thinking',
    id,
    seq: event.seq,
    turn: event.data.turn,
    step: event.data.step,
    text: pendingReasoning,
    streaming: true,
  }
  const entries = [...state.entries]
  const assistantIndex = entryIndex(entries, state.streamingAssistantId)
  entries.splice(assistantIndex < 0 ? entries.length : assistantIndex, 0, entry)
  return { ...state, entries, streamingThinkingId: id, pendingReasoning: '' }
}

function applyTextChunk(
  state: ConversationProjectionState,
  event: SessionEvent<'assistant/chunk'>,
  text: string,
): ConversationProjectionState {
  if (state.streamingAssistantId !== null) {
    return replaceEntry(state, state.streamingAssistantId, entry => entry.kind === 'assistant'
      ? { ...entry, text: entry.text + text }
      : entry)
  }
  const id = `assistant:${stepKey(event.data.turn, event.data.step)}`
  const entry: ConversationAssistantEntry = {
    kind: 'assistant',
    id,
    seq: event.seq,
    turn: event.data.turn,
    step: event.data.step,
    text,
    streaming: true,
  }
  return { ...appendEntry(state, entry), streamingAssistantId: id }
}

function finalizeAssistant(
  state: ConversationProjectionState,
  event: SessionEvent<'assistant/message'>,
): ConversationProjectionState {
  const { turn, step, message } = event.data
  const key = stepKey(turn, step)
  if (state.finalizedSteps.includes(key) || state.interruptedTurns.includes(turn)) return state
  let next = state.streamingStep === key ? state : settleStreaming(state)
  const reasoning = reasoningText(message.content)
  const answer = visibleText(message.content).trim()
  const thinkingId = `thinking:${key}`
  const assistantId = `assistant:${key}`
  const thinkingIndex = entryIndex(next.entries, next.streamingThinkingId)
  if (thinkingIndex >= 0) {
    next = replaceEntry(next, next.streamingThinkingId!, entry => entry.kind === 'thinking'
      ? { ...entry, text: reasoning, streaming: false }
      : entry)
  } else if (reasoning.trim() !== '') {
    const thinking: ConversationThinkingEntry = {
      kind: 'thinking', id: thinkingId, seq: event.seq, turn, step, text: reasoning, streaming: false,
    }
    const entries = [...next.entries]
    const assistantIndex = entryIndex(entries, next.streamingAssistantId)
    entries.splice(assistantIndex < 0 ? entries.length : assistantIndex, 0, thinking)
    next = { ...next, entries }
  }
  const assistantIndex = entryIndex(next.entries, next.streamingAssistantId)
  if (assistantIndex >= 0) {
    next = replaceEntry(next, next.streamingAssistantId!, entry => entry.kind === 'assistant'
      ? { ...entry, text: answer, streaming: false }
      : entry)
  } else if (answer !== '') {
    next = appendEntry(next, {
      kind: 'assistant', id: assistantId, seq: event.seq, turn, step, text: answer, streaming: false,
    })
  }
  return {
    ...next,
    currentTurn: turn,
    streamingStep: null,
    streamingAssistantId: null,
    streamingThinkingId: null,
    pendingReasoning: '',
    finalizedSteps: [...next.finalizedSteps, key],
  }
}

function applyToolResult(
  state: ConversationProjectionState,
  event: SessionEvent<'tool/result'>,
): ConversationProjectionState {
  const block = event.data.message.content[0]
  const callId = String(block.toolCallId)
  const isError = block.isError === true || event.data.error !== undefined
  const text = typeof event.data.meta === 'string' && event.data.meta.trim() !== ''
    ? event.data.meta
    : visibleText(block.content)
  const result = {
    content: block.content as unknown as readonly ConversationJson[],
    text,
    isError,
    endedAt: event.time,
    ...(event.data.meta === undefined ? {} : { meta: event.data.meta as ConversationJson }),
  }
  const pairedId = state.toolEntryIds[callId]
  if (pairedId !== undefined) {
    return replaceEntry(state, pairedId, entry => entry.kind === 'tool' ? { ...entry, result } : entry)
  }
  const id = `tool:${callId}`
  const entry: ConversationToolEntry = {
    kind: 'tool',
    id,
    seq: event.seq,
    turn: event.data.turn,
    step: event.data.step,
    callId,
    name: 'tool',
    arguments: '',
    startedAt: event.time,
    channel: 'transcript',
    result,
  }
  return {
    ...appendEntry(state, entry),
    toolEntryIds: { ...state.toolEntryIds, [callId]: id },
  }
}

/**
 * Fold one committed session event into the plain-JSON conversation state.
 * Unrelated events return the same state reference.
 */
export function foldConversationProjection(
  state: ConversationProjectionState,
  event: SessionEvent,
): ConversationProjectionState {
  switch (event.type) {
    case 'turn/start':
      return { ...state, currentTurn: event.data.turn, active: true }
    case 'step/start': {
      const settled = settleStreaming(state)
      return { ...settled, currentTurn: event.data.turn, active: true }
    }
    case 'turn/end': {
      let next = { ...settleStreaming(state), currentTurn: event.data.turn, active: false }
      if (event.data.reason.kind === 'error') {
        const failure = event.data.reason.error
        return appendEntry(next, {
          kind: 'error',
          id: `error:${String(event.seq)}`,
          seq: event.seq,
          turn: event.data.turn,
          message: failure.message,
          ...(failure.code === '' ? {} : { code: failure.code }),
        })
      }
      if (event.data.reason.kind !== 'aborted' && event.data.reason.kind !== 'interrupted') return next
      if (next.interruptedTurns.includes(event.data.turn)) return next
      next = appendEntry(next, {
        kind: 'interrupted', id: `interrupted:${String(event.data.turn)}`, seq: event.seq, turn: event.data.turn,
      })
      return { ...next, interruptedTurns: [...next.interruptedTurns, event.data.turn] }
    }
    case 'user/message': {
      if (!isAppendSurfaceEvent(event) || event.data.source.kind !== 'user') return state
      const text = visibleText(event.data.content)
      if (text.trim() === '') return state
      return appendEntry(state, {
        kind: 'user',
        id: `user:${String(event.seq)}`,
        seq: event.seq,
        turn: state.currentTurn,
        text,
        images: imagesOf(event.data.content),
      })
    }
    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      const key = stepKey(turn, step)
      if (state.interruptedTurns.includes(turn) || state.finalizedSteps.includes(key)) return state
      if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return state
      const opened = openStreamingStep(state, turn, step)
      return chunk.type === 'reasoning-delta'
        ? applyReasoningChunk(opened, event, chunk.text)
        : applyTextChunk(opened, event, chunk.text)
    }
    case 'assistant/message':
      return isAppendSurfaceEvent(event) ? finalizeAssistant(state, event) : state
    case 'tool/call': {
      const id = `tool:${String(event.data.callId)}`
      const entry: ConversationToolEntry = {
        kind: 'tool',
        id,
        seq: event.seq,
        turn: event.data.turn,
        step: event.data.step,
        callId: String(event.data.callId),
        name: event.data.name,
        arguments: event.data.arguments,
        startedAt: event.time,
        channel: toolChannel(event.data.name),
      }
      return {
        ...appendEntry(state, entry),
        toolEntryIds: { ...state.toolEntryIds, [entry.callId]: id },
      }
    }
    case 'tool/result':
      return isAppendSurfaceEvent(event) ? applyToolResult(state, event) : state
    default:
      return state
  }
}

/** Official session-projection unit registered by the package plugin. */
type ConversationProjectionDefinition = Omit<
  ProjectionDefinition<'blueConversation', ConversationProjectionState>,
  'wire'
> & { wire: NonNullable<ProjectionDefinition<'blueConversation', ConversationProjectionState>['wire']> }

export const conversationProjectionDefinition: ConversationProjectionDefinition = {
  key: 'blueConversation',
  stateSchema: conversationProjectionStateSchema,
  init: initialConversationState,
  apply: foldConversationProjection,
  wire: {
    viewSchema: conversationProjectionSchema,
    view: state => ({ entries: state.entries, streaming: state.active }),
  },
  stateVersion: 1,
}
