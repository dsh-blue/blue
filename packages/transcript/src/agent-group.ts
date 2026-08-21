/**
 * `AgentGroupComponent` — the S33 kimi `agent-group` port: two or more
 * spawn-class subagent calls (`subagent` / `subagent_fork`) in the same step
 * render as one group instead of individual cards. The mounter (`src/index.ts`)
 * forms the group exactly the ReadGroup way — a second consecutive same-step
 * call retires the lone card and mounts this component over the pair, later
 * calls attach — so the group's bookkeeping item is the first member and step
 * folding / window eviction retire it with its members.
 *
 * The fold baseline (A+) derives everything from the member items: the label
 * and description from `parsedArguments` (`description` is the harness
 * tool's required display field, the raw arguments ellipsize as the
 * fallback), the phase from the result's presence and `isError`, and
 * elapsed seconds from the envelope wall clocks the fold records. On the
 * live path an optional lookup (`agent-live.ts`, the S33 child-session
 * tracker) overlays kimi-level depth: the running/waiting split (which also
 * corrects the background ack's premature "finished"), per-child tool and
 * token counts, the model/effort line, and the running activity second
 * line. Replay never provides the lookup, so it degrades to A+
 * structurally (D37).
 *
 * Kimi's 200ms group throttle is not ported: it rate-limits a push model
 * (snapshot listeners rebuilding on every child event). This component pulls
 * at render with a cache key, and pi-tui's `requestRender` already
 * coalesces per tick — the ReadGroup proof. The only timer is the 1 Hz tick
 * that advances non-terminal members' elapsed seconds; it stands itself down
 * on the first tick that finds none left (the ThinkingTimers retire pattern
 * — a replay of settled steps starts zero timers). No `setExpanded`: the
 * group never expands, and the Ctrl-O toggle skips components without one.
 *
 * @module @dsh-blue/blue-transcript/agent-group
 */

import type { BlueComponent, BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import { ellipsize } from './present.ts'
import type { TranscriptToolItem } from './types.ts'

/** Bold SGR pair (the S18 local-constant precedent). */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** The pending-elapsed tick rate (kimi ticks its per-card timer at 1s). */
const AGENT_TICK_MS = 1000

/** Cap on the raw-arguments fallback description (the S20 key-arg bound). */
const DESCRIPTION_MAX_CHARS = 60

/**
 * The live overlay one member renders from — the child-session tracker's
 * snapshot (kimi-level fields the fold has no source for; D37).
 */
export interface AgentMemberLive {
  /** The refined phase; `running`/`waiting` override a premature ack. */
  readonly phase: 'running' | 'waiting' | 'completed' | 'failed'
  /** Wall clock of the epoch's close, while terminal. */
  readonly endedAt?: number
  /** Total tokens, once at least one usage record landed. */
  readonly tokens?: number
  /** Dispatched tool calls this epoch. */
  readonly toolCount: number
  /** The activity second line, non-terminal states only. */
  readonly activity?: string
  /** The child's latest `request/header` model. */
  readonly model?: string
  /** The child's latest `request/header` reasoning effort. */
  readonly effort?: string
}

/** Resolves a member's live overlay; absent on replay and unit tests. */
export type AgentLiveLookup = (member: TranscriptToolItem) => AgentMemberLive | undefined

/** The timer + clock primitives; replaceable in tests (ThinkingTimers precedent). */
export interface AgentGroupTimers {
  /** Start a repeating callback; mirrors the global `setInterval`. */
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  /** Stop a repeating callback; mirrors the global `clearInterval`. */
  clearInterval: (handle: ReturnType<typeof setInterval>) => void
  /** The wall clock elapsed seconds run against; mirrors `Date.now`. */
  now: () => number
}

/** The process timer primitives, referenced directly (no wrapper bodies). */
const defaultAgentGroupTimers: AgentGroupTimers = {
  setInterval,
  clearInterval,
  now: Date.now,
}

let agentGroupTimers: AgentGroupTimers = defaultAgentGroupTimers

/**
 * Replace the group timers (tests inject fakes here).
 * @param timers - the replacement, or `undefined` to restore the defaults.
 */
export function setAgentGroupTimers(timers: AgentGroupTimers | undefined): void {
  agentGroupTimers = timers ?? defaultAgentGroupTimers
}

/** One member's rendered snapshot — the fold baseline with the live overlay. */
interface AgentSnapshot {
  /** Display label: a parsed name-ish argument, else the tool name. */
  readonly label: string
  /** The call's display description (args `description`, else the raw
   * arguments ellipsized, else kimi's fallback). */
  readonly description: string
  /** The five-state phase: fold pending/done/failed refined by live. */
  readonly phase: 'pending' | 'running' | 'waiting' | 'done' | 'failed'
  /** Elapsed seconds; non-terminal members run against `now`. */
  readonly elapsedSeconds: number
  /** First non-empty line of the result text, for the failed error line. */
  readonly errorFirstLine: string | undefined
  /** The live overlay, when the tracker resolved this member. */
  readonly live: AgentMemberLive | undefined
}

/** Cache keyed on the inputs the rendered lines depend on. */
interface RenderCache {
  key: string
  lines: string[]
}

/** kimi `agent-group.ts` elapsed format: `45s`, or `2m 10s` past a minute. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes)}m ${String(remainder)}s`
}

/** Compact 1024-base token text (the usage.ts `formatTokens` twin). */
function formatTok(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '0'
  if (tokens >= 1024 * 1024) return `${trimDecimal(tokens / (1024 * 1024))}M`
  if (tokens >= 1024) {
    const k = tokens / 1024
    return `${k >= 100 ? String(Math.round(k)) : trimDecimal(k)}k`
  }
  return String(tokens)
}

/** One decimal place, trailing `.0` dropped. */
function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

/** The first non-empty line of a text, for kimi's single error line. */
function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return line.trim()
  }
  return undefined
}

