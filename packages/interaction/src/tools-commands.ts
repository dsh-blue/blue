/**
 * The `/tools` command (S28): a read-only `InfoPanel` over the current
 * session's visible tool catalog, enumerated live from the tool registry.
 *
 * The view scope is the composition the agent runs on: under the thin-host
 * migration (D37) the agent's tool surface lives in its preset's standing
 * mount, so the panel enumerates `schemas(roster.standingKeyFor(...))` —
 * the upstream API built for exactly this "host reader with no agent"
 * case. `scopeOf(agent.ctx)` is deliberately NOT used: `kScope` is a
 * module-level Symbol in dsh-scope, and a dev-linked Blue loads its own
 * dsh-scope instance beside the CLI's — two Symbols, so the CLI-side tag
 * never reads back (the registry install may dedupe to one instance, but
 * the panel must work on the dogfood link too). With no roster — or an
 * agent bound to no preset — the panel falls back to the global view,
 * which is the honest catalog on hosts that keep their own agent plane.
 * MCP tools (`mcp__<server>__*`, the mcp-client's public naming) group
 * under one section per server; the model-facing name stays the row label
 * verbatim because that name is what the model calls. The panel is
 * display-only: managing MCP servers is a profile-patch concern upstream
 * (⛔ commands-plan §7 #6), so every key here closes.
 *
 * @module @dsh-blue/blue-interaction/tools-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
// Empty type imports carry the `tools` Context merge (dsh-tools) the probe
// reads, the `commands` merge the registration uses, and the app-owned
// `blueSession` merge the handler resolves the agent through.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { InfoPanel, type InfoSection } from './info-panel.ts'
import type { AgentPresetsRoster } from './preset-commands.ts'
import { oneLine } from './select-list.ts'

/** The public prefix of MCP-served tool names (`mcp__<server>__<raw>`). */
const MCP_PREFIX = 'mcp__'

/**
 * One section's rows out of one bucket of schemas, name-sorted: the full
 * model-facing name is the label, the one-line description the value.
 * @param bucket - the bucket's schemas, any order.
 * @returns the aligned info rows.
 */
function toolRows(bucket: readonly ToolSchema[]): InfoSection['rows'] {
  return [...bucket]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(schema => ({
      label: schema.name,
      segments: schema.description.trim() === ''
        ? [{ text: '(no description)', style: 'muted' as const }]
        : [{ text: oneLine(schema.description) }],
    }))
}

/**
 * Build the `/tools` panel sections: the built-in catalog first, then one
 * section per MCP server (server-sorted), counts in every heading. A
 * server segment splits on the first `__` after the prefix — server names
 * may contain underscores but the display grouping tolerates the rare
 * ambiguous collision.
 * @param schemas - the live per-scope tool enumeration.
 * @returns the panel sections, display order.
 */
export function buildToolsSections(schemas: readonly ToolSchema[]): InfoSection[] {
  if (schemas.length === 0) {
    return [{
      heading: 'tools',
      rows: [{ label: 'none', segments: [{ text: 'no tools visible to this session', style: 'muted' }] }],
    }]
  }
  const builtin: ToolSchema[] = []
  const servers = new Map<string, ToolSchema[]>()
  for (const schema of schemas) {
    if (!schema.name.startsWith(MCP_PREFIX)) {
      builtin.push(schema)
      continue
    }
    const rest = schema.name.slice(MCP_PREFIX.length)
    const separator = rest.indexOf('__')
    const server = separator === -1 ? rest : rest.slice(0, separator)
    const bucket = servers.get(server)
    if (bucket === undefined) servers.set(server, [schema])
    else bucket.push(schema)
  }
  const sections: InfoSection[] = []
  if (builtin.length > 0) sections.push({ heading: `Tools (${builtin.length})`, rows: toolRows(builtin) })
  for (const server of [...servers.keys()].sort()) {
    const bucket = servers.get(server)!
    sections.push({ heading: `MCP · ${server} (${bucket.length})`, rows: toolRows(bucket) })
  }
  return sections
}

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register the `/tools` command: mount the read-only catalog panel.
 * @param ctx - plugin context (`commands` via the calling plugin).
 * @returns the disposer removing the registration.
 */
export function registerToolsCommands(ctx: Context): () => void {
  // The fiber-unload flag: the standing-key await can span a tree unload.
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })

  /**
   * The `/tools` handler: guards, resolve the view scope, enumerate, mount.
   * @returns the command outcome.
   */
  async function showTools(): Promise<CommandResult> {
    const agent = ctx.get('blueSession')?.current
    if (agent === undefined || agent === null) {
      return { kind: 'error', text: 'no session is live yet' }
    }
    const tools = ctx.get('tools')
    if (tools === undefined) {
      return { kind: 'error', text: 'tool registry is unavailable: the host composes no tools service' }
    }
    // The standing-mount key when the agent runs on a preset's composition;
    // the global view otherwise. The key's identity is what layers the view.
    let scope: object | undefined
    const roster = ctx.get('agentPresets') as AgentPresetsRoster | undefined
    const current = roster?.composedPreset(agent.ctx)
    if (roster !== undefined && current !== undefined) {
      try {
        scope = await roster.standingKeyFor(current)
      } catch (error) {
        return { kind: 'error', text: `could not resolve the preset composition: ${describe(error)}` }
      }
      if (unloaded) return { kind: 'success' }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'tools panel is unavailable: the Blue screen is not mounted' }
    }
    const restore = mountEditorReplacement(new InfoPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'tools',
      sections: buildToolsSections(tools.schemas(scope as never)),
      onClose: () => {
        restore()
      },
    }))
    return { kind: 'success' }
  }

  const tools = ctx.commands.register({
    name: 'tools',
    description: 'List the tools visible to the current session',
    handler: () => showTools(),
  })
  return () => {
    tools()
  }
}
