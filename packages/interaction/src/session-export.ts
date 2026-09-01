/**
 * The session-export command family (S26): `/export` writes the current
 * session's folded transcript as a self-contained Markdown file (kimi's
 * export-md shape: front-matter, overview, per-turn sections) through the
 * persistence backend's raw artifact (`supportsRawArtifacts` + `readRaw`,
 * the JSONL chunk rows expanded with the dsh decoder), and `/copy` pushes
 * the last assistant message's text through the `./clipboard-write.ts`
 * pipeline. Both commands share one read path — raw artifact → decoded
 * events plus the current official `blueConversation` projection. Readable
 * output mirrors the projected transcript; `full` deliberately preserves the
 * decoded append-only audit. This module injects nothing and resolves every
 * service through `ctx.get` (the `/theme` fiber-dispose trap).
 *
 * @module @dsh-blue/blue-interaction/session-export
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TranscriptItem, TranscriptToolItem } from '@dsh-blue/blue-transcript'
// Empty type imports carry the `commands` merge the registration uses, the
// app-owned reader/action/projection merges every handler reads, and the
// `sessionPersistence` merge the read path resolves.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import { copyTextToClipboard } from './clipboard-write.ts'
import { getSharedEditor } from './editor-instance.ts'
/** The key-arg whitelist for the tool-call hint, in priority order (the
 * present.ts list — the export keeps the same hint the card shows). */
const KEY_ARG_KEYS = ['file_path', 'command', 'pattern'] as const

/** Maximum length of the tool-call hint on an export line. */
const KEY_ARG_MAX_CHARS = 60

/** Default export filename prefix (kimi's `kimi-export-…` counterpart). */
const EXPORT_PREFIX = 'blue-export'

/** First user message topic length in the overview. */
const TOPIC_MAX_CHARS = 80

/** The shortest id prefix kept in default filenames. */
const ID_PREFIX_LENGTH = 8

interface ProjectionImage { readonly attachmentId: string; readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; readonly bytes: number; readonly width: number; readonly height: number; readonly name?: string; readonly originalDimensions?: { readonly width: number; readonly height: number } }
interface ProjectionEntryBase { readonly id: string; readonly seq: number; readonly turn: number }
type ProjectionEntry =
  | (ProjectionEntryBase & { readonly kind: 'user'; readonly text: string; readonly images: readonly ProjectionImage[] })
  | (ProjectionEntryBase & { readonly kind: 'assistant'; readonly step: number; readonly text: string; readonly streaming: boolean })
  | (ProjectionEntryBase & { readonly kind: 'thinking'; readonly step: number; readonly text: string; readonly streaming: boolean })
  | (ProjectionEntryBase & { readonly kind: 'tool'; readonly step: number; readonly callId: string; readonly name: string; readonly arguments: string; readonly startedAt: number; readonly result?: { readonly text: string; readonly isError: boolean; readonly endedAt: number } })
  | (ProjectionEntryBase & { readonly kind: 'error'; readonly message: string; readonly code?: string })
  | (ProjectionEntryBase & { readonly kind: 'interrupted' })
interface ConversationProjection { readonly entries: readonly ProjectionEntry[]; readonly streaming: boolean }

/** Flatten and ellipsize one hint string. */
function shorten(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}

/**
 * The tool-call hint for one folded tool item: the first non-empty whitelist
 * argument, then the first short string argument — the present.ts rule, kept
 * local so the export's shape does not grow the transcript public surface.
 * @param item - the folded tool item.
 * @returns the hint, or `undefined` when the item's arguments yield none.
 */
function extractToolHint(item: TranscriptToolItem): string | undefined {
  const parsed = item.parsedArguments
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null) return undefined
  const args = parsed as Record<string, unknown>
  for (const key of KEY_ARG_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return shorten(value, KEY_ARG_MAX_CHARS)
  }
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value !== '' && value.length <= KEY_ARG_MAX_CHARS) {
      return shorten(value, KEY_ARG_MAX_CHARS)
    }
  }
  return undefined
}

