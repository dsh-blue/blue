/**
 * The session-info command family (S25): `/status` — the framed two-column
 * panel over the session header (id, cwd, created, turn/step counts, agent
 * state), the live model selection, and the context occupancy; `/context` —
 * the provider token buckets, the context bar, and (projection-only) the
 * CC-style heuristic composition section, read through the
 * session-projection seam (`dsh-token-meter`/`dsh-session-stats` in the
 * base composition) with the local `usage.ts` fold as the degraded host's
 * fallback; and `/version` — the banner constant and the live model as a
 * notice (the kimi shape). The panels are read-only `InfoPanel`s mounted
 * through the D30 editor-slot swap; this module injects nothing and
 * resolves every service through `ctx.get` (the `/theme` fiber-dispose
 * trap).
 *
 * @module @dsh-blue/blue-interaction/session-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { BLUE_VERSION } from '@dsh-blue/blue-transcript/banner-content'
// Empty type imports carry the `commands` merge the registration uses and
// the app-owned `blueSession` merge every handler reads.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import type { InfoRow, InfoSection, InfoSegment } from './info-panel.ts'
import { InfoPanel } from './info-panel.ts'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import {
  formatTokens,
  ratioSeverity,
  readCompositionFacts,
  readTurnCounts,
  readUsageFacts,
  renderBar,
  usagePercent,
  usageRatio,
  type CompositionFacts,
  type ContextFacts,
} from './usage.ts'

/**
 * The harness release line Blue builds against — independent of Blue's own
 * release version: the dsh-* dev pins stay on their own prerelease line
 * while {@link BLUE_VERSION} is Blue's first-release number. Guarded by
 * the global version spec against the dsh pins.
 */
const HARNESS_LINE = '0.1.1-rc.1'

/** The model facts the `/status` panel lists. */
export interface StatusModelFacts {
  readonly provider: string
  readonly model: string
  readonly effort?: string
}

/**
 * Format a session's creation time as a fixed UTC stamp (locale-free, so
 * specs and terminals agree): `YYYY-MM-DD HH:MM UTC`.
 * @param createdAt - Unix epoch milliseconds.
 * @returns the formatted stamp.
 */
export function formatCreated(createdAt: number): string {
  const date = new Date(createdAt)
  return `${Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') : 'unknown'} UTC`
}

/**
 * Build the `/version` panel's sections (pure, for the spec): the Blue
 * release line and the harness line it builds against. The Blue number
 * is the first release the website advertises; the harness line is the
 * independent dsh pin line (the version spec keeps both in check).
 * @returns the sections in display order.
 */
export function buildVersionSections(): InfoSection[] {
  return [
    {
      heading: 'Version',
      rows: [
        { label: 'blue', segments: [{ text: `v${BLUE_VERSION}` }] },
        { label: 'harness', segments: [{ text: HARNESS_LINE }] },
      ],
    },
  ]
}

/** Map a usage severity onto the segment styling the panel paints. */
function severityStyle(severity: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' {
  return severity === 'danger' ? 'error' : severity === 'warn' ? 'warning' : 'success'
}

/**
 * The shared context-window section: the severity-colored occupancy bar
 * with its percent and counts when both figures are known, a waiting note
 * when the window is advertised but no request has reported usage yet, and
 * a not-admitted row otherwise (the kimi `No context window data` shape).
 * @param context - the occupancy pair.
 * @returns the section.
 */
export function buildContextSection(context: ContextFacts): InfoSection {
  const { used, window } = context
  if (used !== undefined && window !== undefined) {
    const ratio = usageRatio(used, window)
    return {
      heading: 'Context window',
      rows: [{
        label: 'context',
        segments: [
          { text: renderBar(ratio), style: severityStyle(ratioSeverity(ratio)) },
          { text: `  ${String(usagePercent(used, window))}%` },
          { text: `  ${formatTokens(used)} / ${formatTokens(window)}`, style: 'muted' },
        ],
      }],
    }
  }
  if (window !== undefined) {
    return {
      heading: 'Context window',
      rows: [{ label: 'context', segments: [{ text: 'no request has reported usage yet', style: 'muted' }] }],
    }
  }
  return {
    heading: 'Context window',
    rows: [{ label: 'context', segments: [{ text: 'not advertised for the current model', style: 'muted' }] }],
  }
}

/** The composition grid's column count (the CC value). */
const GRID_COLUMNS = 20

