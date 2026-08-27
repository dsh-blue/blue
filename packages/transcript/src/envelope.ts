/**
 * Conservative raw-payload handling for dsh model-facing tool results.
 *
 * Tools return model-facing text in a few fixed shapes that a presenter-less
 * fallback used to echo raw into the card: file tools wrap results in an XML
 * envelope (consecutive top-level `<tag>value</tag>` pairs, a multi-line
 * `<content>` block), the jobs reader trails incremental output with
 * `[status: ...]`, and presenter-less tools (the ask-user reader, for one)
 * return bare JSON. This module recognizes each shape and collapses it to one
 * human-readable summary line instead. Parsing is deliberately conservative:
 * anything that does not parse whole passes through untouched, so plain tool
 * output and error messages are never mangled.
 *
 * @module @dsh-blue/blue-transcript/envelope
 */

import { ellipsize } from './present.ts'

/** One recognized top-level `<tag>value</tag>` pair of an envelope. */
export interface EnvelopePair {
  readonly tag: string
  readonly value: string
}

/** A whole line that is exactly `<tag>value</tag>` (single-line pair form). */
const INLINE_PAIR = /^<([a-zA-Z_][a-zA-Z0-9_-]*)>(.*)<\/\1>$/

/** A whole line that is exactly `<tag>` (block pair form, value on the following lines). */
const BLOCK_OPEN = /^<([a-zA-Z_][a-zA-Z0-9_-]*)>$/

/** Minimum pair count a text must have to count as an envelope (real ones carry path/type/content). */
const MIN_PAIRS = 2

/** Default cap for the flattened summary line. */
const SUMMARY_MAX_CHARS = 160

/** List items a compacted JSON array shows before counting the rest away. */
const JSON_LIST_LIMIT = 3

/** Object entries a compacted JSON value shows before counting the rest away. */
const JSON_ENTRY_LIMIT = 4

/**
 * Parse a tool result text as one XML envelope.
 * @param text - the model-facing result text exactly as the tool returned it.
 * @returns the top-level pairs in order, or `undefined` when the text is not
 *   wholly a run of `<tag>value</tag>` pairs (trailing blank lines tolerated).
 */
export function parseXmlEnvelope(text: string): readonly EnvelopePair[] | undefined {
  const lines = text.split('\n')
  let end = lines.length
  while (end > 0 && lines[end - 1]!.trim() === '') end -= 1
  const pairs: EnvelopePair[] = []
  let index = 0
  while (index < end) {
    const line = lines[index]!
    const inline = INLINE_PAIR.exec(line)
    if (inline !== null) {
      pairs.push({ tag: inline[1]!, value: inline[2]! })
      index += 1
      continue
    }
    const open = BLOCK_OPEN.exec(line)
    if (open === null) return undefined
    const close = `</${open[1]!}>`
    let scan = index + 1
    while (scan < end && lines[scan] !== close) scan += 1
    if (scan >= end) return undefined
    pairs.push({ tag: open[1]!, value: lines.slice(index + 1, scan).join('\n') })
    index = scan + 1
  }
  return pairs.length >= MIN_PAIRS ? pairs : undefined
}

/** The read footer when a read's content ends with a parenthesized trailer line. */
function footerDescriptor(content: string): string | undefined {
  const lines = content.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (line === '') continue
    if (!line.startsWith('(') || !line.endsWith(')')) return undefined
    const capped = /^\(Output capped\. Showing lines (\d+)-(\d+)\./.exec(line)
    if (capped !== null) return `lines ${capped[1]!}-${capped[2]!} (output capped)`
    const showing = /^\(Showing lines (\d+)-(\d+) of (\d+)\./.exec(line)
    if (showing !== null) return `lines ${showing[1]!}-${showing[2]!} of ${showing[3]!}`
    const ended = /^\(End of file - total (\d+) lines\)/.exec(line)
    if (ended !== null) return `end of file, ${ended[1]!} total lines`
    return undefined
  }
  return undefined
}

/** The incremental-output trailer the jobs reader (and friends) document: `[status: ...]`. */
const STATUS_TRAILER = /^\[status: ([^\]]+)\]$/

