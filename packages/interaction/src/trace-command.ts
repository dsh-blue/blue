/**
 * `/trace` command: a thin UI over the official `ctx.sessionQuery` reads.
 * No session data is persisted or reimplemented by Blue.
 *
 * @module @dsh-blue/blue-interaction/trace-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildSessionEventRecords } from '@deepseek-ai/dsh-session-query'
import type { SessionEventRecord } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Action } from '@dsh-blue/blue-frontend'
import { copyTextToClipboard } from './clipboard-write.ts'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { CanonicalDocumentController, type FrontendPanelDocument } from './frontend-panel.ts'
import { formatTraceAll, formatTraceItem, type TraceItem } from './trace-format.ts'
import { aggregateTraceItems } from './trace-aggregate.ts'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function traceTime(time: number): string {
  const date = new Date(time)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 19) : '??:??:??'
}

/** Build the renderer-neutral trace timeline model. */
export function tracePanelModel(sessionId: string, items: readonly TraceItem[]): FrontendPanelDocument {
  if (items.length === 0) {
    return { mode: 'info', title: `Trace · ${sessionId}`, view: { kind: 'text', content: 'no trace events yet', tone: 'muted' } }
  }
  return {
    mode: 'select',
    title: `Trace · ${sessionId}`,
    selectedId: String(items[0]!.seq),
    items: items.map(item => ({
        id: String(item.seq),
        label: `${traceTime(item.time)} ${item.surface === 'current' ? '●' : '·'} #${String(item.seq)}${item.lastSeq === item.seq ? '' : `-${String(item.lastSeq)}`} ${item.title}`,
        detail: item.summary.replaceAll(/\s+/g, ' ').trim(),
        action: { kind: 'trace.detail', seq: item.seq },
        actionLabel: 'Open detail',
        secondaryAction: { kind: 'trace.copy', seq: item.seq },
        secondaryActionLabel: 'Copy trace item',
    })),
    cancel: { kind: 'trace.close' },
  }
}

/** Build the renderer-neutral raw detail model for one trace item. */
export function traceDetailPanelModel(item: TraceItem, text: string): FrontendPanelDocument {
  return {
    mode: 'info',
    title: `Trace detail ${item.lastSeq === item.seq ? `#${String(item.seq)}` : `#${String(item.seq)}-${String(item.lastSeq)}`}`,
    view: { kind: 'sections', sections: [
      { title: `${item.type} · ${item.surface} · source #${String(item.seq)}`, body: { kind: 'code', code: text, language: 'json' } },
    ] },
    cancel: { kind: 'trace.detail.close' },
  }
}

/** Register `/trace` and its copy subcommands. */
export function registerTraceCommand(ctx: Context): () => void {
  async function loadItems(): Promise<{ sessionId: SessionId, records: SessionEventRecord[], events: SessionEvent[], items: TraceItem[] } | undefined> {
    const current = ctx.blueCurrentAgent.current()
    const query = ctx.get('sessionQuery')
    if (current === null) return undefined
    if (query === undefined) throw new Error('session query is unavailable')
    const sessionId = current.id
    const snapshot = await query.readSession(sessionId)
    const records = buildSessionEventRecords(sessionId, snapshot.events)
    return { sessionId, records, events: snapshot.events, items: aggregateTraceItems(records, snapshot.events) }
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
      getSharedEditor(ctx)?.notice?.(`copied trace item #${String(item.seq)}${method === 'osc52' ? ' via terminal escape sequence (unverified)' : ''}`)
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
      getSharedEditor(ctx)?.notice?.(`copied ${String(loaded.items.length)} trace events${method === 'osc52' ? ' via terminal escape sequence (unverified)' : ''}`)
      return { kind: 'success' }
    }
    const match = /^copy\s+(\d+)$/.exec(input)
    if (match !== null) {
      const item = loaded.items.find(entry => entry.seq === Number(match[1]))
      if (item === undefined) return { kind: 'error', text: `trace event #${match[1]} was not found` }
      return copyItem(loaded.sessionId, item, loaded.events)
    }
    const display = displayServices(ctx)
    if (display === undefined) return { kind: 'error', text: 'trace is unavailable: the Blue screen is not mounted' }
    let restore: () => void
    const model = tracePanelModel(String(loaded.sessionId), loaded.items)
    const execute = (action: Action): void => {
      if (action.kind === 'trace.copy-all') {
        void copyTextToClipboard(formatTraceAll(loaded.items, String(loaded.sessionId))).then(method => {
          getSharedEditor(ctx)?.notice?.(`copied ${String(loaded.items.length)} trace events${method === 'osc52' ? ' via terminal escape sequence (unverified)' : ''}`)
        }).catch(error => getSharedEditor(ctx)?.notice?.(`could not copy trace: ${describe(error)}`))
        return
      }
      const seq = typeof action.seq === 'number' ? action.seq : undefined
      const item = seq === undefined ? undefined : loaded.items.find(entry => entry.seq === seq)
      if (item === undefined) return
      if (action.kind === 'trace.copy') {
        void copyItem(loaded.sessionId, item, loaded.events).then(result => {
          if (result.kind === 'error') getSharedEditor(ctx)?.notice?.(result.text)
        })
        return
      }
      if (action.kind === 'trace.detail') {
        const eventBySeq = new Map(loaded.events.map(event => [event.seq, event]))
        const rawEvents = item.eventSeqs.flatMap(seq => {
          const event = eventBySeq.get(seq)
          /* v8 ignore next -- aggregateTraceItems derives these seqs from
             the same immutable event snapshot used to build this map. */
          return event === undefined ? [] : [event]
        })
        let restoreDetail: () => void
        const detail = new CanonicalDocumentController({
          ...display,
          model: () => traceDetailPanelModel(item, JSON.stringify(rawEvents, null, 2)),
          onAction: () => undefined,
          onClose: () => restoreDetail(),
          maxVisible: 14,
        })
        restoreDetail = mountEditorReplacement(ctx, detail)
      }
    }
    const panel = new CanonicalDocumentController({
      ...display,
      model: () => model,
      onAction: execute,
      onClose: () => restore(),
      maxVisible: 12,
    })
    restore = mountEditorReplacement(ctx, panel)
    return { kind: 'success' }
  }

  const command = ctx.commands.register({
    name: 'trace',
    description: 'Browse and copy the current session execution trace',
    input: { hint: '[copy <seq>|copy all]' },
    handler: invocation => open(invocation.rawInput),
  })
  return () => command()
}