/** One composition category: grid glyph + paint, legend label, tokens. */
interface CompositionPart {
  readonly glyph: string
  readonly style: 'muted' | 'primary' | 'accent' | 'textMuted'
  readonly label: string
  readonly tokens: number
}

/** Construction input for {@link buildCompositionSection}. */
export interface CompositionInput {
  /** The heuristic composition, when the projection answers. */
  readonly breakdown?: CompositionFacts
  /** The advertised context window, when known. */
  readonly window?: number
  /** The model annotation beside the grid (`model (provider)`). */
  readonly model: string
  /** Provider-anchored occupancy for the headline totals. */
  readonly occupancy: ContextFacts
}

/**
 * Build the CC-style composition section (the `/context` panel's visual):
 * a glyph grid over the advertised window — `█` system prompt, `▓` tool
 * schemas, `▒` conversation surface, `░` the free remainder, one cell per
 * share with every non-zero category guaranteed at least one cell — with
 * the annotations riding its right edge: the model line, the anchored
 * `used/window tokens (N%)` headline, the category legend (glyph + label +
 * one-decimal shares, so a 0.1% system prompt reads `0.1%`, not `0%`), and
 * the free-space row. The figures are the meter's heuristic composition
 * (the upstream unit prices at a fixed density and underprices CJK/JSON),
 * so the heading carries the caveat; without a breakdown (no projection
 * seam) the section is omitted entirely and the panel falls back to the
 * occupancy bar; without a window the grid and shares disappear and the
 * legend keeps its bare counts.
 * @param input - composition, window, model line, and occupancy.
 * @returns the section, or `undefined` to omit it.
 */
export function buildCompositionSection(input: CompositionInput): InfoSection | undefined {
  const { breakdown, window, model, occupancy } = input
  if (breakdown === undefined) return undefined
  const parts: ReadonlyArray<CompositionPart> = [
    { glyph: '█', style: 'muted', label: 'System prompt', tokens: breakdown.system },
    { glyph: '▓', style: 'primary', label: 'Tools', tokens: breakdown.tools },
    { glyph: '▒', style: 'accent', label: 'Messages', tokens: breakdown.messages },
  ]
  const total = parts.reduce((sum, part) => sum + part.tokens, 0)
  // One-decimal shares (the CC legend): a 0.1% system prompt stays 0.1%.
  const share = (tokens: number): string | undefined =>
    window === undefined
      ? undefined
      : ` (${Math.max(0, Math.min(100, (tokens / window) * 100)).toFixed(1)}%)`
  const count = (tokens: number): string =>
    window === undefined ? formatTokens(tokens) : `${formatTokens(tokens)} tokens`
  const legendSegments = (part: CompositionPart): readonly InfoSegment[] => [
    { text: `${part.glyph} `, style: part.style },
    { text: `${part.label}: ` },
    { text: count(part.tokens) + (share(part.tokens) ?? ''), style: 'muted' },
  ]
  const freeTokens = window === undefined ? 0 : Math.max(0, window - total)
  // Computed unconditionally so both window states exercise the branch
  // (the free row itself only mounts with a window).
  const freeShare = window === undefined ? '' : ` (${Math.max(0, Math.min(100, (freeTokens / window) * 100)).toFixed(1)}%)`
  const annotations: ReadonlyArray<readonly InfoSegment[]> = [
    [{ text: model }],
    occupancy.used !== undefined && window !== undefined
      ? [
          { text: `${formatTokens(occupancy.used)}/${formatTokens(window)}` },
          { text: ` tokens (${String(Math.min(100, Math.max(0, Math.round((occupancy.used / window) * 100))))}%)`, style: 'muted' as const },
        ]
      : [{ text: 'no context window advertised', style: 'muted' as const }],
    [],
    [{ text: 'Estimated usage by category', style: 'textMuted' as const }],
    ...parts.map(part => legendSegments(part)),
    ...(window === undefined ? [] : [[
      { text: '░ ', style: 'textMuted' as const },
      { text: 'Free space: ' },
      { text: `${formatTokens(freeTokens)}${freeShare}`, style: 'muted' as const },
    ]] satisfies ReadonlyArray<readonly InfoSegment[]>),
  ]
  // Cell allocation over the grid: one cell per non-zero category (the CC
  // guarantee — a 74-token component keeps a visible cell), the rest split
  // by share, and whatever remains is free space. Without a window there
  // is no grid at all — the legend carries the section alone.
  let rows: InfoRow[] = annotations.map(() => ({ label: '', segments: [] as InfoSegment[] }))
  if (window !== undefined) {
    const cells = annotations.length * GRID_COLUMNS
    const allocated = parts.map(part => part.tokens > 0
      ? Math.max(1, Math.round((part.tokens / window) * cells))
      : 0)
    const free = Math.max(0, cells - allocated.reduce((sum, value) => sum + value, 0))
    const styles: ReadonlyArray<CompositionPart['style'] | 'textMuted'> = [
      ...allocated.flatMap((length, index) =>
        // allocated is parts.map's array — same length, so the lookup
        // always lands (the assertion documents the map invariant).
        Array.from({ length }, () => parts[index]!.style)),
      ...Array.from({ length: free }, () => 'textMuted' as const),
    ]
    rows = annotations.map((_, row) => {
      const slice = styles.slice(row * GRID_COLUMNS, (row + 1) * GRID_COLUMNS)
      const grid: InfoSegment[] = []
      for (let column = 0; column < slice.length; column++) {
        const style = slice[column]!
        const glyph = style === 'textMuted' ? '░' : parts.find(part => part.style === style)!.glyph
        const last = grid.at(-1)
        if (last !== undefined && last.style === style) {
          grid[grid.length - 1] = { text: last.text + glyph, style }
        } else {
          grid.push({ text: glyph, style })
        }
      }
      return { label: '', segments: [...grid, { text: '  ' }] }
    })
  }
  return {
    heading: 'Context usage (heuristic)',
    rows: rows.map((row, index) => ({ label: '', segments: [...row.segments, ...annotations[index]!] })),
  }
}