/**
 * The visible text of the last assistant transcript item, newest first;
 * empty when none. Same shape as kimi's `findLastAssistantText`: only
 * folded assistant items count, and empty replies are skipped.
 * @param items - the folded transcript in session order.
 * @returns the last non-empty assistant text, or `''`.
 */
export function lastAssistantText(items: readonly TranscriptItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item?.kind !== 'assistant') continue
    if (item.text.trim().length === 0) continue
    return item.text
  }
  return ''
}

/** The facts the Markdown export renders. */
export interface ExportInput {
  /** The persisted session id. */
  readonly sessionId: string
  /** The session's durable cwd, when the header recorded one. */
  readonly workDir: string | undefined
  /** The folded transcript, in session order. */
  readonly items: readonly TranscriptItem[]
  /** The export timestamp. */
  readonly exportedAt: Date
}

/**
 * Build a tool call's Markdown section: the `#### Tool Call: name (hint)`
 * heading with the raw arguments JSON fenced, plus the paired result as a
 * collapsible `<details>` block when one has folded in.
 * @param item - the folded tool item.
 * @returns the Markdown block, always ending in a blank line.
 */
function formatToolItemMd(item: TranscriptToolItem): string {
  const hint = extractToolHint(item)
  const title = hint === undefined ? `#### Tool Call: ${item.name}` : `#### Tool Call: ${item.name} (\`${hint}\`)`
  const argsFormatted = item.parsedArguments === undefined
    ? item.arguments
    : JSON.stringify(item.parsedArguments, null, 2)
  const lines = [title, '', '```json', argsFormatted, '```', '']
  const result = item.result
  if (result !== undefined) {
    const resultTitle = hint === undefined ? `Tool Result: ${item.name}` : `Tool Result: ${item.name} (\`${hint}\`)`
    const resultText = result.fullText ?? result.text
    lines.push(`<details><summary>${resultTitle}</summary>`, '', resultText, '', '</details>', '')
  }
  return lines.join('\n')
}

/** Build one turn's Markdown section from its items, in fold order. */
function formatTurnMd(items: readonly TranscriptItem[], turn: number): string {
  const lines = [`## Turn ${String(turn)}`, '']
  let userHeaderWritten = false
  for (const item of items) {
    if (item.kind === 'user') {
      if (!userHeaderWritten) {
        lines.push('### User', '')
        userHeaderWritten = true
      }
      if (item.text.trim().length > 0) {
        lines.push(item.text, '')
      }
      for (const image of item.images) {
        // The kimi exporter's image placeholder: the bytes stay in the
        // session store, the export carries the marker.
        lines.push(`[image${image.name === undefined ? '' : ` ${image.name}`}]`, '')
      }
    } else if (item.kind === 'thinking') {
      if (item.text.trim().length === 0) continue
      lines.push('<details><summary>Thinking</summary>', '', item.text, '', '</details>', '')
    } else if (item.kind === 'assistant') {
      if (item.text.trim().length > 0) {
        lines.push('### Assistant', '', item.text, '')
      }
    } else if (item.kind === 'tool') {
      lines.push(formatToolItemMd(item))
    } else if (item.kind === 'step-summary') {
      lines.push(`#### (folded step · ${String(item.toolNames.length)} tool call${item.toolNames.length === 1 ? '' : 's'}${item.thinking === 0 ? '' : ` · ${String(item.thinking)} thinking block${item.thinking === 1 ? '' : 's'}`})`, '')
    } else if (item.kind === 'error') {
      lines.push(`> ✗ request failed: ${item.message}${item.code === undefined ? '' : ` (${item.code})`}`, '')
    } else {
      lines.push('> (interrupted)', '')
    }
  }
  return lines.join('\n')
}

