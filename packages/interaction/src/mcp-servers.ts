/**
 * The `/mcp` read layer (S34): collects the host's mcp-client plugin
 * instances from the loader entry tree and joins them with the tool
 * registry's server-qualified names, the honest read-only view D36 ruled on
 * — servers are declared in the user's profile patch, Blue never edits
 * them. One loader entry = one server (`dsh-mcp-client` semantics); its
 * normalized config lives on the fiber (Schemastery-validated, defaults
 * filled), so the read prefers `fiber.config` and falls back to the raw
 * `options.config` for entries that never got that far.
 *
 * Two counting views are read on purpose. The registered count (global
 * registry view) is the health signal: an mcp-client fiber stays ACTIVE with
 * `failOnStartupError: false` even when its connection failed or its
 * reconnect budget ran out — the one honest "is this server alive" fact is
 * whether its tools are registered. The visible list (the agent's preset
 * standing scope, the same resolution `/tools` uses) is what the session can
 * actually call — the two diverge under tool restrictions, and showing only
 * one would misread a restricted preset as a dead server or vice versa.
 *
 * Status stays approximate by upstream contract: the plugin emits no
 * connection events (state changes go to the logger only) and exposes no
 * restart API, so `no tools` covers the three indistinguishable causes
 * (connecting, contained startup failure, exhausted reconnects) and the
 * recovery hint names the only real remedies — reload the plugin (HMR) or
 * restart the host.
 *
 * @module @dsh-blue/blue-interaction/mcp-servers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type {} from '@dsh-blue/blue-app'

/** The loader module specifier an MCP server entry declares. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/**
 * Cordis `FiberState` numeric values. The declaration is a `const enum`, so
 * the compiled cordis package exports no runtime object — the values are
 * inlined here against the `fiber.d.ts` contract (a reorder upstream would
 * surface as an unknown state, never a crash).
 */
export const FIBER_PENDING = 0
export const FIBER_LOADING = 1
export const FIBER_ACTIVE = 2
export const FIBER_FAILED = 3
export const FIBER_DISPOSED = 4
export const FIBER_UNLOADING = 5

/** The public prefix of MCP-served tool names (`mcp__<server>__<raw>`). */
export const MCP_PREFIX = 'mcp__'

/** The derived display status of one MCP server row. */
export type McpStatus = 'synced' | 'restricted' | 'no-tools' | 'starting' | 'failed' | 'reloading' | 'disabled'

/** The resolved reconnect policy fields the panel shows. */
export interface McpReconnectView {
  readonly enabled: boolean
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
}

/** One MCP server's joined read: declared config, registry truth, status. */
export interface McpServerView {
  /** Loader entry id (stable inside the entry tree). */
  readonly entryId: string
  /** The declared namespace (`mcp__<serverName>__<raw>`); the entry id when the config never validated far enough to carry one. */
  readonly serverName: string
  /** `stdio` | `streamable-http`, or the raw value when unrecognized. */
  readonly transport: string
  /** Human endpoint: `command args…` joined, or the URL. */
  readonly endpoint: string
  /** Working directory (stdio only). */
  readonly cwd: string | undefined
  /** stdio env keys, sorted — the values may carry secrets and never leave the config. */
  readonly envKeys: readonly string[]
  /** HTTP header keys, sorted — same redaction rule as {@link envKeys}. */
  readonly headerKeys: readonly string[]
  readonly toolCallTimeoutMs: number | undefined
  readonly failOnStartupError: boolean | undefined
  readonly reconnect: McpReconnectView | undefined
  /** True when the entry or any owning parent entry is disabled. */
  readonly disabled: boolean
  /** Raw fiber state number, for the panel's status derivation. */
  readonly fiberState: number | undefined
  /** The derived status. */
  readonly status: McpStatus
  /** Tools registered under this server's namespace (global registry view). */
  readonly registeredCount: number
  /** The session-visible tools of this server (equals the global view when no session is live). */
  readonly toolsVisible: readonly ToolSchema[]
}

/** The whole `/mcp` read: servers plus the join's honest leftovers. */
export interface McpCatalog {
  readonly servers: readonly McpServerView[]
  /** `mcp__`-prefixed tools whose server matches no loader entry (a spec-side or foreign registration). */
  readonly orphanCount: number
  /** False when no agent session is live — counts then read the global registry view only. */
  readonly sessionLive: boolean
}

/** Read one config field as a string. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Read one config field as a finite number. */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read one config field as a boolean. */
function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Read a secret-bearing record as its sorted key list — the wire-facing
 * redaction kimi's config view applies too: env and header values may carry
 * tokens, and a read-only panel has no business echoing them.
 * @param value - the raw `env` / `headers` config value.
 * @returns the sorted keys, or an empty list for any non-record shape.
 */
export function readSecretKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value).sort()
}

/** Read the normalized reconnect policy. */
function readReconnect(value: unknown): McpReconnectView | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const enabled = readBoolean(record.enabled)
  const initialDelayMs = readNumber(record.initialDelayMs)
  const maxDelayMs = readNumber(record.maxDelayMs)
  const maxAttempts = readNumber(record.maxAttempts)
  // Post-normalization all four fields are present; a partial object means
  // the config never validated, and the panel omits the row rather than
  // showing a made-up policy.
  if (enabled === undefined || initialDelayMs === undefined || maxDelayMs === undefined || maxAttempts === undefined) {
    return undefined
  }
  return { enabled, initialDelayMs, maxDelayMs, maxAttempts }
}

