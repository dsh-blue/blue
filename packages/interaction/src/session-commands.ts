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
import type { InfoRow, InfoSection } from './info-panel.ts'
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
  renderStackedBar,
  usagePercent,
  usageRatio,
  type CompositionFacts,
  type ContextFacts,
} from './usage.ts'

/** The harness release line Blue is pinned to (the `rc.N` tail of {@link BLUE_VERSION}). */
const HARNESS_LINE = BLUE_VERSION.split('-').at(-1)!

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
 * The `/version` notice: the banner constant, the pinned harness line, and
 * — when a session is live — its current model.
 * @param model - the live model facts, when available.
 * @returns the single-line notice text.
 */
export function versionNotice(model?: StatusModelFacts): string {
  const base = `Blue v${BLUE_VERSION} · dsh ${HARNESS_LINE}`
  if (model === undefined) return base
  const effort = model.effort !== undefined ? ` · thinking ${model.effort}` : ''
  return `${base} · ${model.model} (${model.provider})${effort}`
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

/**
 * Build the CC-style composition section (the `/context` panel's third
 * act): a stacked `█▓▒░` bar over the advertised window plus one row per
 * component — system prompt, tool schemas, conversation surface — and the
 * free remainder, each with its 1024-base count and whole-percent share.
 * The figures are the meter's heuristic composition (the upstream unit
 * prices at a fixed density and underprices CJK/JSON), so the heading
 * carries the caveat and the anchored occupancy stays in
 * {@link buildContextSection}. Without a breakdown (no projection seam)
 * the section is omitted entirely; without a window the rows lose their
 * shares and the bar.
 * @param breakdown - the heuristic composition, when the projection answers.
 * @param window - the advertised context window, when known.
 * @returns the section, or `undefined` to omit it.
 */
export function buildCompositionSection(
  breakdown: CompositionFacts | undefined,
  window: number | undefined,
): InfoSection | undefined {
  if (breakdown === undefined) return undefined
  const components: ReadonlyArray<{ label: string, tokens: number }> = [
    { label: 'system', tokens: breakdown.system },
    { label: 'tools', tokens: breakdown.tools },
    { label: 'messages', tokens: breakdown.messages },
  ]
  const used = breakdown.system + breakdown.tools + breakdown.messages
  // Composition shares round to the nearest whole percent — unlike the
  // occupancy bar's floor-at-1 rule, a 0.3% system prompt reads `0%`, not
  // an inflated `1%` (the floor exists so partial occupancy never looks
  // empty; here the bar already shows the parts in proportion).
  const shareText = (tokens: number, window: number): string =>
    ` · ${String(Math.min(100, Math.max(0, Math.round((tokens / window) * 100))))}%`
  const rows: InfoRow[] = []
  if (window !== undefined) {
    rows.push({
      label: 'window',
      segments: [{ text: renderStackedBar([
        { ratio: breakdown.system / window, glyph: '█' },
        { ratio: breakdown.tools / window, glyph: '▓' },
        { ratio: breakdown.messages / window, glyph: '▒' },
        { ratio: Math.max(0, window - used) / window, glyph: '░' },
      ]) }],
    })
  }
  for (const component of components) {
    rows.push({
      label: component.label,
      segments: [
        { text: formatTokens(component.tokens) },
        ...(window === undefined
          ? []
          : [{ text: shareText(component.tokens, window), style: 'muted' as const }]),
      ],
    })
  }
  if (window !== undefined) {
    const free = Math.max(0, window - used)
    rows.push({
      label: 'free',
      segments: [
        { text: formatTokens(free) },
        { text: shareText(free, window), style: 'muted' as const },
      ],
    })
  }
  return { heading: 'Context composition (heuristic)', rows }
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
 * disjoint provider buckets plus their total, the context bar, and — when
 * the breakdown projection answers — the CC-style composition section.
 * @param facts - the usage facts to list.
 * @param composition - the heuristic composition, when the projection answers.
 * @returns the sections in display order.
 */
export function buildUsageSections(
  facts: ReturnType<typeof readUsageFacts>,
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
  const compositionSection = buildCompositionSection(composition, facts.context.window)
  return [
    usage,
    buildContextSection(facts.context),
    ...(compositionSection === undefined ? [] : [compositionSection]),
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
    const restore = mountEditorReplacement(new InfoPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'context',
      sections: buildUsageSections(facts, readCompositionFacts(ctx, agent)),
      onClose: () => {
        restore()
      },
    }))
    return { kind: 'success' }
  }

  /**
   * The `/version` handler: flash the banner constant and the live model.
   * @returns the command outcome.
   */
  function showVersion(): CommandResult {
    const agent = ctx.get('blueSession')?.current
    return { kind: 'success', text: versionNotice(agent !== undefined && agent !== null ? readModelFacts(ctx, agent) : undefined) }
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
