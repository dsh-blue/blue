/**
 * Narrow interaction adapter from the official `blueConversation` session
 * projection to Blue's renderer-neutral transcript model. It reads only the
 * app-owned current-session projection façade and never folds Harness events.
 *
 * @module @dsh-blue/blue-transcript/official-model
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueSessionSnapshot } from '@dsh-blue/blue-api'
import type { BlueSessionProjectionReader } from '@dsh-blue/blue-app'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import {
  conversationProjectionSchema,
  type ConversationEntry,
  type ConversationProjection,
  type ConversationToolEntry,
} from '@dsh-blue/blue-conversation'
import type { ReadCallModel, TranscriptEntryModel, TranscriptModel, TranscriptReadGroupModel } from '@dsh-blue/blue-frontend'
import { createToolPresentationModel } from './tool-model.ts'
import { createTranscriptModel, TRANSCRIPT_MODEL_WINDOW } from './transcript-model.ts'
import { ellipsize, parseToolArguments, resolveCallView, resolveResultView, type ToolPresentationSource } from './present.ts'

/** Official projection read face consumed by this compatibility adapter. */
export interface ConversationProjectionSource {
  current(key: string): { readonly asOfSeq: number, readonly value: unknown } | undefined
  subscribe(listener: (key: string, value: unknown, seq: number) => void): () => void
}

/** Preview lines a read window carries for the expanded group view. */
export const READ_PREVIEW_LINE_LIMIT = 5

/** One tool entry with its presenter views resolved exactly once. */
interface ResolvedTool {
  readonly entry: ConversationToolEntry
  readonly args: unknown
  readonly outcome: ToolResult | undefined
  readonly call: ToolCallView | undefined
  readonly result: ToolResultView | undefined
}

function toolResult(entry: ConversationToolEntry): ToolResult | undefined {
  if (entry.result === undefined) return undefined
  return {
    content: entry.result.content as unknown as ContentBlock[],
    isError: entry.result.isError,
    ...(entry.result.meta === undefined ? {} : { meta: entry.result.meta }),
  }
}

/** Resolve one tool entry's presenter views (contained; void on any failure). */
function resolveTool(entry: ConversationToolEntry, tools: ToolPresentationSource): ResolvedTool {
  const args = parseToolArguments(entry.arguments)
  const outcome = toolResult(entry)
  const call = resolveCallView(tools, entry.name, args)
  const result = outcome === undefined ? undefined : resolveResultView(tools, entry.name, args, outcome)
  return { entry, args, outcome, call, result }
}

/**
 * Whether a tool entry presents as a read — by presenter vocabulary, not
 * tool name: the pending call declares `kind: 'read'`, or the settled result
 * carries the read card.
 */
function isReadTool(resolved: ResolvedTool): boolean {
  if (resolved.call?.card === 'generic' && resolved.call.kind === 'read') return true
  return resolved.result?.card === 'read'
}

/** The read arguments this adapter understands, degraded to unknowns. */
function readArgumentRecord(args: unknown): Record<string, unknown> {
  if (args === undefined || typeof args !== 'object' || args === null) return {}
  return args as Record<string, unknown>
}

function firstNonEmptyLine(text: string): string | undefined {
  return text.split('\n').find(line => line.trim() !== '')
}

/** Build one read call's renderer-neutral facts from entry, arguments, and views. */
function readCallModel(resolved: ResolvedTool): ReadCallModel {
  const { entry, args, outcome, result } = resolved
  const record = readArgumentRecord(args)
  const view = result?.card === 'read' ? result : undefined
  const path = typeof record['file_path'] === 'string' && record['file_path'] !== ''
    ? record['file_path']
    : typeof record['path'] === 'string' && record['path'] !== ''
      ? record['path']
      : view?.path
  const offset = typeof record['offset'] === 'number' && record['offset'] > 0 ? record['offset'] : 1
  const limit = typeof record['limit'] === 'number' ? record['limit'] : undefined
  const lines = view?.lines ?? []
  const state = outcome === undefined ? 'pending' : outcome.isError ? 'error' : 'ok'
  // state 'error' implies entry.result exists: the outcome derives from it.
  return {
    callId: entry.callId,
    seq: entry.seq,
    turn: entry.turn,
    step: entry.step,
    ...(path === undefined ? {} : { path }),
    ...(limit === undefined ? {} : { requestedRange: { first: offset, last: offset + limit - 1 } }),
    ...(lines.length === 0 ? {} : { range: { first: lines[0]!.number, last: lines.at(-1)!.number } }),
    ...(view?.totalLines === undefined ? {} : { totalLines: view.totalLines }),
    state,
    ...(state === 'error' ? { error: ellipsize(firstNonEmptyLine(entry.result!.text) ?? 'read failed', 120) } : {}),
    ...(lines.length === 0 ? {} : {
      previewLines: lines.slice(0, READ_PREVIEW_LINE_LIMIT).map(line => ({ number: line.number, text: line.text })),
    }),
  }
}