/** The header facts the `/status` panel reads. */
export interface StatusInput {
  /** The session's durable header facts. */
  readonly header: { readonly id: string, readonly cwd?: string, readonly createdAt: number }
  /** Whole-log turn and step counts. */
  readonly turns: number
  readonly steps: number
  /** The agent's lifecycle state. */
  readonly agentStatus: string
  /** The live model selection. */
  readonly model: StatusModelFacts
  /** Context occupancy; fields absent until known. */
  readonly context: ContextFacts
}

/**
 * Build the `/status` panel's sections (pure, for the spec).
 * @param input - the session facts to list.
 * @returns the sections in display order.
 */
export function buildStatusSections(input: StatusInput): InfoSection[] {
  return [
    {
      heading: 'Session',
      rows: [
        { label: 'id', segments: [{ text: input.header.id }] },
        { label: 'cwd', segments: [{ text: input.header.cwd ?? '(unknown)' }] },
        { label: 'created', segments: [{ text: formatCreated(input.header.createdAt) }] },
        { label: 'turns', segments: [
          { text: String(input.turns) },
          { text: ` · ${String(input.steps)} steps`, style: 'muted' },
        ] },
        { label: 'agent', segments: [{ text: input.agentStatus }] },
      ],
    },
    {
      heading: 'Model',
      rows: [
        { label: 'model', segments: [
          { text: `${input.model.model} (${input.model.provider})` },
          ...(input.model.effort !== undefined
            ? [{ text: ` · thinking ${input.model.effort}`, style: 'muted' as const }]
            : []),
        ] },
        { label: 'version', segments: [
          { text: `Blue v${BLUE_VERSION}` },
          { text: ` · dsh ${HARNESS_LINE}`, style: 'muted' },
        ] },
      ],
    },
    buildContextSection(input.context),
  ]
}

/**
 * Build the `/context` panel's sections (pure, for the spec): the four
 * disjoint provider buckets plus their total, then the CC-style
 * composition grid when the breakdown projection answers — otherwise the
 * occupancy bar section carries the window alone.
 * @param facts - the usage facts to list.
 * @param model - the model annotation line (`model (provider)`).
 * @param composition - the heuristic composition, when the projection answers.
 * @returns the sections in display order.
 */
export function buildUsageSections(
  facts: ReturnType<typeof readUsageFacts>,
  model: string,
  composition?: CompositionFacts,
): InfoSection[] {
  const { buckets } = facts
  const total = buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output
  const usage: InfoSection = total === 0
    ? {
        heading: 'Session usage',
        rows: [{ label: 'tokens', segments: [{ text: 'no provider usage recorded yet', style: 'muted' }] }],
      }
    : {
        heading: 'Session usage',
        rows: [
          { label: 'input', segments: [{ text: formatTokens(buckets.input) }] },
          { label: 'cache read', segments: [{ text: formatTokens(buckets.cacheRead) }] },
          { label: 'cache write', segments: [{ text: formatTokens(buckets.cacheWrite) }] },
          { label: 'output', segments: [{ text: formatTokens(buckets.output) }] },
          { label: 'total', segments: [{ text: formatTokens(total) }] },
        ],
      }
  const compositionSection = composition === undefined
    ? undefined
    : buildCompositionSection({
      breakdown: composition,
      ...(facts.context.window !== undefined ? { window: facts.context.window } : {}),
      model,
      occupancy: facts.context,
    })
  return [
    usage,
    compositionSection ?? buildContextSection(facts.context),
  ]
}