/**
 * Collapse a tool result text to one summary line when it is an XML envelope,
 * an incremental job read, or a bare JSON object/array.
 * @param text - the model-facing result text.
 * @param maxChars - the flattened summary cap (defaults to
 *   {@link SUMMARY_MAX_CHARS}).
 * @returns `path · descriptor` for an envelope, `+N lines · status X` for an
 *   incremental read carrying the jobs `[status: ...]` trailer, a flattened
 *   `key: value` line for a whole-text JSON payload, or the original text
 *   untouched when it is none of these — plain output and error messages
 *   never lose content here.
 */
export function summarizeToolText(text: string, maxChars = SUMMARY_MAX_CHARS): string {
  const pairs = parseXmlEnvelope(text)
  if (pairs !== undefined) return summarizeEnvelope(pairs, maxChars)
  const incremental = summarizeIncrementalRead(text, maxChars)
  if (incremental !== text) return incremental
  return summarizeJsonText(text, maxChars) ?? text
}

/** `path · descriptor` for one parsed envelope. */
function summarizeEnvelope(pairs: readonly EnvelopePair[], maxChars: number): string {
  const path = pairs.find(pair => pair.tag === 'path')?.value
  const content = pairs.find(pair => pair.tag === 'content')?.value ?? ''
  const firstLine = content.split('\n').find(line => line.trim() !== '') ?? ''
  let descriptor = footerDescriptor(content) ?? firstLine.trim()
  if (descriptor === '') descriptor = pairs.find(pair => pair.tag !== 'path' && pair.tag !== 'content')?.value ?? ''
  const summary = path === undefined || path === '' ? descriptor : descriptor === '' ? path : `${path} · ${descriptor}`
  return ellipsize(summary, maxChars)
}

/** `+N lines · status X` for a `[status: ...]`-trailed incremental read, or the original text. */
function summarizeIncrementalRead(text: string, maxChars: number): string {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.trim()
    if (line === '') continue
    const status = STATUS_TRAILER.exec(line)
    if (status === null) return text
    const body = lines.slice(0, index).filter(part => part.trim() !== '').length
    return ellipsize(`+${String(body)} ${body === 1 ? 'line' : 'lines'} · status ${String(status[1]!)}`, maxChars)
  }
  return text
}

/** A whole-text JSON object/array flattened to `key: value` parts, or `undefined` for non-JSON. */
function summarizeJsonText(text: string, maxChars: number): string | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0 || (trimmed[0] !== '{' && trimmed[0] !== '[')) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return '[]'
    const shown = parsed.slice(0, JSON_LIST_LIMIT).map(compactJsonValue)
    const rest = parsed.length - JSON_LIST_LIMIT
    return ellipsize(rest > 0 ? [...shown, `+${String(rest)} more`].join(' · ') : shown.join(' · '), maxChars)
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  const shown = entries.slice(0, JSON_ENTRY_LIMIT).map(([key, value]) => `${key}: ${compactJsonValue(value)}`)
  const rest = entries.length - JSON_ENTRY_LIMIT
  return ellipsize(rest > 0 ? [...shown, `+${String(rest)} more`].join(' · ') : shown.join(' · '), maxChars)
}

/** One JSON value flattened for the summary line: single-item lists unwrap, long tails count away. */
function compactJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.length === 1) return compactJsonValue(value[0])
    const shown = value.slice(0, JSON_LIST_LIMIT).map(compactJsonValue).join(', ')
    return value.length > JSON_LIST_LIMIT ? `[${shown}, +${String(value.length - JSON_LIST_LIMIT)}]` : `[${shown}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const shown = entries.slice(0, JSON_ENTRY_LIMIT).map(([key, inner]) => `${key}=${compactJsonValue(inner)}`).join(', ')
    return entries.length > JSON_ENTRY_LIMIT ? `${shown}, +${String(entries.length - JSON_ENTRY_LIMIT)} more` : shown
  }
  return primitiveJsonValue(value as string | number | boolean | null)
}

/** A JSON primitive flattened: strings stay readable (empty quoted), the rest stringify. */
function primitiveJsonValue(value: string | number | boolean | null): string {
  if (typeof value === 'string') return value.trim() === '' ? '""' : ellipsize(value, 60)
  return String(value)
}