/** Build the overview section: first user topic plus conversation totals. */
function buildOverview(items: readonly TranscriptItem[]): string {
  let topic = ''
  for (const item of items) {
    if (item.kind === 'user' && item.text.trim().length > 0) {
      topic = shorten(item.text.trim().replaceAll(/\s+/g, ' '), TOPIC_MAX_CHARS)
      break
    }
  }
  const turns = new Set(items.map(item => item.turn)).size
  const toolCalls = items.filter(item => item.kind === 'tool').length
  return [
    '## Overview',
    '',
    topic.length > 0 ? `- **Topic**: ${topic}` : '- **Topic**: (empty)',
    `- **Conversation**: ${String(turns)} turn${turns === 1 ? '' : 's'} | ${String(toolCalls)} tool call${toolCalls === 1 ? '' : 's'}`,
    '',
    '---',
  ].join('\n')
}

/**
 * Build the session export Markdown: front-matter (id, timestamp, cwd,
 * counts), the overview, then one `## Turn N` section per distinct turn in
 * first-seen order (the kimi export-md shape over the folded transcript).
 * @param input - the export facts.
 * @returns the complete Markdown document.
 */
export function buildExportMarkdown(input: ExportInput): string {
  const { sessionId, workDir, items, exportedAt } = input
  const lines = [
    '---',
    `session_id: ${sessionId}`,
    `exported_at: ${exportedAt.toISOString()}`,
    `work_dir: ${workDir ?? ''}`,
    `message_count: ${String(items.length)}`,
    '---',
    '',
    '# Blue Session Export',
    '',
  ]
  lines.push(buildOverview(items))
  lines.push('')
  const turns: number[] = []
  for (const item of items) {
    if (!turns.includes(item.turn)) turns.push(item.turn)
  }
  for (const turn of turns) {
    const turnItems = items.filter(item => item.turn === turn)
    lines.push(formatTurnMd(turnItems, turn))
    lines.push('')
  }
  return lines.join('\n')
}

/** The default export filename: `blue-export-{id8}-{YYYYMMDD-HHMMSS}.md`. */
function defaultExportName(id: string, now: Date): string {
  const shortId = id.slice(0, ID_PREFIX_LENGTH)
  const timestamp = now.toISOString().replaceAll(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `${EXPORT_PREFIX}-${shortId}-${timestamp}.md`
}

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Join the text blocks of content, `\n`-separated (the fold's rule). */
function contentText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n\n')
}

/** Join the reasoning blocks of content, or '' when there are none. */
function reasoningText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'reasoning' }> => block.type === 'reasoning')
    .map(block => block.text)
    .join('\n\n')
}

/** Render content blocks for the full export: text verbatim, images as
 * placeholders, every other block as a bracketed marker. */
function formatContentBlocksFull(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text.trim().length > 0) parts.push(block.text)
    } else if (block.type === 'image') {
      parts.push('[image]')
    } else {
      parts.push(`[${block.type}]`)
    }
  }
  return parts.join('\n\n')
}

/** One event's full-export section, in seq order. `assistant/chunk` rows
 * are the raw material of the assembled message and stay out (the message
 * carries the whole text). */
