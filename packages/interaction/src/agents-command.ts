/**
 * `/agents` — the subagent tree browser. The command lists the active
 * session's subagent tree (the app-owned `blueSessionActions.subagentTree`
 * seam) as an editor-slot select panel: a status dot, label, mode, and
 * token/elapsed metrics per child, local expand/collapse for children with
 * descendants (Space), and grayed non-selectable diagnostic rows. Enter on
 * a child hands off to the `blue-attach-view` plugin's `blueChildAttach`
 * service; when that optional plugin is not mounted the command surfaces a
 * capability-absent notice and stays on the browser. The current session
 * never switches — the tree is addressed by (current session, child id) —
 * and a session switch closes the browser.
 *
 * @module @dsh-blue/blue-interaction/agents-command
 */

import type { Context } from '@deepseek-ai/cordis'
// The named type import also carries the `commands` Context merge.
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// The named type import also carries the app-owned session service Context merges.
import type { BlueSubagentTreeEntry } from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { interactionTranslator } from './locale.ts'
import { CanonicalSelectController, type SelectRow } from './select-list.ts'
import { formatTokens } from './usage.ts'

/** The attach service the optional `blue-attach-view` plugin registers (structural face). */
interface BlueChildAttachSource {
  readonly active: boolean
  open(child: { readonly id: string, readonly label?: string, readonly mode: 'one-shot' | 'continuable' }): void
  close(): void
}

/** kimi `agent-group.ts` elapsed format: `45s`, or `2m 10s` past a minute. */
export function formatAgentElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

/** One metrics summary (`12.3k tok · 3m 42s`), omitting absent facts. */
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

/** The status dot for one tree row: filled while running, hollow when idle. */
function statusDot(entry: BlueSubagentTreeEntry & { readonly kind: 'child' }): string {
  return entry.activity === 'running' ? '●' : '○'
}

/**
 * Build the browser's visible rows from the host's stable pre-order listing
 * and the local expansion set. Rows under a collapsed ancestor are hidden;
 * diagnostic rows are disabled so Enter cannot attach to them.
 * @param entries - the full pre-order tree.
 * @param expanded - ids of children whose descendants are visible.
 * @returns the select rows in display order.
 */
export function buildAgentRows(
  entries: readonly BlueSubagentTreeEntry[],
  expanded: ReadonlySet<string>,
): SelectRow[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const hidden = (entry: BlueSubagentTreeEntry): boolean => {
    if (entry.depth <= 1) return false
    let orphan = true
    let cursor = entry.parentId
    while (true) {
      const parent = byId.get(cursor)
      // A first-hop miss is an orphan (hidden); reaching the root through
      // expanded parents is visible.
      if (parent === undefined) return orphan
      orphan = false
      if (parent.kind === 'child' && parent.hasChildren) {
        if (!expanded.has(parent.id)) return true
        cursor = parent.parentId
        continue
      }
      // A diagnostic or leaf parent cannot be expanded: its rows stay hidden.
      return true
    }
  }
  const rows: SelectRow[] = []
  for (const entry of entries) {
    if (hidden(entry)) continue
    const indent = '  '.repeat(Math.max(0, entry.depth - 1))
    if (entry.kind === 'diagnostic') {
      rows.push({
        value: entry.id,
        label: `${indent}⚠ ${entry.id}`,
        description: `diagnostic: ${entry.reason}`,
        disabled: true,
      })
      continue
    }
    const marker = entry.hasChildren ? (expanded.has(entry.id) ? '▾ ' : '▸ ') : ''
    const label = entry.label ?? entry.id
    const metrics = agentMetricsText(entry, Date.now())
    rows.push({
      value: entry.id,
      label: `${indent}${marker}${statusDot(entry)} ${label}`,
      description: [entry.mode, ...(metrics === '' ? [] : [metrics])].join(' · '),
      ...(entry.activity === 'running' ? { badge: 'running' } : {}),
      filterText: `${label} ${entry.id} ${entry.mode}`,
    })
  }
  return rows
}

/**
 * Register the `/agents` command: the subagent tree browser. The returned
 * disposer (run by the commands plugin's effect) closes an open browser on
 * unload.
 * @param ctx - plugin context (`commands` via the calling plugin).
 * @returns the disposer removing the registration and the open panel.
 */
export function registerAgentsCommand(ctx: Context): () => void {
  const t = interactionTranslator(ctx)
  let unloaded = false
  let closeBrowser: (() => void) | undefined

  /**
   * The `/agents` handler: list the tree, mount the browser, wire attach.
   * @returns the command outcome.
   */
  async function showAgents(): Promise<CommandResult> {
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'agents panel is unavailable: the Blue screen is not mounted' }
    }
    const result = await ctx.blueSessionActions.subagentTree()
    if (unloaded) return { kind: 'success' }
    if (!result.ok) return { kind: 'error', text: result.message }
    const entries = result.value
    if (entries.length === 0) return { kind: 'success', text: t('no subagents in this session') }
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const expanded = new Set<string>()
    const currentId = ctx.blueSessionReader.current()?.id

    let restore: (() => void) | undefined
    const close = (): void => {
      readerSubscription.dispose()
      restore?.()
      restore = undefined
      closeBrowser = undefined
    }
    // A session switch strands the tree: the browser addresses the old session.
    const readerSubscription = ctx.blueSessionReader.subscribe(snapshot => {
      if (snapshot === null || snapshot.id === currentId) return
      close()
    })
    const browser = new CanonicalSelectController({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows: buildAgentRows(entries, expanded),
      title: t('Subagents'),
      footer: 'Enter attach · Space expand · Esc close',
      t,
      onToggle: row => {
        const entry = byId.get(row.value)
        if (entry?.kind !== 'child' || !entry.hasChildren) return
        if (expanded.has(entry.id)) expanded.delete(entry.id)
        else expanded.add(entry.id)
        browser.setRows(buildAgentRows(entries, expanded))
      },
      onSelect: row => {
        const entry = byId.get(row.value)
        /* v8 ignore next -- the controller routes disabled (diagnostic) rows to onBlockedSelect, so onSelect only fires for child rows. */
        if (entry?.kind !== 'child') return
        const attach = ctx.get('blueChildAttach') as BlueChildAttachSource | undefined
        if (attach === undefined) {
          getSharedEditor(ctx)?.notice?.(display.colors.error(t('the attach view is unavailable: the blue-attach-view plugin is not mounted')))
          // The notice rides the editor's hint line, which only re-enters
          // the tree on close; repaint so the keypress is not a dead frame.
          browser.invalidate()
          return
        }
        attach.open({
          id: entry.id,
          ...(entry.label === undefined ? {} : { label: entry.label }),
          mode: entry.mode,
        })
      },
      onCancel: () => {
        close()
      },
    })
    restore = mountEditorReplacement(ctx, browser)
    closeBrowser = close
    return { kind: 'success' }
  }

  const agents = ctx.commands.register({
    name: 'agents',
    description: 'Browse this session\'s subagents and attach to one',
    handler: () => showAgents(),
  })
  return () => {
    unloaded = true
    closeBrowser?.()
    agents()
  }
}
