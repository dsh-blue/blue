/**
 * Projection mapper from the official `blueConversation` session projection
 * to Blue's renderer-neutral transcript model. It reads the native projection
 * registry for the exact current session and never folds Harness events.
 *
 * @module @dsh-blue/blue-transcript/official-model
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import {
  conversationProjectionSchema,
  type ConversationEntry,
  type ConversationProjection,
  type ConversationToolEntry,
} from '@dsh-blue/blue-conversation'
import type { ReadCallModel, SearchCallModel, TranscriptEntryModel, TranscriptModel, TranscriptReadGroupModel, TranscriptSearchGroupModel } from '@dsh-blue/blue-frontend'
import { createToolPresentationModel } from './tool-model.ts'
import { createTranscriptModel, TRANSCRIPT_MODEL_WINDOW } from './transcript-model.ts'
import { ellipsize, parseToolArguments, resolveCallView, resolveResultView, type ToolPresentationSource } from './present.ts'

/** Native projection read face consumed by the transcript mapper. */
export interface ConversationProjectionSource {
  snapshot(session: Session, keys?: readonly ['blueConversation']): { readonly asOfSeq: number, readonly values: Readonly<Record<string, unknown>> }
  onChanged(listener: (session: Session, key: string, value: unknown, seq: number) => void): () => void
}

/** Preview lines a read window carries for the expanded group view. */
export const READ_PREVIEW_LINE_LIMIT = 5

/** Match previews a search group's file row carries when expanded. */
export const SEARCH_PREVIEW_MATCH_LIMIT = 3

/** Path rows a search group's glob call carries when expanded. */
export const SEARCH_PATH_LIMIT = 16

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

/**
 * Whether a tool entry presents as a search (grep or glob) — by presenter
 * vocabulary: the pending call declares `kind: 'search'`, or the settled
 * result carries the search card (whose `shape` separates content matches
 * from path lists).
 */
function isSearchTool(resolved: ResolvedTool): boolean {
  if (resolved.call?.card === 'generic' && resolved.call.kind === 'search') return true
  return resolved.result?.card === 'search'
}

/** The card family a tool entry groups into, or `undefined` when it stays a lone card. */
type ToolFamily = 'read' | 'search'

function toolFamily(resolved: ResolvedTool): ToolFamily | undefined {
  if (isReadTool(resolved)) return 'read'
  if (isSearchTool(resolved)) return 'search'
  return undefined
}

/** The read arguments this mapper understands, degraded to unknowns. */
function readArgumentRecord(args: unknown): Record<string, unknown> {
  if (args === undefined || typeof args !== 'object' || args === null) return {}
  return args as Record<string, unknown>
}

/** A row label for a read-kind call without a file: the first short string argument, prefixed by its key. */
function salientArgument(record: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value !== '' && value.length <= 60) return `${key}: ${value}`
  }
  return undefined
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
  // Read-kind calls without a file (the jobs reader, for one) still group;
  // their row falls back to the salient argument so the member stays visible.
  const label = path === undefined ? salientArgument(record) : undefined
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
    ...(label === undefined ? {} : { label }),
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

/** Build one search call's renderer-neutral facts from entry, arguments, and views. */
function searchCallModel(resolved: ResolvedTool): SearchCallModel {
  const { entry, args, outcome, result } = resolved
  const record = readArgumentRecord(args)
  const pattern = typeof record['pattern'] === 'string' && record['pattern'] !== '' ? record['pattern'] : undefined
  const view = result?.card === 'search' ? result : undefined
  const state = outcome === undefined ? 'pending' : outcome.isError ? 'error' : 'ok'
  return {
    callId: entry.callId,
    seq: entry.seq,
    turn: entry.turn,
    step: entry.step,
    ...(pattern === undefined ? {} : { pattern }),
    ...(view === undefined ? {} : { shape: view.shape }),
    ...(view?.shape === 'matches' ? {
      files: view.files.map(file => ({
        path: file.path,
        count: file.matches.length,
        previews: file.matches.slice(0, SEARCH_PREVIEW_MATCH_LIMIT).map(match => ({ lineNumber: match.lineNumber, line: match.line })),
      })),
    } : {}),
    ...(view?.shape === 'paths' ? { paths: view.paths.slice(0, SEARCH_PATH_LIMIT), pathsTotal: view.total } : {}),
    ...(view === undefined ? {} : { truncated: view.truncated }),
    ...(view?.total === undefined ? {} : { total: view.total }),
    state,
    ...(state === 'error' ? { error: ellipsize(firstNonEmptyLine(entry.result!.text) ?? 'search failed', 120) } : {}),
  }
}

