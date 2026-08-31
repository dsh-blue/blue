/**
 * `blue-pane-workflow` — the workflow-run dock pane: while a `dsh-workflow`
 * run executes in the current session's agent, its structure renders as a
 * dock section pinned directly above the input editor (the pane-agents
 * semantics); once the run settles, the section collapses to a one-row
 * summary card that stays readable until the next turn begins (kimi deletes
 * the settled pane at the next turn begin — the same rule pane-agents
 * follows, and the in-stream record of the run remains the `workflow` tool's
 * own result card).
 *
 * Data plane: the engine (inside the agent preset's isolated `workflowEngine`
 * realm) dispatches the six `workflow/*` lifecycle events through the shared
 * root event bus with no scope filter, so every fiber in the process
 * receives runs from EVERY agent — the pane therefore attributes a run to
 * the current session by cross-checking `agent-start.childId` against the
 * app-owned child-session catalog (`blueSessionProjections.children`), and
 * drops runs it can never attribute (a BTW side session's or another
 * session's run, and agent-less scripts, which have no child to key on).
 * Attribution is re-attempted on each of a pending run's events, so a child
 * session registered slightly after its `agent-start` still lands. Runs stay
 * read-only event state; the pane never touches `workflowEngine`.
 *
 * Rendering: one section per attributed run — a full-width rule, a bold
 * header (`Workflow <name>` + phase x/y from `meta.phases` and the titles
 * seen, running-agent count, 1 Hz elapsed), and a member tree row per
 * agent (`✓`/`✗`/`⊘`/`●` by outcome, paired by `agent.seq`). With no
 * attributed run the pane renders zero rows. Chrome copy is hardcoded
 * English, matching pane-todo/pane-agents.
 *
 * @module @dsh-blue/blue-transcript/pane-workflow
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  WorkflowAgentOutcome,
  WorkflowPhase,
  WorkflowStopReason,
} from '@deepseek-ai/dsh-workflow'
import type { BlueComponent, BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import type { BlueSessionProjectionReader } from '@dsh-blue/blue-app'
import type { BlueBottomPaneNode } from './dock-model.ts'
import type { SessionFactsService } from './session-facts.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-workflow'

/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueSessionFacts', 'blueSessionProjections', 'blueBottomPanes']

/** The dock priority: after agents (50), before the BTW side pane (100). */
const WORKFLOW_PRIORITY = 60

/** The running-elapsed tick rate (the agent-group 1 Hz precedent). */
const WORKFLOW_TICK_MS = 1000

/** Bold SGR pair (the S18 local-constant precedent). */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** One run member: the `agent-start` identity plus its paired outcome. */
export interface WorkflowAgentRow {
  readonly seq: number
  readonly label: string
  readonly phase?: string | undefined
  readonly childId: string
  outcome?: WorkflowAgentOutcome
}

/** The pane's per-run state, folded from the `workflow/*` event stream. */
export interface WorkflowRunState {
  readonly id: string
  readonly name: string
  /** The script's declared phases (progress vocabulary only), if any. */
  readonly phases: readonly WorkflowPhase[] | undefined
  /** Distinct phase titles seen, in first-seen order. */
  readonly phasesSeen: string[]
  /** The latest `workflow/phase` title. */
  currentPhase: string | undefined
  /** Members in `agent-start` order; `agent-end` pairs by `seq`. */
  readonly agents: WorkflowAgentRow[]
  readonly startedAt: number
  /** Set on `workflow/end`; its presence marks the run settled. */
  stopReason: WorkflowStopReason | undefined
  endedAt: number | undefined
  agentsStarted: number | undefined
  /** Whether a member's child session is a direct child of the current one. */
  attributed: boolean
}

/**
 * A run after `workflow/end`: the handler sets the three settled fields
 * together, so the settled card reads them without fallbacks.
 */