/**
 * Read the live session's model facts: the S23 `modelRef` selection (what
 * the next request uses), falling back to the last logged request header.
 * @param ctx - plugin context (`blueSession` resolved lazily).
 * @param agent - the live agent.
 * @returns the model facts, when either source answers.
 */
function readModelFacts(ctx: Context, agent: { session: { requestHeader(): { config: { provider: string, model: string, reasoningEffort?: string } } | undefined } }): StatusModelFacts | undefined {
  const ref = ctx.get('blueSession')?.modelRef
  if (ref !== undefined) {
    const selection = ref.current
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined ? { effort: String(selection.reasoningEffort) } : {}),
    }
  }
  const config = agent.session.requestHeader()?.config
  if (config === undefined) return undefined
  return {
    provider: config.provider,
    model: config.model,
    ...(config.reasoningEffort !== undefined ? { effort: String(config.reasoningEffort) } : {}),
  }
}

/**
 * Register the session-info commands (`/status`, `/context`, `/version`) on
 * `ctx.commands`.
 * @param ctx - plugin context.
 * @returns the disposer removing all three registrations.
 */
export function registerSessionCommands(ctx: Context): () => void {
  /**
   * The `/status` handler: mount the read-only panel over the session
   * header, counts, model, and context occupancy.
   * @returns the command outcome.
   */
  function showStatus(): CommandResult {
    const session = ctx.get('blueSession')
    const agent = session?.current
    if (session === undefined || agent === undefined || agent === null) {
      return { kind: 'error', text: 'no session is live yet' }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'status panel is unavailable: the Blue screen is not mounted' }
    }
    const counts = readTurnCounts(ctx, agent)
    const model = readModelFacts(ctx, agent) ?? { provider: 'unknown', model: 'not set' }
    const restore = mountEditorReplacement(new InfoPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'status',
      sections: buildStatusSections({
        header: agent.session.header,
        turns: counts.turns,
        steps: counts.steps,
        agentStatus: agent.status,
        model,
        context: readUsageFacts(ctx, agent).context,
      }),
      onClose: () => {
        restore()
      },
    }))
    return { kind: 'success' }
  }

  /**
   * The `/context` handler: mount the read-only panel over the provider
   * token buckets and the context occupancy.
   * @returns the command outcome.
   */
  function showContext(): CommandResult {
    const session = ctx.get('blueSession')
    const agent = session?.current
    if (session === undefined || agent === undefined || agent === null) {
      return { kind: 'error', text: 'no session is live yet' }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'context panel is unavailable: the Blue screen is not mounted' }
    }
    const facts = readUsageFacts(ctx, agent)
    const model = readModelFacts(ctx, agent) ?? { provider: 'unknown', model: 'not set' }
    const restore = mountEditorReplacement(new InfoPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'context',
      sections: buildUsageSections(facts, `${model.model} (${model.provider})`, readCompositionFacts(ctx, agent)),
      onClose: () => {
        restore()
      },
    }))
    return { kind: 'success' }
  }

  /**
   * The `/version` handler: mount the read-only panel over the Blue and
   * harness release lines. It needs no live session — the version answers
   * before one exists — so the panel opens on an empty slot too.
   * @returns the command outcome.
   */
  function showVersion(): CommandResult {
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'version panel is unavailable: the Blue screen is not mounted' }
    }
    const restore = mountEditorReplacement(new InfoPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'version',
      sections: buildVersionSections(),
      onClose: () => {
        restore()
      },
    }))
    return { kind: 'success' }
  }

  const status = ctx.commands.register({
    name: 'status',
    description: 'Show the session header, model, and context status',
    handler: () => showStatus(),
  })
  const context = ctx.commands.register({
    name: 'context',
    description: 'Show token usage and the context window',
    handler: () => showContext(),
  })
  const version = ctx.commands.register({
    name: 'version',
    description: 'Show the Blue and harness versions and the live model',
    handler: () => showVersion(),
  })
  return () => {
    status()
    context()
    version()
  }
}