/** Fold a run of resolved search entries into one group model. */
function searchGroupModel(run: readonly ResolvedTool[]): TranscriptSearchGroupModel {
  const first = run[0]!
  return {
    kind: 'transcript-search-group',
    id: `search-group:${String(first.entry.id)}`,
    seq: first.entry.seq,
    turn: first.entry.turn,
    step: first.entry.step,
    searches: run.map(searchCallModel),
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
  let runFamily: ToolFamily | undefined
  const flushRun = (): void => {
    if (run.length === 0) return
    entries.push(runFamily === 'search' ? searchGroupModel(run) : readGroupModel(run))
    run = []
    runFamily = undefined
  }
  for (const entry of projection.entries.slice(-TRANSCRIPT_MODEL_WINDOW)) {
    if (entry.kind !== 'tool') {
      // Thinking is meta, not content: it neither renders into the run nor
      // breaks it — reads and searches stay grouped across the model's
      // reasoning.
      if (entry.kind !== 'thinking') flushRun()
      entries.push(entryModel(entry))
      continue
    }
    if (entry.channel !== 'transcript') continue
    const resolved = resolveTool(entry, tools)
    const family = toolFamily(resolved)
    const continuesRun = runFamily !== undefined
      && family === runFamily
      && entry.turn === run[0]!.entry.turn
    if (!continuesRun) flushRun()
    if (family === undefined) {
      entries.push(toolModel(resolved))
      continue
    }
    run.push(resolved)
    runFamily = family
  }
  flushRun()
  return createTranscriptModel('official-conversation', entries, projection.streaming)
}

/** Projection-to-model source scoped to one frontend tree and provider Fiber. */
export class OfficialConversationModelSource {
  private model: TranscriptModel = createTranscriptModel('official-conversation', [], false)
  private session: Session | null = null
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

  /** Attach to the app's current session, clearing stale content first. */
  attach(session: Session | null): void {
    this.session = session
    this.watermark = -1
    if (session === null) {
      this.model = createTranscriptModel('official-conversation', [], false)
      this.publish(this.model)
      return
    }
    const snapshot = this.projections.snapshot(session, ['blueConversation'])
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
    this.session = null
    this.model = createTranscriptModel('official-conversation', [], false)
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-transcript-official'

/** Official projection/model services and current frontend binding. */
export const inject = ['blueConversationReady', 'sessionProjections', 'blueCurrentAgent', 'blueTranscriptModels', 'tools']

/** Mount the official projection consumer and bind it to session switches. */
export function apply(ctx: Context): void {
  const source = new OfficialConversationModelSource(
    ctx.sessionProjections,
    { get: name => {
      const definition = ctx.tools.get(name, ctx.blueCurrentAgent.current() ?? undefined)
      if (definition === undefined) return undefined
      return {
        ...(definition.presentCall === undefined ? {} : { presentCall: definition.presentCall }),
        ...(definition.presentResult === undefined ? {} : { presentResult: definition.presentResult }),
      }
    } },
    () => ctx.blueTranscriptModels.refresh('official-conversation'),
  )
  ctx.effect(() => () => source.dispose())
  ctx.effect(() => ctx.blueTranscriptModels.register(() => source.snapshot()))
  let agent = ctx.blueCurrentAgent.current()
  source.attach(agent?.session ?? null)
  const offAgent = ctx.blueCurrentAgent.subscribe((next) => {
    if (next === agent) return
    agent = next
    source.attach(next?.session ?? null)
  })
  ctx.effect(() => () => offAgent())
}