/** Whether a phase is terminal (done/failed) for tick and header logic. */
function isTerminal(phase: AgentSnapshot['phase']): boolean {
  return phase === 'done' || phase === 'failed'
}

/** The header bucket a phase counts under: fold-only pending members count
 * as running — the baseline cannot split them (D37 divergence). */
function headerBucket(phase: AgentSnapshot['phase']): 'done' | 'failed' | 'running' | 'waiting' {
  if (phase === 'done') return 'done'
  if (phase === 'failed') return 'failed'
  if (phase === 'waiting') return 'waiting'
  return 'running'
}

/**
 * Renders one grouped run of same-step spawn-class subagent calls.
 */
export class AgentGroupComponent implements BlueComponent {
  /** The member tool items, in call order; the first one is the group's
   * bookkeeping item (turn/step identity for folding and eviction). */
  private readonly members: TranscriptToolItem[]
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private readonly requestRender: (() => void) | undefined
  private readonly live: AgentLiveLookup | undefined
  private cache: RenderCache | null = null
  private tickHandle: ReturnType<typeof setInterval> | null = null

  /**
   * @param member - the first member (the retired lone card's item).
   * @param colors - the semantic color table.
   * @param components - the component factory providing the width helpers.
   * @param requestRender - the mounter's redraw nudge (the live tick).
   * @param live - the child-session tracker lookup (live path only).
   */
  constructor(
    member: TranscriptToolItem,
    colors: BlueSemanticColors,
    components: BlueComponents,
    requestRender?: () => void,
    live?: AgentLiveLookup,
  ) {
    this.members = [member]
    this.colors = colors
    this.components = components
    this.requestRender = requestRender
    this.live = live
  }

  /** Drop the cached lines; the next render rebuilds from the members. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Join one more subagent call to the group (third and later mounts).
   * @param member - the tool item to attach.
   */
  attach(member: TranscriptToolItem): void {
    this.members.push(member)
    this.invalidate()
  }

  /** Stand the tick down; `retireEntry` calls this when the group folds. */
  dispose(): void {
    this.standDownTick()
  }

