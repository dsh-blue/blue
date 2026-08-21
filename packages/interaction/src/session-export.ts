/**
 * The session-export command family (S26): `/export` writes the current
 * session's folded transcript as a self-contained Markdown file (kimi's
 * export-md shape: front-matter, overview, per-turn sections) through the
 * persistence backend's raw artifact (`supportsRawArtifacts` + `readRaw`,
 * the JSONL chunk rows expanded with the dsh decoder), and `/copy` pushes
 * the last assistant message's text through the `./clipboard-write.ts`
 * pipeline. Both commands share one read path — raw artifact → decoded
 * events → `foldSessionEvents` — so the export mirrors exactly what the
 * transcript renders (the D28 injection filter included) and survives
 * compaction and resume. This module injects nothing and resolves every
 * service through `ctx.get` (the `/theme` fiber-dispose trap).
 *
 * @module @dsh-blue/blue-interaction/session-export
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { decodeStorageRecord } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionEvents } from '@dsh-blue/blue-transcript'
import type { TranscriptItem, TranscriptToolItem } from '@dsh-blue/blue-transcript'
// Empty type imports carry the `commands` merge the registration uses, the
// app-owned `blueSession` merge every handler reads, and the
// `sessionPersistence` merge the read path resolves.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import type {} from '@deepseek-ai/dsh-session-persistence'
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

/**
 * Register the `/export` and `/copy` commands.
 * @param ctx - plugin context.
 * @returns a disposer unregistering both commands.
 */
export function registerExportCommands(ctx: Context): () => void {
  /** The shared read path's outcome: the session identity plus its fold. */
  interface SessionExportSource {
    /** The persisted session id. */
    readonly id: string
    /** The session's durable cwd, when the header recorded one. */
    readonly cwd: string | undefined
    /** The folded transcript, in session order. */
    readonly items: readonly TranscriptItem[]
  }

  /**
   * The shared read path: the current session's raw artifact, decoded into
   * events and folded. Resolves `undefined` when no session is live yet;
   * throws the classified failure for every other stop.
   * @param signal - the dispatching UI request's cancellation signal.
   */
  async function readSessionSource(signal: AbortSignal): Promise<SessionExportSource | undefined> {
    const agent = ctx.get('blueSession')?.current
    if (agent === undefined || agent === null) return undefined
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) throw new Error('session persistence is unavailable')
    if (persistence.supportsRawArtifacts === false) {
      throw new Error('this session persistence backend does not expose raw artifacts')
    }
    // The persistence coordinator drains asynchronously (`session/event`
    // write-behind), so a durable read must flush first — the SessionStore's
    // documented pre-read channel (`ctx.get`, never the inject proxy).
    // Safe with no store, no listener (flush returns false), or any backend.
    await ctx.get('sessions')?.flush(agent.session)
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
    return { id: agent.id, cwd: agent.session.header.cwd, items: foldSessionEvents(events) }
  }

  /**
   * The `/export` handler: write the folded transcript as Markdown and
   * flash the path in the hint line.
   * @param rawInput - the command's raw argument string (`[<path>]`).
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
    if (source.items.length === 0) return { kind: 'error', text: 'nothing to export yet' }
    const trimmed = rawInput.trim()
    const outputPath = trimmed.length > 0
      ? resolve(trimmed)
      : join(resolve(source.cwd ?? process.cwd()), defaultExportName(source.id, new Date()))
    const markdown = buildExportMarkdown({
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
    getSharedEditor()?.notice?.(`exported ${String(source.items.length)} items to ${outputPath}`)
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
    try {
      await copyTextToClipboard(text)
    } catch (error) {
      return { kind: 'error', text: `could not copy to clipboard: ${describe(error)}` }
    }
    getSharedEditor()?.notice?.(`copied the last assistant message (${String(text.length)} characters)`)
    return { kind: 'success' }
  }

  const exportCommand = ctx.commands.register({
    name: 'export',
    description: 'Export the current session as a Markdown file',
    input: { hint: '[<path>]' },
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
