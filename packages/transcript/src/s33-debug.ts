/**
 * S33 dogfood verification plugin — TEMPORARY, NEVER MERGED.
 *
 * Logs every session/event envelope plus ephemeral subagent/start|end probes
 * to /tmp/s33-dogfood.log so the S33 child-session tracker design can be
 * verified against a real run: admission keys (header.origin /
 * header.parentSession), child stream shape (first user/message === parent
 * delegation prompt, request/header config, per-step usage, turn/end
 * reasons), and whether the ephemeral events reach an unscoped plugin ctx.
 * File logging only — the TUI owns the screen.
 *
 * @module @dsh-blue/blue-transcript/s33-debug
 */

import { appendFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'blue-s33-debug'

const LOG = '/tmp/s33-dogfood.log'

function log(line: string): void {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // The log is best-effort; a failed append must never break the TUI.
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return `(unserializable: ${error instanceof Error ? error.message : String(error)})`
  }
}

/** First ~n chars of a string, single line. */
function head(value: string | undefined, n: number): string {
  if (value === undefined) return '(none)'
  const oneLine = value.replaceAll(/\s+/g, ' ')
  return oneLine.length <= n ? oneLine : `${oneLine.slice(0, n)}…`
}

/** Join an event content-block array's text (user/message, tool results). */
function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'text' in block
      && typeof (block as { text: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/** A per-event-type summary line for the firehose log. */
function summarize(event: { type: string; data: unknown }): string {
  const data = event.data as Record<string, unknown>
  switch (event.type) {
    case 'user/message': {
      const source = data['source'] as { kind?: string } | undefined
      return `user/message src=${source?.kind ?? '?'} text="${head(contentText(data['content']) ?? (typeof data['text'] === 'string' ? data['text'] : undefined), 120)}"`
    }
    case 'assistant/chunk': {
      const chunk = data['chunk'] as { type?: string; text?: string } | undefined
      return `chunk ${chunk?.type ?? '?'}"${head(chunk?.text, 60)}"`
    }
    case 'assistant/message': {
      const usage = data['usage'] as Record<string, number> | undefined
      return `assistant/message turn=${String(data['turn'])} step=${String(data['step'])} usage=${usage === undefined ? '(none)' : safeJson(usage)}`
    }
    case 'tool/call': {
      return `tool/call turn=${String(data['turn'])} step=${String(data['step'])} callId=${String(data['callId'])} name=${String(data['name'])} args="${head(typeof data['arguments'] === 'string' ? data['arguments'] : undefined, 140)}"`
    }
    case 'tool/result': {
      const message = data['message'] as { content?: unknown[] } | undefined
      const first = message?.content?.[0] as { toolCallId?: string; text?: string } | undefined
      return `tool/result turn=${String(data['turn'])} step=${String(data['step'])} callId=${first?.toolCallId ?? '(none)'} error=${safeJson(data['error'])} text="${head(first?.text, 160)}"`
    }
    case 'request/header': {
      const header = data['header'] as { config?: Record<string, unknown> } | undefined
      return `request/header config=${safeJson(header?.config)}`
    }
    case 'turn/end': {
      return `turn/end turn=${String(data['turn'])} reason=${safeJson(data['reason'])}`
    }
    case 'turn/start':
    case 'step/start':
    case 'step/end':
      return `${event.type} turn=${String(data['turn'])} step=${String(data['step'])}`
    default:
      return `${event.type} data=${head(safeJson(data), 160)}`
  }
}

export function apply(ctx: Context): void {
  log(`=== s33-debug plugin applied ===`)
  // The full firehose: every session's events, tagged with the admission keys.
  ctx.on('session/event', (session, event) => {
    const header = session.header as { id?: string; origin?: string; parentSession?: string } | undefined
    log(
      `[${session.id}] origin=${header?.origin ?? '(none)'} parent=${header?.parentSession ?? '(none)'} ` +
      `seq=${String(event.seq)} t=${String(event.time)} ${summarize(event)}`,
    )
  })
  // The ephemeral probes: do they reach an unscoped plugin ctx at all?
  // The typed `on` overloads reject these names at compile time (the Events
  // merge lives in the uninstalled dsh-subagent) — the runtime registry
  // accepts any string, so go through the untyped overload. This very
  // friction is part of what S33's dogfood records.
  const onAny = ctx.on as unknown as (name: string, listener: (...args: unknown[]) => void) => () => void
  onAny('subagent/start', (...args: unknown[]) => {
    log(`EPHEMERAL subagent/start args=${safeJson(args)}`)
  })
  onAny('subagent/end', (...args: unknown[]) => {
    log(`EPHEMERAL subagent/end args=${safeJson(args)}`)
  })
}