  /** One member's snapshot: the fold baseline with the live overlay merged
   * (a live running/waiting overrides the background ack's early finish). */
  private snapshot(member: TranscriptToolItem, now: number): AgentSnapshot {
    const parsed = member.parsedArguments
    let label = member.name
    let description: string | undefined
    if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
      const args = parsed as Record<string, unknown>
      for (const key of ['name', 'agent_name', 'agent', 'type', 'preset']) {
        const raw = args[key]
        if (typeof raw === 'string' && raw !== '') {
          label = raw
          break
        }
      }
      if (typeof args['description'] === 'string' && args['description'] !== '') {
        description = ellipsize(args['description'], DESCRIPTION_MAX_CHARS)
      }
    }
    if (description === undefined && member.arguments !== '') {
      description = ellipsize(member.arguments, DESCRIPTION_MAX_CHARS)
    }
    const text = description ?? '(no description)'
    const result = member.result
    const live = this.live?.(member)
    // Phase: the live overlay refines the fold states — running/waiting win
    // over an acked-but-still-running member; terminal live states decide
    // over an absent fold result too.
    let phase: AgentSnapshot['phase']
    if (live !== undefined && (live.phase === 'running' || live.phase === 'waiting')) {
      phase = live.phase
    } else if (live?.phase === 'completed') {
      phase = 'done'
    } else if (live?.phase === 'failed') {
      phase = 'failed'
    } else if (result === undefined) {
      phase = 'pending'
    } else if (result.isError) {
      phase = 'failed'
    } else {
      phase = 'done'
    }
    // Elapsed: the closing clock while terminal (live epoch end first, the
    // fold result envelope second), the running clock otherwise.
    const end = isTerminal(phase)
      ? live?.endedAt ?? result?.endedAt
      : undefined
    const elapsedSeconds = Math.max(0, Math.floor(((end ?? now) - member.startedAt) / 1000))
    return {
      label,
      description: text,
      phase,
      elapsedSeconds,
      errorFirstLine: result?.isError === true
        ? firstNonEmptyLine(result.fullText ?? result.text)
        : undefined,
      live,
    }
  }

  /** The kimi header line: phase counts while any member runs, the finish
   * line with the summed tail once every member is terminal. */
  private header(snapshots: readonly AgentSnapshot[], width: number): string {
    const { colors } = this
    const total = snapshots.length
    const counts = { done: 0, failed: 0, running: 0, waiting: 0 }
    let maxElapsed = 0
    let tools = 0
    let tokens = 0
    let anyLive = false
    for (const snap of snapshots) {
      counts[headerBucket(snap.phase)] += 1
      if (snap.elapsedSeconds > maxElapsed) maxElapsed = snap.elapsedSeconds
      if (snap.live !== undefined) {
        anyLive = true
        tools += snap.live.toolCount
        if (snap.live.tokens !== undefined) tokens += snap.live.tokens
      }
    }
    const { done, failed, running, waiting } = counts
    const label = (text: string): string => `${BOLD_OPEN}${colors.primary(text)}${BOLD_CLOSE}`
    if (done + failed < total) {
      // kimi's breakdown order (done, failed, running, waiting; nonzero only).
      const parts: string[] = []
      if (done > 0) parts.push(`${done} done`)
      if (failed > 0) parts.push(`${failed} failed`)
      if (running > 0) parts.push(`${running} running`)
      if (waiting > 0) parts.push(`${waiting} waiting`)
      const tail = colors.muted(` · ${formatElapsed(maxElapsed)}`)
      const runningLabel = `Running ${total} agents (${parts.join(', ')})`
      return this.components.truncateToWidth(`${colors.text('● ')}${label(runningLabel)}${tail}`, width)
    }
    // The settled tail sums the live stats (kimi counts tools and tokens
    // only at settle); without any live member it degrades to elapsed only.
    const tailParts: string[] = []
    if (anyLive && tools > 0) tailParts.push(`${tools} tool${tools === 1 ? '' : 's'}`)
    if (anyLive && tokens > 0) tailParts.push(`${formatTok(tokens)} tok`)
    tailParts.push(formatElapsed(maxElapsed))
    const tail = colors.muted(` · ${tailParts.join(' · ')}`)
    return this.components.truncateToWidth(`${colors.success('✓ ')}${label(`${total} agents finished`)}${tail}`, width)
  }

  /** One tree row: `  ├─/└─ label · description · stats · phase tail`. */
  private bodyRow(snapshot: AgentSnapshot, isLast: boolean, width: number): string {
    const { colors } = this
    const branch = isLast ? '└─' : '├─'
    const label = colors.primary(snapshot.label)
    // kimi's stat order (model, effort, tools, elapsed, tokens) over the
    // live fields; a fold-only member shows elapsed alone.
    const stats: string[] = []
    if (snapshot.live?.model !== undefined) stats.push(snapshot.live.model)
    if (snapshot.live?.effort !== undefined) stats.push(snapshot.live.effort)
    if (snapshot.live !== undefined) stats.push(`${snapshot.live.toolCount} tool${snapshot.live.toolCount === 1 ? '' : 's'}`)
    stats.push(formatElapsed(snapshot.elapsedSeconds))
    if (snapshot.live?.tokens !== undefined) stats.push(`${formatTok(snapshot.live.tokens)} tok`)
    const meta = colors.muted(` · ${snapshot.description} · ${stats.join(' · ')}`)
    let tail: string
    if (snapshot.phase === 'done') tail = colors.success(' · ✓ Completed')
    else if (snapshot.phase === 'failed') tail = colors.error(' · ✗ Failed')
    else if (snapshot.phase === 'waiting') tail = colors.primary(' · Waiting')
    else tail = colors.primary(' · Running')
    return this.components.truncateToWidth(`  ${branch} ${label}${meta}${tail}`, width)
  }

  /**
   * The kimi second line: failed members show one error line; live
   * running/waiting members show the activity line. Fold-only pending
   * members have no source and render nothing (D37 divergence).
   */
  private secondLine(snapshot: AgentSnapshot, isLast: boolean, width: number): string | undefined {
    const prefix = isLast ? '   ' : '│  '
    if (snapshot.phase === 'failed') {
      const errLine = snapshot.errorFirstLine ?? 'Failed'
      const err = this.colors.error(`Error: ${errLine}`)
      return this.components.truncateToWidth(`  ${prefix}    ${err}`, width)
    }
    if (snapshot.live?.activity !== undefined) {
      return this.components.truncateToWidth(`  ${prefix}    ${this.colors.muted(snapshot.live.activity)}`, width)
    }
    return undefined
  }

  /** Start the 1 Hz tick when a non-terminal member needs its clock advanced. */
  private ensureTick(anyNonTerminal: boolean): void {
    if (this.tickHandle !== null || !anyNonTerminal) return
    this.tickHandle = agentGroupTimers.setInterval(() => {
      const anyLeft = this.members.some(member => {
        const live = this.live?.(member)
        if (live !== undefined) return live.phase === 'running' || live.phase === 'waiting'
        return member.result === undefined
      })
      if (!anyLeft) {
        this.standDownTick()
        return
      }
      this.invalidate()
      this.requestRender?.()
    }, AGENT_TICK_MS)
  }

  /** Stop the tick; idempotent so the retire path and dispose share it. */
  private standDownTick(): void {
    if (this.tickHandle === null) return
    agentGroupTimers.clearInterval(this.tickHandle)
    this.tickHandle = null
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows: separator, header, and the tree.
   */
  render(width: number): string[] {
    const now = agentGroupTimers.now()
    // A non-terminal member's elapsed bucket and live signature are part of
    // the key, so each tick's clock advance or child-event overlay change
    // rebuilds while settled members contribute their stable signature.
    const key = `${width}|${this.members.map(member => {
      const live = this.live?.(member)
      if (live === undefined) {
        return member.result === undefined
          ? `${member.seq}:p${Math.floor((now - member.startedAt) / 1000)}`
          : `${member.seq}:${member.result.isError}:${member.result.endedAt}`
      }
      const terminal = live.phase === 'completed' || live.phase === 'failed'
      const bucket = terminal
        ? String(live.endedAt ?? '')
        : `n${Math.floor((now - member.startedAt) / 1000)}`
      return `${member.seq}:l${live.phase}:${live.toolCount}:${live.tokens ?? ''}:${live.activity ?? ''}:${bucket}`
    }).join('|')}`
    if (this.cache?.key === key) return this.cache.lines
    const snapshots = this.members.map(member => this.snapshot(member, now))
    const lines = ['', this.header(snapshots, width)]
    let anyNonTerminal = false
    snapshots.forEach((snapshot, index) => {
      const isLast = index === snapshots.length - 1
      if (!isTerminal(snapshot.phase)) anyNonTerminal = true
      lines.push(this.bodyRow(snapshot, isLast, width))
      const second = this.secondLine(snapshot, isLast, width)
      if (second !== undefined) lines.push(second)
    })
    this.cache = { key, lines }
    this.ensureTick(anyNonTerminal)
    return lines
  }
}
