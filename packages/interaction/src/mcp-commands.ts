/**
 * The `/mcp` command (S34): the read-only MCP server browser over the
 * collector in `mcp-servers.ts`. Three levels walk the same snapshot taken
 * when the command opens (the panels are construction-frozen, so live
 * refresh means reopening — D40's noted boundary): the server picker, the
 * per-server panel whose rows are the server's config and its
 * session-visible tools, and the detail panels for each — the config view
 * (status with its honest caveats, the redacted connection facts, the
 * resolved policy) and the tool schema view `/tools` already renders.
 *
 * Servers are declared in the user's profile patch, not here: the empty
 * state points at the website's MCP guide instead of offering an add form
 * (D36/D40 — one configuration source, auditable, HMR-hot).
 *
 * @module @dsh-blue/blue-interaction/mcp-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { BlueSessionToolSchema } from '@dsh-blue/blue-app'
// Empty type imports carry the `commands` Context merge the registration
// uses and the app-owned session action merge the collector resolves.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { InfoPanel, type InfoSection, type InfoSegment, type InfoStyle } from './info-panel.ts'
import type { McpCatalog, McpServerView, McpStatus } from './mcp-servers.ts'
import { MCP_PREFIX, collectMcpServers } from './mcp-servers.ts'
import { CanonicalSelectController, type SelectRow } from './select-list.ts'
import { buildToolDetailSections, firstSentence } from './tools-commands.ts'

/** The website page the empty state and config hint point at. */
const MCP_GUIDE_URL = 'https://dsh-blue.dev/en/dsh/mcp'

/** The config pseudo-row's value inside the per-server panel. */
const CONFIG_ROW_VALUE = '__server_config__'

/** Display labels for the derived statuses. */
const STATUS_LABEL: Readonly<Record<McpStatus, string>> = {
  synced: 'synced',
  restricted: 'restricted',
  'no-tools': 'no tools',
  starting: 'starting',
  failed: 'failed',
  reloading: 'reloading',
  disabled: 'disabled',
}

/** Row-style for the status label in the detail panel. */
const STATUS_STYLE: Readonly<Record<McpStatus, InfoStyle>> = {
  synced: 'success',
  restricted: 'warning',
  'no-tools': 'warning',
  starting: 'textMuted',
  failed: 'error',
  reloading: 'muted',
  disabled: 'muted',
}

/** Attention-first pick order for the server list (kimi sorts failed first). */
const STATUS_ORDER: readonly McpStatus[] = [
  'failed',
  'no-tools',
  'restricted',
  'starting',
  'reloading',
  'synced',
  'disabled',
]

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The one-line count a server row carries: the session-visible count with
 * the registered total beside it when the two views diverge.
 */
function countBrief(server: McpServerView): string {
  if (server.registeredCount === 0) return 'no tools registered'
  const visible = server.toolsVisible.length
  return visible === server.registeredCount
    ? `${visible} ${visible === 1 ? 'tool' : 'tools'}`
    : `${visible} of ${server.registeredCount} tools visible`
}

/**
 * Build the server picker rows: attention-first by status, then by name.
 * @param catalog - the collected snapshot.
 * @returns the panel rows, display order.
 */
