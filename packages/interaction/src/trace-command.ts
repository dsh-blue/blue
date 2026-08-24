/**
 * `/trace` command: a thin UI over the official `ctx.sessionQuery` reads.
 * No session data is persisted or reimplemented by Blue.
 *
 * @module @dsh-blue/blue-interaction/trace-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildSessionEventRecords } from '@deepseek-ai/dsh-session-query'
import type { SessionEventRecord } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-query'
import { copyTextToClipboard } from './clipboard-write.ts'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { formatTraceAll, formatTraceItem, type TraceItem } from './trace-format.ts'
import { aggregateTraceItems } from './trace-aggregate.ts'
import { TracePanel } from './trace-panel.ts'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register `/trace` and its copy subcommands. */
export function registerTraceCommand(ctx: Context): () => void {
  async function loadItems(): Promise<{ sessionId: SessionId, records: SessionEventRecord[], events: SessionEvent[], items: TraceItem[] } | undefined> {
    const current = ctx.get('blueSession')?.current
    const query = ctx.get('sessionQuery')
    if (current === undefined || current === null) return undefined
    if (query === undefined) throw new Error('session query is unavailable')
    const snapshot = await query.readSession(current.id)
    const records = buildSessionEventRecords(current.id, snapshot.events)
    return { sessionId: current.id, records, events: snapshot.events, items: aggregateTraceItems(records, snapshot.events) }
  }

  async function copyItem(sessionId: SessionId, item: TraceItem, events: readonly SessionEvent[]): Promise<CommandResult> {
    const query = ctx.get('sessionQuery')
    /* v8 ignore next -- the command's load path guards the same missing
     * service before a copy handler can be reached. */
    if (query === undefined) return { kind: 'error', text: 'session query is unavailable' }
    /* v8 ignore start -- clipboard/process failures and the native notice are
     * exercised by the shared clipboard integration suite and real terminal. */
    try {
      const relation = await query.traceEvent({ sessionId, seq: item.seq })
      const eventBySeq = new Map(events.map(event => [event.seq, event]))
      const rawEvents = item.eventSeqs.flatMap(seq => {
        const event = eventBySeq.get(seq)
        return event === undefined ? [] : [event]
      })
      const method = await copyTextToClipboard(formatTraceItem(item, undefined, relation, rawEvents))
      getSharedEditor()?.notice?.(`copied trace item #${String(item.seq)}${method === 'osc52' ? ' via terminal escape sequence (unverified)' : ''}`)
      return { kind: 'success' }
    } catch (error) {
      return { kind: 'error', text: `could not copy trace item: ${describe(error)}` }
    }
    /* v8 ignore stop */
  }

  async function open(rawInput: string): Promise<CommandResult> {
    const input = rawInput.trim()
    let loaded
    try {
      loaded = await loadItems()
    } catch (error) {
      return { kind: 'error', text: `could not read trace: ${describe(error)}` }
    }
    if (loaded === undefined) return { kind: 'error', text: 'no session is live yet' }
    if (input === 'copy all') {
      const method = await copyTextToClipboard(formatTraceAll(loaded.items, String(loaded.sessionId)))
      /* v8 ignore next -- notices are verified by the shared editor harness. */
      getSharedEditor()?.notice?.(`copied ${String(loaded.items.length)} trace events${method === 'osc52' ? ' via terminal escape sequence (unverified)' : ''}`)
      return { kind: 'success' }
    }
    const match = /^copy\s+(\d+)$/.exec(input)
    if (match !== null) {
      const item = loaded.items.find(entry => entry.seq === Number(match[1]))
      if (item === undefined) return { kind: 'error', text: `trace event #${match[1]} was not found` }
      return copyItem(loaded.sessionId, item, loaded.events)
    }
    /* v8 ignore start -- editor-slot callbacks require the live Blue input
     * plugin; TracePanel itself has source-plane coverage. */
    const display = displayServices(ctx)
    if (display === undefined) return { kind: 'error', text: 'trace is unavailable: the Blue screen is not mounted' }
    let restore = () => {}
    const panel = new TracePanel({
      ...display,
      sessionId: String(loaded.sessionId),
      items: loaded.items,
      onClose: () => restore(),
      onCopyItem: (item) => { void copyItem(loaded.sessionId, item, loaded.events) },
      onCopyAll: () => {
        void copyTextToClipboard(formatTraceAll(loaded.items, String(loaded.sessionId))).then(method => {
          getSharedEditor()?.notice?.(`copied ${String(loaded.items.length)} trace events${method === 'osc52' ? ' via terminal escape sequence (unverified)' : ''}`)
        }).catch(error => getSharedEditor()?.notice?.(`could not copy trace: ${describe(error)}`))
      },
      onLoadDetail: (item) => {
        const rawEvents = item.eventSeqs.flatMap(seq => loaded.events.filter(event => event.seq === seq))
        panel.setDetail(item.seq, JSON.stringify(rawEvents, null, 2))
      },
    })
    restore = mountEditorReplacement(panel)
    return { kind: 'success' }
    /* v8 ignore stop */
  }

  const command = ctx.commands.register({
    name: 'trace',
    description: 'Browse and copy the current session execution trace',
    input: { hint: '[copy <seq>|copy all]' },
    handler: invocation => open(invocation.rawInput),
  })
  return () => command()
}