function formatFullEvent(event: SessionEvent): string {
  const lines: string[] = []
  switch (event.type) {
    case 'turn/start':
      lines.push(`## Turn ${String(event.data.turn)}`, '')
      break
    case 'step/start':
      lines.push(`### Step ${String(event.data.step)}`, '')
      break
    case 'user/message': {
      const source = event.data.source.kind
      const text = formatContentBlocksFull(event.data.content)
      lines.push(`#### user (${source})`, '')
      if (text.trim().length > 0) lines.push(text, '')
      break
    }
    case 'assistant/message': {
      const reasoning = reasoningText(event.data.message.content)
      const text = contentText(event.data.message.content)
      lines.push('#### assistant', '')
      if (reasoning.trim().length > 0) {
        lines.push('<details><summary>Thinking</summary>', '', reasoning, '', '</details>', '')
      }
      if (text.trim().length > 0) lines.push(text, '')
      const usage = event.data.usage
      if (usage !== undefined) {
        lines.push(`<sub>usage: ${formatUsage(usage)}</sub>`, '')
      }
      break
    }
    case 'tool/call': {
      lines.push(`#### tool call: ${event.data.name}`, '', '```json', event.data.arguments, '```', '')
      break
    }
    case 'tool/result': {
      const block = event.data.message.content[0]
      const resultText = typeof event.data.meta === 'string' && event.data.meta.trim() !== ''
        ? event.data.meta
        : contentText(block.content)
      const error = event.data.error
      const errorTail = error === undefined
        ? ''
        : ` (error: ${error.code}${error.name === '' ? '' : ` ${error.name}`})`
      lines.push(`#### tool result${errorTail}`, '')
      if (resultText.trim().length > 0) lines.push(resultText, '')
      break
    }
    case 'step/end':
      lines.push('#### step/end', '')
      break
    case 'assistant/chunk':
      // Raw stream material; the assembled assistant/message carries the
      // whole text, so the chunks add nothing but noise.
      return ''
    case 'turn/end': {
      const reason = event.data.reason
      const failure = reason.kind === 'error' && reason.error !== undefined
        ? `: ${reason.error.message}${reason.error.code === undefined ? '' : ` (${reason.error.code})`}`
        : ''
      lines.push(`#### turn/end (${reason.kind}${failure})`, '')
      break
    }
    default:
      // Every other event stays visible as its raw JSON (the "nothing
      // folded" promise): request/header, request/context, usage rows,
      // and anything a future harness version adds.
      lines.push(`#### ${event.type}`, '', '```json', JSON.stringify(event.data, null, 2), '```', '')
  }
  return lines.join('\n')
}

/** `input X, cache-read Y, cache-write Z, output W` — 1024-base, the usage.ts shape. */
function formatUsage(usage: { inputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number, outputTokens: number }): string {
  const parts = [`input ${format1024(usage.inputTokens)}`]
  if (usage.cacheReadTokens !== undefined) parts.push(`cache-read ${format1024(usage.cacheReadTokens)}`)
  if (usage.cacheWriteTokens !== undefined) parts.push(`cache-write ${format1024(usage.cacheWriteTokens)}`)
  parts.push(`output ${format1024(usage.outputTokens)}`)
  return parts.join(', ')
}

/** 1024-base token formatting (the status family's `formatTokens` rule). */
function format1024(count: number): string {
  if (count >= 1024 * 1024) return `${(count / (1024 * 1024)).toFixed(1)}M`
  if (count >= 1024) return `${(count / 1024).toFixed(1)}k`
  return String(count)
}

/** Convert the official conversation view into the Markdown item vocabulary. */
function projectionItems(projection: ConversationProjection): TranscriptItem[] {
  return projection.entries.map((entry): TranscriptItem => {
    switch (entry.kind) {
      case 'user':
        return {
          kind: 'user', seq: entry.seq, turn: entry.turn, text: entry.text,
          images: entry.images.map(image => ({
            attachmentId: AttachmentId(image.attachmentId), mediaType: image.mediaType, bytes: image.bytes,
            width: image.width, height: image.height,
            ...(image.name === undefined ? {} : { name: image.name }),
            ...(image.originalDimensions === undefined ? {} : { originalDimensions: { ...image.originalDimensions } }),
          })),
        }
      case 'assistant':
        return { kind: 'assistant', seq: entry.seq, turn: entry.turn, step: entry.step, text: entry.text }
      case 'thinking':
        return { kind: 'thinking', seq: entry.seq, turn: entry.turn, step: entry.step, text: entry.text, streaming: entry.streaming }
      case 'tool':
        return {
          kind: 'tool', seq: entry.seq, turn: entry.turn, step: entry.step, callId: entry.callId,
          name: entry.name, arguments: entry.arguments, startedAt: entry.startedAt,
          ...(entry.result === undefined ? {} : {
            result: {
              text: entry.result.text, fullText: entry.result.text,
              isError: entry.result.isError, endedAt: entry.result.endedAt,
            },
          }),
        }
      case 'error':
        return { kind: 'error', seq: entry.seq, turn: entry.turn, message: entry.message, ...(entry.code === undefined ? {} : { code: entry.code }) }
      case 'interrupted':
        return { kind: 'interrupted', seq: entry.seq, turn: entry.turn }
    }
  })
}