/** Build the endpoint line: `command args…` for stdio, the URL for HTTP. */
function readEndpoint(config: Record<string, unknown>): string {
  const transport = readString(config.transport)
  if (transport === 'streamable-http') {
    return readString(config.url) ?? '(no url)'
  }
  const command = readString(config.command)
  if (command === undefined) return '(no command)'
  const args = Array.isArray(config.args)
    ? config.args.filter((arg): arg is string => typeof arg === 'string')
    : []
  return args.length === 0 ? command : `${command} ${args.join(' ')}`
}

/**
 * Derive one server's display status. Registered tools are the primary
 * signal and the fiber state the qualifier — an ACTIVE fiber with no
 * registered tools is one of three indistinguishable causes, and an ACTIVE
 * fiber with tools registered globally but none visible to the session is a
 * working server behind a restriction, not a dead one.
 * @param input - the joined facts of one row.
 * @returns the status.
 */
export function deriveMcpStatus(input: {
  readonly disabled: boolean
  readonly fiberState: number | undefined
  readonly registeredCount: number
  readonly visibleCount: number
}): McpStatus {
  if (input.disabled) return 'disabled'
  const state = input.fiberState
  if (state === FIBER_FAILED) return 'failed'
  if (state === FIBER_UNLOADING || state === FIBER_DISPOSED) return 'reloading'
  if (state === FIBER_ACTIVE) {
    if (input.registeredCount === 0) return 'no-tools'
    return input.visibleCount === 0 ? 'restricted' : 'synced'
  }
  // PENDING, LOADING, a missing fiber (the entry has not started yet), and
  // any state a newer cordis adds: the server is mid-transition.
  return 'starting'
}

/** The `mcp__<serverName>__` prefix one server's tools carry. */
function serverPrefix(serverName: string): string {
  return `${MCP_PREFIX}${serverName}__`
}

/**
 * Collect the MCP server catalog. Reads the loader entry tree once, the
 * global registry view once, and — when a session is live — the agent's
 * visible view once more.
 * @param ctx - plugin context carrying the loader and app-owned tool-catalog
 *   action boundary.
 * @returns the joined catalog.
 * @throws when the preset roster cannot resolve its standing mount (the
 *   caller owns the error surface).
 */
export async function collectMcpServers(ctx: Context): Promise<McpCatalog> {
  const loader = ctx.get('loader') as
    | { entries(): Generator<Entry, void, void> }
    | undefined
  if (loader === undefined) throw new Error('the host composes no loader service')
  const tools = ctx.get('tools')
  if (tools === undefined) throw new Error('the host composes no tools service')
  const agent = ctx.blueCurrentAgent.current()

  // The declared servers, in entry-tree order; the normalized fiber config
  // is preferred, the raw options config covers never-started entries.
  const configs: { readonly entry: Entry, readonly config: Record<string, unknown> }[] = []
  for (const entry of loader.entries()) {
    if (entry.options.name !== MCP_CLIENT_MODULE) continue
    const raw = entry.options.config
    const config = (entry.fiber?.config ?? raw) as unknown
    const record = config !== null && typeof config === 'object' && !Array.isArray(config)
      ? config as Record<string, unknown>
      : {}
    configs.push({ entry, config: record })
  }

  // The global registry view: the registered (health) counts, and the
  // orphans — mcp__-named tools no declared server owns.
  const globalSchemas = tools.schemas()
  const registered = new Map<string, number>()
  let orphanCount = 0
  const prefixes = configs
    .map(({ config }) => readString(config.serverName))
    .filter((name): name is string => name !== undefined)
    .map(serverPrefix)
  for (const schema of globalSchemas) {
    if (!schema.name.startsWith(MCP_PREFIX)) continue
    const owner = prefixes.find(prefix => schema.name.startsWith(prefix))
    if (owner === undefined) {
      orphanCount += 1
      continue
    }
    registered.set(owner, (registered.get(owner) ?? 0) + 1)
  }

  // The session-visible view: the agent's preset scope when a session is
  // live, the global view otherwise (the process-level truth /mcp degrades
  // to — the panel notes the missing session).
  const sessionLive = agent !== null
  const visibleSchemas = agent === null ? globalSchemas : tools.schemas(agent)
  const visible = new Map<string, ToolSchema[]>()
    for (const schema of visibleSchemas) {
      if (!schema.name.startsWith(MCP_PREFIX)) continue
      const owner = prefixes.find(prefix => schema.name.startsWith(prefix))
      if (owner === undefined) continue
      const list = visible.get(owner) ?? []
      list.push(schema)
      visible.set(owner, list)
    }

  const servers = configs.map(({ entry, config }) => {
      const serverName = readString(config.serverName) ?? entry.id
      const prefix = serverPrefix(serverName)
      const registeredCount = registered.get(prefix) ?? 0
      const toolsVisible = visible.get(prefix) ?? []
      const disabled = entry.disabled
      const fiberState = entry.fiber?.state
      return {
        entryId: entry.id,
        serverName,
        transport: readString(config.transport) ?? 'unknown',
        endpoint: readEndpoint(config),
        cwd: readString(config.cwd) === '' ? undefined : readString(config.cwd),
        envKeys: readSecretKeys(config.env),
        headerKeys: readSecretKeys(config.headers),
        toolCallTimeoutMs: readNumber(config.toolCallTimeoutMs),
        failOnStartupError: readBoolean(config.failOnStartupError),
        reconnect: readReconnect(config.reconnect),
        disabled,
        fiberState,
        status: deriveMcpStatus({
          disabled,
          fiberState,
          registeredCount,
          visibleCount: toolsVisible.length,
        }),
        registeredCount,
        toolsVisible,
      } satisfies McpServerView
  })
  return { servers, orphanCount, sessionLive }
}
