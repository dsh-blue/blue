/**
 * Narrow interaction adapter from the official `blueConversation` session
 * projection to Blue's renderer-neutral transcript model. It retains only the
 * current opaque session handle and never folds Harness events.
 *
 * @module @dsh-blue/blue-transcript/official-model
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import {
  conversationProjectionSchema,
  type ConversationEntry,
  type ConversationProjection,
  type ConversationToolEntry,
} from '@dsh-blue/blue-conversation'
import type { TranscriptEntryModel, TranscriptModel } from '@dsh-blue/blue-frontend'
import type {} from '@dsh-blue/blue-app'
import { createToolPresentationModel } from './tool-model.ts'
import { createTranscriptModel } from './transcript-model.ts'
import { parseToolArguments, resolveCallView, resolveResultView, type ToolPresentationSource } from './present.ts'

/** Official projection read face consumed by this compatibility adapter. */
export interface ConversationProjectionSource {
  snapshot(session: unknown): { readonly asOfSeq: number; readonly values: Readonly<Record<string, unknown>> }
  onChanged(listener: (session: unknown, key: string, value: unknown, seq: number) => void): () => void
}

/** Structural current-session binding; the Agent object never crosses this file. */
export interface ConversationSessionBinding {
  readonly id: string
  readonly session: unknown
}

function toolResult(entry: ConversationToolEntry): ToolResult | undefined {
  if (entry.result === undefined) return undefined
  return {
    content: entry.result.content as unknown as ContentBlock[],
    isError: entry.result.isError,
    ...(entry.result.meta === undefined ? {} : { meta: entry.result.meta }),
  }
}

function toolModel(entry: ConversationToolEntry, tools: ToolPresentationSource): TranscriptEntryModel {
  const args = parseToolArguments(entry.arguments)
  const outcome = toolResult(entry)
  const call = resolveCallView(tools, entry.name, args)
  const resultView = outcome === undefined ? undefined : resolveResultView(tools, entry.name, args, outcome)
  const presentation = createToolPresentationModel({
    id: entry.id,
    name: entry.name,
    ...(call === undefined ? {} : { call }),
    ...(resultView === undefined ? {} : { result: resultView }),
    ...(outcome === undefined ? {} : { outcome }),
  })
  return {
    kind: 'transcript-tool',
    id: entry.id,
    seq: entry.seq,
    turn: entry.turn,
    step: entry.step,
    callId: entry.callId,
    name: entry.name,
    arguments: entry.arguments,
    startedAt: entry.startedAt,
    ...(entry.result === undefined ? {} : {
      result: {
        text: entry.result.text,
        fullText: entry.result.text,
        isError: entry.result.isError,
        endedAt: entry.result.endedAt,
      },
    }),
    presentation,
  }
}

function entryModel(entry: Exclude<ConversationEntry, ConversationToolEntry>): TranscriptEntryModel {
  switch (entry.kind) {
    case 'user':
      return {
        kind: 'transcript-user', id: entry.id, seq: entry.seq, turn: entry.turn, text: entry.text,
        images: entry.images.map(image => ({
          attachmentId: image.attachmentId,
          mediaType: image.mediaType,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
          ...(image.name === undefined ? {} : { name: image.name }),
          ...(image.originalDimensions === undefined ? {} : {
            originalDimensions: { ...image.originalDimensions },
          }),
        })),
      }
    case 'assistant':
      return {
        kind: 'transcript-assistant', id: entry.id, seq: entry.seq, turn: entry.turn, step: entry.step,
        text: entry.text, streaming: entry.streaming,
      }
    case 'thinking':
      return {
        kind: 'transcript-thinking', id: entry.id, seq: entry.seq, turn: entry.turn, step: entry.step,
        text: entry.text, streaming: entry.streaming,
      }
    case 'error':
      return {
        kind: 'transcript-error', id: entry.id, seq: entry.seq, turn: entry.turn, message: entry.message,
        ...(entry.code === undefined ? {} : { code: entry.code }),
      }
    case 'interrupted':
      return { kind: 'transcript-interrupted', id: entry.id, seq: entry.seq, turn: entry.turn }
  }
}

/** Convert one validated official whole value to a frozen Blue model. */
export function conversationTranscriptModel(
  projection: ConversationProjection,
  tools: ToolPresentationSource,
): TranscriptModel {
  const entries = projection.entries.flatMap((entry): TranscriptEntryModel[] => {
    if (entry.kind === 'tool') return entry.channel === 'transcript' ? [toolModel(entry, tools)] : []
    return [entryModel(entry)]
  })
  return createTranscriptModel('official-conversation', entries, projection.streaming)
}

/** Projection-to-model source scoped to one frontend tree and provider Fiber. */
export class OfficialConversationModelSource {
  private model: TranscriptModel = createTranscriptModel('official-conversation', [], false)
  private session: unknown
  private watermark = -1
  private disposed = false
  private readonly offChanged: () => void

  constructor(
    private readonly projections: ConversationProjectionSource,
    private readonly tools: ToolPresentationSource,
    private readonly publish: (model: TranscriptModel) => void,
  ) {
    this.offChanged = projections.onChanged((session, key, value, seq) => {
      if (this.disposed || session !== this.session || key !== 'blueConversation' || seq <= this.watermark) return
      const parsed = conversationProjectionSchema.safeParse(value)
      if (!parsed.success) return
      this.watermark = seq
      this.model = conversationTranscriptModel(parsed.data, this.tools)
      this.publish(this.model)
    })
  }

  /** Current dynamic registry value. */
  snapshot(): TranscriptModel {
    return this.model
  }

  /** Attach to a new opaque session snapshot, clearing stale content first. */
  attach(binding: ConversationSessionBinding | undefined): void {
    this.session = binding?.session
    this.watermark = -1
    if (binding === undefined) {
      this.model = createTranscriptModel('official-conversation', [], false)
      this.publish(this.model)
      return
    }
    const snapshot = this.projections.snapshot(binding.session)
    const parsed = conversationProjectionSchema.safeParse(snapshot.values.blueConversation)
    this.watermark = snapshot.asOfSeq
    this.model = parsed.success
      ? conversationTranscriptModel(parsed.data, this.tools)
      : createTranscriptModel('official-conversation', [], false)
    this.publish(this.model)
  }

  /** Drop the subscription and reject every late projection callback. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.offChanged()
    this.session = undefined
    this.model = createTranscriptModel('official-conversation', [], false)
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-transcript-official'

/** Official projection/model services and current frontend binding. */
export const inject = ['blueConversationProjection', 'sessionProjections', 'blueTranscriptModels', 'blueSession', 'tools']

function bindingOf(value: unknown): ConversationSessionBinding | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const row = value as { readonly id?: unknown, readonly session?: unknown }
  if (typeof row.id !== 'string' || row.session === undefined) return undefined
  return { id: row.id, session: row.session }
}

/** Mount the official projection consumer and bind it to session switches. */
export function apply(ctx: Context): void {
  const source = new OfficialConversationModelSource(
    ctx.sessionProjections as unknown as ConversationProjectionSource,
    ctx.tools,
    () => ctx.blueTranscriptModels.refresh('official-conversation'),
  )
  ctx.effect(() => () => source.dispose())
  ctx.effect(() => ctx.blueTranscriptModels.register(() => source.snapshot()))
  ctx.on('blue/session-changed', agent => source.attach(bindingOf(agent)))
  source.attach(bindingOf(ctx.blueSession.current))
}
