/**
 * `AgentGroupComponent` — the S33 kimi `agent-group` port: two or more
 * spawn-class subagent calls (`subagent` / `subagent_fork`) in the same step
 * render as one group instead of individual cards. The mounter (`src/index.ts`)
 * forms the group exactly the ReadGroup way — a second consecutive same-step
 * call retires the lone card and mounts this component over the pair, later
 * calls attach — so the group's bookkeeping item is the first member and step
 * folding / window eviction retire it with its members.
 *
 * The baseline derives everything from the fold items (the A+ form every
 * replay renders): the label and description from `parsedArguments`
 * (`description` is the harness tool's required display field, the raw
 * arguments ellipsize as the fallback), the three-state phase from the
 * result's presence and `isError`, and elapsed seconds from the envelope
 * wall clocks the fold records (`startedAt`/`endedAt`; a pending member's
 * clock runs against `now`). The kimi fields with no fold source — tokens,
 * per-child tool counts, the live activity line, the running/waiting split —
 * are deliberate divergences here (D37); the S33 tracker overlays them on
 * the live path only.
 *
 * Kimi's 200ms group throttle is not ported: it rate-limits a push model
 * (snapshot listeners rebuilding on every child event). This component pulls
 * at render with a cache key, and pi-tui's `requestRender` already
 * coalesces per tick — the ReadGroup proof. The only timer is the 1 Hz tick
 * that advances pending members' elapsed seconds; it stands itself down on
 * the first tick that finds none left (the ThinkingTimers retire pattern —
 * a replay of settled steps starts zero timers). No `setExpanded`: the group
 * never expands, and the Ctrl-O toggle skips components without one.
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

/** One member's rendered snapshot — the fold-baseline (A+) form. */
interface AgentSnapshot {
  /** Display label: a parsed name-ish argument, else the tool name. */
  readonly label: string
  /** The call's display description (args `description`, else the raw
   * arguments ellipsized, else kimi's fallback). */
  readonly description: string
  /** pending until the result lands, failed on error, done otherwise. */
  readonly phase: 'pending' | 'done' | 'failed'
  /** Elapsed seconds; pending members run against `now`. */
  readonly elapsedSeconds: number
  /** First non-empty line of the result text, for the failed error line. */
  readonly errorFirstLine: string | undefined
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

/** The first non-empty line of a text, for kimi's single error line. */
function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return line.trim()
  }
  return undefined
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
  private cache: RenderCache | null = null
  private tickHandle: ReturnType<typeof setInterval> | null = null

  /**
   * @param member - the first member (the retired lone card's item).
   * @param colors - the semantic color table.
   * @param components - the component factory providing the width helpers.
   * @param requestRender - the mounter's redraw nudge (the live tick).
   */
  constructor(
    member: TranscriptToolItem,
    colors: BlueSemanticColors,
    components: BlueComponents,
    requestRender?: () => void,
  ) {
    this.members = [member]
    this.colors = colors
    this.components = components
    this.requestRender = requestRender
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

  /** One member's snapshot, from its live fold item. */
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
    const result = member.result
    if (result === undefined) {
      return {
        label,
        description: description ?? '(no description)',
        phase: 'pending',
        elapsedSeconds: Math.max(0, Math.floor((now - member.startedAt) / 1000)),
        errorFirstLine: undefined,
      }
    }
    const elapsedSeconds = Math.max(0, Math.floor((result.endedAt - member.startedAt) / 1000))
    if (result.isError) {
      return {
        label,
        description: description ?? '(no description)',
        phase: 'failed',
        elapsedSeconds,
        errorFirstLine: firstNonEmptyLine(result.fullText ?? result.text),
      }
    }
    return {
      label,
      description: description ?? '(no description)',
      phase: 'done',
      elapsedSeconds,
      errorFirstLine: undefined,
    }
  }

  /** The kimi header line: phase counts while running, the finish line once
   * every member is terminal — both with the max-elapsed tail (the fold has
   * no tool/token counts to sum; D37 divergence). */
  private header(snapshots: readonly AgentSnapshot[], width: number): string {
    const { colors } = this
    const total = snapshots.length
    let done = 0
    let failed = 0
    let maxElapsed = 0
    for (const snap of snapshots) {
      if (snap.phase === 'done') done += 1
      else if (snap.phase === 'failed') failed += 1
      if (snap.elapsedSeconds > maxElapsed) maxElapsed = snap.elapsedSeconds
    }
    const label = (text: string): string => `${BOLD_OPEN}${colors.primary(text)}${BOLD_CLOSE}`
    const tail = colors.muted(` · ${formatElapsed(maxElapsed)}`)
    if (done + failed < total) {
      // The fold cannot split pending into starting/queued/running (D37
      // divergence), so every unfinished member counts as running.
      const parts: string[] = []
      if (done > 0) parts.push(`${done} done`)
      if (failed > 0) parts.push(`${failed} failed`)
      parts.push(`${total - done - failed} running`)
      const running = `Running ${total} agents (${parts.join(', ')})`
      return this.components.truncateToWidth(`${colors.text('● ')}${label(running)}${tail}`, width)
    }
    return this.components.truncateToWidth(`${colors.success('✓ ')}${label(`${total} agents finished`)}${tail}`, width)
  }

  /** One tree row: `  ├─/└─ label · description · elapsed · phase tail`. */
  private bodyRow(snapshot: AgentSnapshot, isLast: boolean, width: number): string {
    const { colors } = this
    const branch = isLast ? '└─' : '├─'
    const label = colors.primary(snapshot.label)
    const meta = colors.muted(` · ${snapshot.description} · ${formatElapsed(snapshot.elapsedSeconds)}`)
    let tail: string
    if (snapshot.phase === 'done') tail = colors.success(' · ✓ Completed')
    else if (snapshot.phase === 'failed') tail = colors.error(' · ✗ Failed')
    else tail = colors.primary(' · Running')
    return this.components.truncateToWidth(`  ${branch} ${label}${meta}${tail}`, width)
  }

  /**
   * The kimi second line — failed members show one error line. The baseline
   * has no activity source for pending members (D37 divergence: kimi shows
   * the child's latest activity; only the S33 live tracker has one), so
   * only failures render here.
   */
  private secondLine(snapshot: AgentSnapshot, isLast: boolean, width: number): string | undefined {
    if (snapshot.phase !== 'failed') return undefined
    const prefix = isLast ? '   ' : '│  '
    const errLine = snapshot.errorFirstLine ?? 'Failed'
    const err = this.colors.error(`Error: ${errLine}`)
    return this.components.truncateToWidth(`  ${prefix}    ${err}`, width)
  }

  /** Start the 1 Hz tick when a pending member needs its clock advanced. */
  private ensureTick(): void {
    if (this.tickHandle !== null) return
    for (const member of this.members) {
      if (member.result === undefined) {
        this.tickHandle = agentGroupTimers.setInterval(() => {
          const anyPending = this.members.some(member => member.result === undefined)
          if (!anyPending) {
            this.standDownTick()
            return
          }
          this.invalidate()
          this.requestRender?.()
        }, AGENT_TICK_MS)
        return
      }
    }
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
    // A pending member's elapsed bucket is part of the key, so each tick's
    // rebuilt snapshot changes it while settled members contribute their
    // stable (seq, result) signature.
    const key = `${width}|${this.members.map(member =>
      member.result === undefined
        ? `${member.seq}:p${Math.floor((now - member.startedAt) / 1000)}`
        : `${member.seq}:${member.result.isError}:${member.result.endedAt}`).join('|')}`
    if (this.cache?.key === key) return this.cache.lines
    const snapshots = this.members.map(member => this.snapshot(member, now))
    const lines = ['', this.header(snapshots, width)]
    snapshots.forEach((snapshot, index) => {
      const isLast = index === snapshots.length - 1
      lines.push(this.bodyRow(snapshot, isLast, width))
      const second = this.secondLine(snapshot, isLast, width)
      if (second !== undefined) lines.push(second)
    })
    this.cache = { key, lines }
    this.ensureTick()
    return lines
  }
}