export function buildServerPickerRows(catalog: McpCatalog): SelectRow[] {
  const rows: SelectRow[] = [...catalog.servers]
    .sort((a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || a.serverName.localeCompare(b.serverName))
    .map(server => ({
      value: server.entryId,
      label: server.serverName,
      description: `${server.transport} · ${STATUS_LABEL[server.status]} · ${countBrief(server)}`,
    }))
  if (!catalog.sessionLive) {
    rows.push({
      value: '__no_session__',
      label: '(no live session)',
      description: 'counts read the registered registry view',
      disabled: true,
    })
  }
  if (catalog.orphanCount > 0) {
    rows.push({
      value: '__orphans__',
      label: `(${catalog.orphanCount} mcp__ tool${catalog.orphanCount === 1 ? '' : 's'})`,
      description: 'visible but no mcp-client entry declares them',
      disabled: true,
    })
  }
  return rows
}

/**
 * The raw tool name under its server's namespace (display form).
 * @param server - the owning server view.
 * @param schema - the tool's schema.
 * @returns the name with the `mcp__<server>__` prefix stripped.
 */
export function rawToolName(server: McpServerView, schema: BlueSessionToolSchema): string {
  return schema.name.slice(`${MCP_PREFIX}${server.serverName}__`.length)
}

/**
 * Build the per-server panel rows: the config pseudo-row, then the
 * session-visible tools, then the honest leftovers as blocked rows.
 * @param server - the server view.
 * @returns the panel rows, display order.
 */
export function buildServerPanelRows(server: McpServerView): SelectRow[] {
  const rows: SelectRow[] = [{
    value: CONFIG_ROW_VALUE,
    label: 'server config',
    description: 'transport · endpoint · policy',
  }]
  for (const schema of server.toolsVisible) {
    const brief = firstSentence(schema.description)
    rows.push({
      value: schema.name,
      label: rawToolName(server, schema),
      ...(brief === '' ? {} : { description: brief }),
    })
  }
  const hidden = server.registeredCount - server.toolsVisible.length
  if (server.toolsVisible.length === 0 && server.registeredCount === 0) {
    rows.push({
      value: '__no_tools__',
      label: '(no tools registered)',
      description: 'connecting, contained startup failure, or reconnects exhausted',
      disabled: true,
    })
  } else if (hidden > 0) {
    rows.push({
      value: '__restricted__',
      label: `(${hidden} more registered)`,
      description: 'not visible to this session — preset restriction',
      disabled: true,
    })
  }
  return rows
}

/** One styled-segments row of the detail panels. */
function row(label: string, segments: readonly InfoSegment[]): { label: string, segments: readonly InfoSegment[] } {
  return { label, segments }
}

/** One plain-text row of the detail panels. */
function textRow(label: string, text: string, style: InfoStyle = 'text'): { label: string, segments: readonly InfoSegment[] } {
  return { label, segments: [{ text, style }] }
}

/**
 * Build the config detail sections: the status with its caveat rows, the
 * redacted connection facts, and the resolved reconnect policy.
 * @param server - the server view.
 * @param catalog - the collected snapshot (for the session note).
 * @returns the panel sections, display order.
 */
export function buildConfigSections(server: McpServerView, catalog: McpCatalog): InfoSection[] {
  const statusRows = [
    textRow('status', STATUS_LABEL[server.status], STATUS_STYLE[server.status]),
    textRow('registered', String(server.registeredCount)),
    catalog.sessionLive
      ? textRow('visible', String(server.toolsVisible.length))
      : textRow('visible', '— (no live session)', 'muted'),
  ]
  const caveat = configCaveat(server)
  if (caveat !== undefined) statusRows.push(textRow('note', caveat, 'muted'))
  const sections: InfoSection[] = [{ heading: 'Status', rows: statusRows }]

  const connectionRows = [
    textRow('transport', server.transport),
    textRow(server.transport === 'streamable-http' ? 'url' : 'command', server.endpoint),
  ]
  if (server.cwd !== undefined) connectionRows.push(textRow('cwd', server.cwd))
  connectionRows.push(
    textRow('env keys', server.envKeys.length === 0 ? '(none)' : server.envKeys.join(', '), server.envKeys.length === 0 ? 'muted' : 'text'),
    textRow('header keys', server.headerKeys.length === 0 ? '(none)' : server.headerKeys.join(', '), server.headerKeys.length === 0 ? 'muted' : 'text'),
  )
  sections.push({ heading: 'Connection', rows: connectionRows })

  const policyRows = []
  if (server.toolCallTimeoutMs !== undefined) {
    policyRows.push(textRow('tool timeout', `${server.toolCallTimeoutMs} ms`))
  }
  if (server.failOnStartupError !== undefined) {
    policyRows.push(textRow('fail on startup error', server.failOnStartupError ? 'true' : 'false'))
  }
  policyRows.push(server.reconnect === undefined
    ? textRow('reconnect', '(not resolved)', 'muted')
    : row('reconnect', [
      { text: server.reconnect.enabled ? 'enabled' : 'disabled', style: server.reconnect.enabled ? 'text' : 'muted' },
      { text: ` · ${server.reconnect.initialDelayMs} ms → ${server.reconnect.maxDelayMs} ms backoff`, style: 'muted' },
      { text: ` · max ${server.reconnect.maxAttempts} attempts` },
    ]))
  sections.push({ heading: 'Policy', rows: policyRows })
  sections.push({
    heading: '',
    rows: [textRow('', `servers are declared in the profile patch — ${MCP_GUIDE_URL}`, 'muted')],
  })
  return sections
}

/**
 * The status caveat line, when the honest read needs one.
 * @param server - the server view.
 * @returns the caveat, or `undefined` when the status says it all.
 */
function configCaveat(server: McpServerView): string | undefined {
  switch (server.status) {
    case 'no-tools':
      return 'no tools registered — connecting, contained startup failure, or reconnects exhausted; reload the plugin or restart the host'
    case 'restricted':
      return 'tools registered but not visible to this session — a preset restriction, not a dead server'
    case 'failed':
      return 'the entry failed to start — see the host logs'
    case 'reloading':
      return 'the entry is being swapped (HMR) — reopen the panel'
    case 'disabled':
      return 'the entry is disabled in the composition'
    default:
      return undefined
  }
}

/** The empty-catalog panel sections: guidance plus the honest leftovers. */
export function emptyMcpSections(catalog: McpCatalog): InfoSection[] {
  const rows = [{
    label: 'none',
    segments: [{ text: 'no MCP servers are declared', style: 'muted' as const }],
  }, {
    label: '',
    segments: [{ text: `declare servers in the profile patch — ${MCP_GUIDE_URL}`, style: 'muted' as const }],
  }]
  if (catalog.orphanCount > 0) {
    rows.push({
      label: '',
      segments: [{
        text: `(${catalog.orphanCount} mcp__ tool${catalog.orphanCount === 1 ? '' : 's'} visible but undeclared)`,
        style: 'muted' as const,
      }],
    })
  }
  return [{ heading: 'mcp', rows }]
}

/**
 * Register the `/mcp` command: mount the server browser.
 * @param ctx - plugin context (`commands` via the calling plugin).
 * @returns the disposer removing the registration.
 */
export function registerMcpCommands(ctx: Context): () => void {
  /**
   * The `/mcp` handler: guards, collect once, mount the picker.
   * @returns the command outcome.
   */
  async function showMcp(): Promise<CommandResult> {
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'mcp panel is unavailable: the Blue screen is not mounted' }
    }
    let catalog: McpCatalog
    try {
      catalog = await collectMcpServers(ctx)
    } catch (error) {
      return { kind: 'error', text: `could not read the MCP catalog: ${describe(error)}` }
    }
    if (catalog.servers.length === 0) {
      const restoreEmpty = mountEditorReplacement(ctx, new InfoPanel({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        title: 'mcp',
        sections: emptyMcpSections(catalog),
        onClose: () => {
          restoreEmpty()
        },
      }))
      return { kind: 'success' }
    }
    const byEntryId = new Map(catalog.servers.map(server => [server.entryId, server]))
    const openTool = (schema: BlueSessionToolSchema): void => {
      const restoreTool = mountEditorReplacement(ctx, new InfoPanel({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        title: schema.name,
        sections: buildToolDetailSections(schema),
        onClose: () => {
          restoreTool()
        },
      }))
    }
    const openServer = (server: McpServerView): void => {
      const byName = new Map(server.toolsVisible.map(schema => [schema.name, schema]))
      const restoreServer = mountEditorReplacement(ctx, new CanonicalSelectController({
        keymap: display.keymap,
        theme: display.theme,
        components: display.components,
        rows: buildServerPanelRows(server),
        title: server.serverName,
        footer: STATUS_LABEL[server.status],
        onSelect: selected => {
          if (selected.value === CONFIG_ROW_VALUE) {
            const restoreConfig = mountEditorReplacement(ctx, new InfoPanel({
              keymap: display.keymap,
              theme: display.theme,
              components: display.components,
              title: server.serverName,
              sections: buildConfigSections(server, catalog),
              onClose: () => {
                restoreConfig()
              },
            }))
            return
          }
          openTool(byName.get(selected.value)!)
        },
        onCancel: () => {
          restoreServer()
        },
      }))
    }
    const restorePicker = mountEditorReplacement(ctx, new CanonicalSelectController({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows: buildServerPickerRows(catalog),
      title: 'MCP servers',
      onSelect: selected => {
        openServer(byEntryId.get(selected.value)!)
      },
      onCancel: () => {
        restorePicker()
      },
    }))
    return { kind: 'success' }
  }

  const mcp = ctx.commands.register({
    name: 'mcp',
    description: 'List the MCP servers the host connects to',
    handler: () => showMcp(),
  })
  return () => {
    mcp()
  }
}