/** Fold a run of resolved read entries into one group model. */
function readGroupModel(run: readonly ResolvedTool[]): TranscriptReadGroupModel {
  const first = run[0]!
  return {
    kind: 'transcript-read-group',
    id: `read-group:${String(first.entry.id)}`,
    seq: first.entry.seq,
    turn: first.entry.turn,
    step: first.entry.step,
    reads: run.map(readCallModel),
  }
}

function toolModel(resolved: ResolvedTool): TranscriptEntryModel {
  const { entry, outcome, call, result } = resolved
  const presentation = call === undefined && result === undefined
    ? undefined
    : createToolPresentationModel({
        id: entry.id,
        name: entry.name,
        ...(call === undefined ? {} : { call }),
        ...(result === undefined ? {} : { result }),
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
    ...(presentation === undefined ? {} : { presentation }),
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
  const entries: TranscriptEntryModel[] = []
  let run: ResolvedTool[] = []
  const flushRun = (): void => {
    if (run.length === 0) return
    entries.push(readGroupModel(run))
    run = []
  }
  for (const entry of projection.entries.slice(-TRANSCRIPT_MODEL_WINDOW)) {
    if (entry.kind !== 'tool') {
      // Thinking is meta, not content: it neither renders into the run nor
      // breaks it — reads stay grouped across the model's reasoning.
      if (entry.kind !== 'thinking') flushRun()
      entries.push(entryModel(entry))
      continue
    }
    if (entry.channel !== 'transcript') continue
    const resolved = resolveTool(entry, tools)
    const continuesRun = run.length > 0
      && entry.turn === run[0]!.entry.turn
      && isReadTool(resolved)
    if (!continuesRun) flushRun()
    if (isReadTool(resolved)) {
      run.push(resolved)
      continue
    }
    entries.push(toolModel(resolved))
  }
  flushRun()
  return createTranscriptModel('official-conversation', entries, projection.streaming)
}

/** Projection-to-model source scoped to one frontend tree and provider Fiber. */
export class OfficialConversationModelSource {
  private model: TranscriptModel = createTranscriptModel('official-conversation', [], false)
  private active = false
  private watermark = -1
  private disposed = false
  private readonly offChanged: () => void

  constructor(
    private readonly projections: ConversationProjectionSource,
    private readonly tools: ToolPresentationSource,
    private readonly publish: (model: TranscriptModel) => void,
  ) {
    this.offChanged = projections.subscribe((key, value, seq) => {
      if (this.disposed || !this.active || key !== 'blueConversation' || seq <= this.watermark) return
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

  /** Attach to the app's current session, clearing stale content first. */
  attach(active: boolean): void {
    this.active = active
    this.watermark = -1
    if (!active) {
      this.model = createTranscriptModel('official-conversation', [], false)
      this.publish(this.model)
      return
    }
    const snapshot = this.projections.current('blueConversation')
    const parsed = conversationProjectionSchema.safeParse(snapshot?.value)
    this.watermark = snapshot?.asOfSeq ?? -1
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
    this.active = false
    this.model = createTranscriptModel('official-conversation', [], false)
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-transcript-official'

/** Official projection/model services and current frontend binding. */
export const inject = ['blueConversationProjection', 'blueSessionProjections', 'blueSessionReader', 'blueTranscriptModels', 'tools']

/** Mount the official projection consumer and bind it to session switches. */
export function apply(ctx: Context): void {
  const source = new OfficialConversationModelSource(
    ctx.blueSessionProjections as BlueSessionProjectionReader,
    ctx.tools,
    () => ctx.blueTranscriptModels.refresh('official-conversation'),
  )
  ctx.effect(() => () => source.dispose())
  ctx.effect(() => ctx.blueTranscriptModels.register(() => source.snapshot()))
  let sessionId: string | undefined
  const registration = ctx.blueSessionReader.subscribe((session: BlueSessionSnapshot | null) => {
    if (session?.id === sessionId) return
    sessionId = session?.id
    source.attach(session !== null)
  })
  ctx.effect(() => () => registration.dispose())
}