function isConversationProjection(value: unknown): value is ConversationProjection {
  return value !== null && typeof value === 'object' && Array.isArray((value as { entries?: unknown }).entries)
}

/** The facts the full (event-stream) export renders. */
export interface FullExportInput {
  /** The persisted session id. */
  readonly sessionId: string
  /** The session's durable cwd, when the header recorded one. */
  readonly workDir: string | undefined
  /** The decoded event stream, in seq order. */
  readonly events: readonly SessionEvent[]
  /** The export timestamp. */
  readonly exportedAt: Date
}

/**
 * Build the full session export Markdown: front-matter, then every event's
 * section in seq order — nothing folded, nothing filtered (the D28
 * injection messages appear with their `source.kind` labeled, tool results
 * carry their full text, boundary events and request rows stay visible).
 * @param input - the export facts.
 * @returns the complete Markdown document.
 */
export function buildFullExportMarkdown(input: FullExportInput): string {
  const { sessionId, workDir, events, exportedAt } = input
  const lines = [
    '---',
    `session_id: ${sessionId}`,
    `exported_at: ${exportedAt.toISOString()}`,
    `work_dir: ${workDir ?? ''}`,
    `event_count: ${String(events.length)}`,
    '---',
    '',
    '# Blue Session Export (full)',
    '',
  ]
  for (const event of events) {
    const section = formatFullEvent(event)
    if (section.trim().length > 0) lines.push(section, '')
  }
  return lines.join('\n')
}

/**
 * Register the `/export` and `/copy` commands.
 * @param ctx - plugin context.
 * @returns a disposer unregistering both commands.
 */
