/**
 * `/agents` browser over the native subagent descendant catalog.
 *
 * @module @dsh-blue/blue-interaction/agents-command
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { interactionTranslator } from './locale.ts'
import { CanonicalSelectController, type SelectRow } from './select-list.ts'
import { mountChildAttach, type ChildAttachHandle } from './attach-view.ts'
import { formatTokens } from './usage.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-agents-command'

/** Native and Blue services required by the browser and attach view. */
export const inject = [
  'commands',
  'subagents',
  'agents',
  'sessions',
  'sessionProjections',
  'blueCurrentAgent',
  'blueEditorHost',
  'tools',
]

/** Native row plus optional metrics from a currently resident child. */
export type BlueSubagentTreeEntry = SubagentDescendantListEntry & {
  readonly tokens?: number | undefined
  readonly settledMs?: number | undefined
  readonly activeSince?: number | undefined
}

/** Elapsed format used by agent browser rows. */
export function formatAgentElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

/** Optional token and elapsed summary. */
export function agentMetricsText(
  entry: { readonly tokens?: number | undefined, readonly settledMs?: number | undefined, readonly activeSince?: number | undefined },
  now: number,
): string {
  const parts: string[] = []
  if (entry.tokens !== undefined) parts.push(`${formatTokens(entry.tokens)} tok`)
  const elapsed = entry.activeSince !== undefined ? now - entry.activeSince : entry.settledMs
  if (elapsed !== undefined) parts.push(formatAgentElapsed(elapsed))
  return parts.join(' · ')
}

/** Build visible stable-preorder rows under the local expansion set. */
export function buildAgentRows(
  entries: readonly BlueSubagentTreeEntry[],
  expanded: ReadonlySet<string>,
  now = Date.now(),
): SelectRow[] {
  const byId = new Map(entries.map(entry => [String(entry.id), entry]))
  const hidden = (entry: BlueSubagentTreeEntry): boolean => {
    if (entry.depth <= 1) return false
    let orphan = true
    let cursor = String(entry.parentId)
    while (true) {
      const parent = byId.get(cursor)
      if (parent === undefined) return orphan
      orphan = false
      if (parent.kind === 'child' && parent.hasChildren) {
        if (!expanded.has(String(parent.id))) return true
        cursor = String(parent.parentId)
        continue
      }
      return true
    }
  }
  const rows: SelectRow[] = []
  for (const entry of entries) {
    if (hidden(entry)) continue
    const id = String(entry.id)
    const indent = '  '.repeat(Math.max(0, entry.depth - 1))
    if (entry.kind === 'diagnostic') {
      rows.push({ value: id, label: `${indent}⚠ ${id}`, description: `diagnostic: ${entry.reason}`, disabled: true })
      continue
    }
    const marker = entry.hasChildren ? (expanded.has(id) ? '▾ ' : '▸ ') : ''
    const label = entry.label ?? id
    const metrics = agentMetricsText(entry, now)
    rows.push({
      value: id,
      label: `${indent}${marker}${entry.activity === 'running' ? '●' : '○'} ${label}`,
      description: [entry.mode, ...(metrics === '' ? [] : [metrics])].join(' · '),
      ...(entry.activity === 'running' ? { badge: 'running' } : {}),
      filterText: `${label} ${id} ${entry.mode}`,
    })
  }
  return rows
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function withLiveMetrics(ctx: Context, entries: readonly SubagentDescendantListEntry[]): readonly BlueSubagentTreeEntry[] {
  const sessions = new Map([...ctx.sessions.list()].map(session => [String(session.id), session]))
  return entries.map(entry => {
    if (entry.kind !== 'child') return entry
    const session = sessions.get(String(entry.id))
    if (session === undefined) return entry
    const values = ctx.sessionProjections.snapshot(session, ['blueConversationFacts', 'subagentTiming']).values
    const facts = values.blueConversationFacts as { readonly epochTokens?: unknown } | undefined
    const timing = values.subagentTiming as { readonly settledMs?: unknown, readonly active?: { readonly since?: unknown } } | undefined
    return {
      ...entry,
      ...(typeof facts?.epochTokens === 'number' ? { tokens: facts.epochTokens } : {}),
      ...(typeof timing?.settledMs === 'number' ? { settledMs: timing.settledMs } : {}),
      ...(typeof timing?.active?.since === 'number' ? { activeSince: timing.active.since } : {}),
    }
  })
}

/** Register `/agents`; every open browser and attach is fiber-owned. */
export function apply(ctx: Context): void {
  const t = interactionTranslator(ctx)
  let closeOpenBrowser: (() => void) | undefined
  let unloaded = false

  async function showAgents(signal: AbortSignal): Promise<CommandResult> {
    const display = displayServices(ctx)
    if (display === undefined) return { kind: 'error', text: t('agents panel is unavailable: the Blue screen is not mounted') }
    const parent = ctx.blueCurrentAgent.current()
    if (parent === null) return { kind: 'error', text: t('no session is live yet') }
    let listed: readonly SubagentDescendantListEntry[]
    try {
      listed = await ctx.subagents.listDescendants(parent.id, signal)
    } catch (error) {
      return { kind: 'error', text: describe(error) }
    }
    if (unloaded || ctx.blueCurrentAgent.current() !== parent) return { kind: 'success' }
    if (listed.length === 0) return { kind: 'success', text: t('no subagents in this session') }
    closeOpenBrowser?.()
    const entries = withLiveMetrics(ctx, listed)
    const byId = new Map(entries.map(entry => [String(entry.id), entry]))
    const expanded = new Set<string>()
    let restore: (() => void) | undefined
    let attach: ChildAttachHandle | undefined
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      offAgent()
      attach?.close()
      attach = undefined
      restore?.()
      restore = undefined
      closeOpenBrowser = undefined
    }
    const offAgent = ctx.blueCurrentAgent.subscribe(next => {
      if (next !== parent) close()
    })
    const browser = new CanonicalSelectController({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows: buildAgentRows(entries, expanded),
      title: t('Subagents'),
      footer: t('Enter attach · Space expand · Esc close'),
      t,
      onToggle: row => {
        const entry = byId.get(row.value)
        if (entry?.kind !== 'child' || !entry.hasChildren) return
        if (expanded.has(row.value)) expanded.delete(row.value)
        else expanded.add(row.value)
        browser.setRows(buildAgentRows(entries, expanded))
      },
      onSelect: row => {
        const entry = byId.get(row.value)
        if (entry?.kind !== 'child') return
        attach?.close()
        attach = mountChildAttach(ctx, parent, {
          id: String(entry.id),
          ...(entry.label === undefined ? {} : { label: entry.label }),
          mode: entry.mode,
        }, () => { attach = undefined })
      },
      onCancel: close,
    })
    restore = mountEditorReplacement(ctx, browser)
    closeOpenBrowser = close
    return { kind: 'success' }
  }

  const command = ctx.commands.register({
    name: 'agents',
    description: t('Browse this session\'s subagents and attach to one'),
    handler: invocation => showAgents(invocation.signal),
  })
  ctx.effect(() => () => {
    unloaded = true
    closeOpenBrowser?.()
    command()
  })
}