type SettledWorkflowRun = WorkflowRunState & {
  stopReason: WorkflowStopReason
  endedAt: number
  agentsStarted: number
}

/** Narrow a run to its settled shape (all three fields settle atomically). */
function isSettled(run: WorkflowRunState): run is SettledWorkflowRun {
  return run.stopReason !== undefined
}

/** The timer + clock primitives; replaceable in tests (ThinkingTimers precedent). */
export interface WorkflowPaneTimers {
  /** Start a repeating callback; mirrors the global `setInterval`. */
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  /** Stop a repeating callback; mirrors the global `clearInterval`. */
  clearInterval: (handle: ReturnType<typeof setInterval>) => void
  /** The wall clock elapsed seconds run against; mirrors `Date.now`. */
  now: () => number
}

/** The process timer primitives, referenced directly (no wrapper bodies). */
const defaultWorkflowPaneTimers: WorkflowPaneTimers = {
  setInterval,
  clearInterval,
  now: Date.now,
}

let workflowPaneTimers: WorkflowPaneTimers = defaultWorkflowPaneTimers

/**
 * Replace the pane timers (tests inject fakes here).
 * @param timers - the replacement, or `undefined` to restore the defaults.
 */
export function setWorkflowPaneTimers(timers: WorkflowPaneTimers | undefined): void {
  workflowPaneTimers = timers ?? defaultWorkflowPaneTimers
}

/** kimi/agent-group elapsed format: `45s`, or `2m 10s` past a minute. */
export function formatWorkflowElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

/**
 * The header's `phase x/y` segment: `y` is the declared phase count, `x` the
 * current title's 1-based position in `meta.phases` (falling back to the
 * count of declared titles seen, for scripts whose `phase()` text is not
 * declared). Absent when the script declares no phases or none ran yet.
 */
function phaseSegment(run: WorkflowRunState): string | undefined {
  const phases = run.phases
  if (phases === undefined || phases.length === 0 || run.currentPhase === undefined) return undefined
  const index = phases.findIndex(phase => phase.title === run.currentPhase)
  const current = index >= 0
    ? index + 1
    : Math.max(1, run.phasesSeen.filter(title => phases.some(phase => phase.title === title)).length)
  return `phase ${String(current)}/${String(phases.length)}`
}

/**
 * The workflow dock section renderer: rules, headers, and member rows for
 * every attributed run, all rows clamped through the components width truth.
 */
export class WorkflowPaneComponent implements BlueComponent {
  constructor(
    private readonly runs: () => readonly WorkflowRunState[],
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
    private readonly now: () => number,
  ) {}

  /** The running header: bold name plus the phase/running/elapsed tail. */
  private headerRow(run: WorkflowRunState, width: number): string {
    const running = run.agents.filter(agent => agent.outcome === undefined).length
    const tail: string[] = []
    const phase = phaseSegment(run)
    if (phase !== undefined) tail.push(phase)
    tail.push(`${String(running)} running`)
    tail.push(formatWorkflowElapsed(Math.max(0, Math.floor((this.now() - run.startedAt) / 1000))))
    const name = `${BOLD_OPEN}${this.colors.primary(`Workflow ${run.name}`)}${BOLD_CLOSE}`
    const separator = this.colors.muted(' · ')
    const segments = tail.map((segment, index) =>
      index === tail.length - 2 && running > 0
        ? `${this.colors.primary('●')} ${this.colors.muted(segment)}`
        : this.colors.muted(segment))
    return this.components.truncateToWidth(`  ${name}  ${segments.join(separator)}`, width)
  }