export function registerExportCommands(ctx: Context): () => void {
  /** The shared read path's outcome: session identity, decoded audit events,
   * and the current official projected transcript. */
  interface SessionExportSource {
    /** The persisted session id. */
    readonly id: string
    /** The session's durable cwd, when the header recorded one. */
    readonly cwd: string | undefined
    /** The decoded event stream, in seq order (the full export's view). */
    readonly events: readonly SessionEvent[]
    /** The projected transcript, in session order (the readable export's view). */
    readonly items: readonly TranscriptItem[]
  }

  /**
   * The shared read path: the current session's raw artifact plus its current
   * official conversation projection. Resolves `undefined` when no session is live yet;
   * throws the classified failure for every other stop.
   * @param signal - the dispatching UI request's cancellation signal.
   */
  async function readSessionSource(signal: AbortSignal): Promise<SessionExportSource | undefined> {
    const agent = ctx.blueCurrentAgent.current()
    if (agent === null) return undefined
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) throw new Error('session persistence is unavailable')
    if (persistence.supportsRawArtifacts === false) {
      throw new Error('this session persistence backend does not expose raw artifacts')
    }
    // The persistence coordinator drains asynchronously (`session/event`
    // write-behind), so a durable read must flush first — the SessionStore's
    // documented pre-read channel (`ctx.get`, never the inject proxy).
    // Safe with no store, no listener (flush returns false), or any backend.
    await ctx.sessions.flush(agent.session)
    const raw = await persistence.readRaw(agent.id, signal)
    if (raw === undefined) throw new Error('the session has no stored artifact yet')
    const events: SessionEvent[] = []
    for (const line of raw.content.split('\n')) {
      if (line.trim() === '') continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        throw new Error('corrupt session log: invalid JSONL line')
      }
      events.push(...decodeStorageRecord(value))
    }
    const projection = ctx.sessionProjections.snapshot(agent.session, ['blueConversation']).values.blueConversation
    const items = isConversationProjection(projection) ? projectionItems(projection) : []
    return { id: String(agent.id), cwd: agent.session.header.cwd, events, items }
  }

  /**
   * The `/export` handler: write the projected transcript (`/export [path]`)
   * or the full event stream (`/export full [path]`) as Markdown and flash
   * the path in the hint line.
   * @param rawInput - the command's raw argument string (`[full] [<path>]`).
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns the command outcome.
   */
  async function exportSession(rawInput: string, signal: AbortSignal): Promise<CommandResult> {
    let source: SessionExportSource | undefined
    try {
      source = await readSessionSource(signal)
    } catch (error) {
      return { kind: 'error', text: describe(error) }
    }
    if (source === undefined) return { kind: 'error', text: 'no session is live yet' }
    // The mode keyword leads the argument; everything after it is the path.
    const trimmed = rawInput.trim()
    const full = trimmed === 'full' || trimmed.startsWith('full ')
    const pathArg = full ? trimmed.slice(4).trim() : trimmed
    const count = full ? source.events.length : source.items.length
    if (count === 0) return { kind: 'error', text: 'nothing to export yet' }
    const outputPath = pathArg.length > 0
      ? resolve(pathArg)
      : join(resolve(source.cwd ?? process.cwd()), defaultExportName(source.id, new Date()))
    const markdown = full
      ? buildFullExportMarkdown({
          sessionId: source.id,
          workDir: source.cwd,
          events: source.events,
          exportedAt: new Date(),
        })
      : buildExportMarkdown({
          sessionId: source.id,
          workDir: source.cwd,
          items: source.items,
          exportedAt: new Date(),
        })
    try {
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, markdown, 'utf-8')
    } catch (error) {
      return { kind: 'error', text: `could not write export: ${describe(error)}` }
    }
    getSharedEditor(ctx)?.notice?.(`exported ${String(count)} ${full ? 'events' : 'items'} to ${outputPath}`)
    return { kind: 'success' }
  }

  /**
   * The `/copy` handler: copy the last assistant message's text and flash
   * the outcome in the hint line.
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns the command outcome.
   */
  async function copyAssistantMessage(signal: AbortSignal): Promise<CommandResult> {
    let source: SessionExportSource | undefined
    try {
      source = await readSessionSource(signal)
    } catch (error) {
      return { kind: 'error', text: describe(error) }
    }
    if (source === undefined) return { kind: 'error', text: 'no session is live yet' }
    const text = lastAssistantText(source.items)
    if (text.length === 0) return { kind: 'error', text: 'no assistant message to copy' }
    let method
    try {
      method = await copyTextToClipboard(text)
    } catch (error) {
      return { kind: 'error', text: `could not copy to clipboard: ${describe(error)}` }
    }
    // The OSC 52 leg cannot be confirmed from this side — the terminal
    // honors it silently or ignores it silently — so it reports as
    // unverified (the kimi wording).
    getSharedEditor(ctx)?.notice?.(method === 'native'
      ? `copied the last assistant message (${String(text.length)} characters)`
      : `copied via terminal escape sequence (unverified, ${String(text.length)} characters)`)
    return { kind: 'success' }
  }

  const exportCommand = ctx.commands.register({
    name: 'export',
    description: 'Export the current session as a Markdown file',
    input: { hint: '[full] [<path>]' },
    handler: (invocation) => exportSession(invocation.rawInput, invocation.signal),
  })
  const copyCommand = ctx.commands.register({
    name: 'copy',
    description: 'Copy the last assistant message to the clipboard',
    handler: (invocation) => copyAssistantMessage(invocation.signal),
  })
  return () => {
    exportCommand()
    copyCommand()
  }
}