  /** One member tree row: branch, outcome marker, label, and the seq tail. */
  private memberRow(agent: WorkflowAgentRow, isLast: boolean, width: number): string {
    const branch = isLast ? '└─' : '├─'
    const marker = agent.outcome === undefined
      ? this.colors.primary(`${BOLD_OPEN}●${BOLD_CLOSE}`)
      : agent.outcome === 'completed'
        ? this.colors.success('✓')
        : agent.outcome === 'failed'
          ? this.colors.error('✗')
          : this.colors.muted('⊘')
    const phase = agent.phase === undefined ? '' : this.colors.muted(` · ${agent.phase}`)
    return this.components.truncateToWidth(`  ${branch} ${marker} ${agent.label}${this.colors.muted(` — agent #${String(agent.seq)}`)}${phase}`, width)
  }

  /** The settled summary card: one row replacing the whole live section. */
  private settledRow(run: SettledWorkflowRun, width: number): string {
    const reason = run.stopReason
    const marker = reason === 'completed'
      ? this.colors.success('✓')
      : reason === 'cancelled'
        ? this.colors.muted('⊘')
        : this.colors.error('✗')
    const count = run.agentsStarted
    const elapsed = formatWorkflowElapsed(Math.max(0, Math.floor((run.endedAt - run.startedAt) / 1000)))
    const tail = this.colors.muted(` — ${reason} · ${String(count)} agent${count === 1 ? '' : 's'} · ${elapsed}`)
    return this.components.truncateToWidth(`  ${marker} ${BOLD_OPEN}${this.colors.primary(`Workflow ${run.name}`)}${BOLD_CLOSE}${tail}`, width)
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows: one ruled section per attributed run.
   */
  render(width: number): string[] {
    const rows: string[] = []
    for (const run of this.runs()) {
      rows.push(this.colors.border('─'.repeat(Math.max(0, width))))
      if (isSettled(run)) {
        rows.push(this.settledRow(run, width))
        continue
      }
      rows.push(this.headerRow(run, width))
      run.agents.forEach((agent, index) => {
        rows.push(this.memberRow(agent, index === run.agents.length - 1, width))
      })
    }
    return rows.map(row => this.components.truncateToWidth(row, width))
  }

  /** Stateless render: nothing to invalidate. */
  invalidate(): void {}
}

/**
 * Mount the workflow pane bottom-pinned. `workflow/*` events arrive on the
 * shared root bus unfiltered, so handlers fold every run but only attributed
 * ones render or redraw; a run still unattributed at `workflow/end` is
 * dropped unseen. A settled section survives until the next turn begins; a
 * session identity change drops every run. The 1 Hz tick runs only while an
 * attributed run is live, and unloading the fiber unmounts the pane, stands
 * the tick down, and releases the subscriptions.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const projections = ctx.blueSessionProjections as BlueSessionProjectionReader
  const runs = new Map<string, WorkflowRunState>()
  let tickHandle: ReturnType<typeof setInterval> | null = null

  /** The current session's direct child session ids (live catalog read). */
  const childIds = (): Set<string> =>
    new Set(projections.children('blueConversationFacts').map(child => child.id))

  /**
   * Attribute a pending run: one member child session in the current
   * session's catalog is enough. Re-attempted on every later event of the
   * run, so a child registered after its `agent-start` still lands.
   */
  const attribute = (run: WorkflowRunState): boolean => {
    if (run.attributed) return true
    const children = childIds()
    if (run.agents.some(agent => children.has(agent.childId))) run.attributed = true
    return run.attributed
  }

  const refresh = (): void => {
    ctx.blueBottomPanes.refresh('blue.dock.workflow')
  }

  const standDownTick = (): void => {
    if (tickHandle === null) return
    workflowPaneTimers.clearInterval(tickHandle)
    tickHandle = null
  }

  /** Keep the 1 Hz elapsed tick alive exactly while an attributed run is live. */
  const ensureTick = (): void => {
    const live = [...runs.values()].some(run => run.attributed && run.stopReason === undefined)
    if (!live) {
      standDownTick()
      return
    }
    if (tickHandle !== null) return
    tickHandle = workflowPaneTimers.setInterval(() => {
      const anyLeft = [...runs.values()].some(run => run.attributed && run.stopReason === undefined)
      if (!anyLeft) {
        standDownTick()
        return
      }
      refresh()
    }, WORKFLOW_TICK_MS)
  }
  ctx.effect(() => () => standDownTick())

  ctx.on('workflow/start', (info) => {
    const id = String(info.id)
    runs.set(id, {
      id,
      name: info.meta.name,
      phases: info.meta.phases,
      phasesSeen: [],
      currentPhase: undefined,
      agents: [],
      startedAt: workflowPaneTimers.now(),
      stopReason: undefined,
      endedAt: undefined,
      agentsStarted: undefined,
      attributed: false,
    })
    // Unattributed runs render nothing, so a start alone never redraws.
  })

  ctx.on('workflow/phase', (info, title) => {
    const run = runs.get(String(info.id))
    if (run === undefined) return
    run.currentPhase = title
    if (!run.phasesSeen.includes(title)) run.phasesSeen.push(title)
    if (attribute(run)) refresh()
  })

  ctx.on('workflow/log', (info) => {
    // Narration stays in the transcript stream's tool card; the pane tracks
    // structure only. The event still re-attempts pending attribution.
    const run = runs.get(String(info.id))
    if (run === undefined) return
    attribute(run)
  })

  ctx.on('workflow/agent-start', (info, agent) => {
    const run = runs.get(String(info.id))
    if (run === undefined) return
    run.agents.push({
      seq: agent.seq,
      label: agent.label,
      phase: agent.phase,
      childId: String(agent.childId),
    })
    if (attribute(run)) refresh()
    ensureTick()
  })

  ctx.on('workflow/agent-end', (info, agent) => {
    const run = runs.get(String(info.id))
    if (run === undefined) return
    const member = run.agents.find(candidate => candidate.seq === agent.seq)
    if (member !== undefined) member.outcome = agent.outcome
    if (attribute(run)) refresh()
  })

  ctx.on('workflow/end', (info, result) => {
    const run = runs.get(String(info.id))
    if (run === undefined) return
    if (!attribute(run)) {
      // A run with no current-session member never appeared; drop its state.
      runs.delete(run.id)
      return
    }
    run.stopReason = result.stopReason
    run.endedAt = workflowPaneTimers.now()
    run.agentsStarted = result.agentsStarted
    refresh()
    ensureTick()
  })

  // The settled summary stays readable between turns and vanishes when the
  // next turn begins (the pane-agents kimi semantics); a live run persists
  // across the boundary.
  const facts = ctx.get('blueSessionFacts') as SessionFactsService
  let lastTurn = -1
  const offFacts = facts.subscribe((next) => {
    if (next.turn > lastTurn) {
      let cleared = false
      for (const [id, run] of runs) {
        if (run.stopReason === undefined) continue
        runs.delete(id)
        cleared = true
      }
      if (cleared) {
        refresh()
        ensureTick()
      }
    }
    lastTurn = Math.max(lastTurn, next.turn)
  })
  ctx.effect(() => () => offFacts())

  let sessionId = facts.currentSession?.id
  const offSession = facts.subscribeSession((session) => {
    if (session?.id === sessionId) return
    sessionId = session?.id
    lastTurn = -1
    runs.clear()
    refresh()
    ensureTick()
  })
  ctx.effect(() => () => offSession())

  const attributedRuns = (): readonly WorkflowRunState[] =>
    [...runs.values()].filter(run => run.attributed)
  const component = new WorkflowPaneComponent(attributedRuns, colors, components, () => workflowPaneTimers.now())

  const model = (): BlueBottomPaneNode => ({
    id: 'blue.dock.workflow', priority: WORKFLOW_PRIORITY,
    node: { kind: 'text', content: '', tone: 'muted' },
    collapsed: attributedRuns().length === 0,
  })
  ctx.effect(() => ctx.blueBottomPanes.register(model, (_node, width) => component.render(width)))
}
