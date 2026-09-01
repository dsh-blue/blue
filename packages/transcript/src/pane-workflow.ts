/**
 * Read-only workflow lifecycle pane attributed to the current Agent through
 * native child Sessions.
 *
 * @module @dsh-blue/blue-transcript/pane-workflow
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  WorkflowAgentOutcome,
  WorkflowPhase,
  WorkflowStopReason,
} from '@deepseek-ai/dsh-workflow'
import type { BlueInlineSpan, BlueUiNode } from '@dsh-blue/blue-api'
import type { SessionFactsService } from './session-facts.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-workflow'

/** Native and Blue services required by the pane. */
export const inject = ['bluePanes', 'blueCurrentAgent', 'blueSessionFacts', 'sessions']

const WORKFLOW_PRIORITY = 60
const WORKFLOW_TICK_MS = 1000

/** One workflow child call and its eventual outcome. */
export interface WorkflowAgentRow {
  readonly seq: number
  readonly label: string
  readonly phase?: string | undefined
  readonly childId: string
  outcome?: WorkflowAgentOutcome
}

/** Per-run state folded from native `workflow/*` lifecycle facts. */
export interface WorkflowRunState {
  readonly id: string
  readonly name: string
  readonly phases: readonly WorkflowPhase[] | undefined
  readonly phasesSeen: string[]
  currentPhase: string | undefined
  readonly agents: WorkflowAgentRow[]
  readonly startedAt: number
  stopReason: WorkflowStopReason | undefined
  endedAt: number | undefined
  agentsStarted: number | undefined
  attributed: boolean
}

/** Injectable timer primitives for deterministic lifecycle tests. */
export interface WorkflowPaneTimers {
  setInterval: (callback: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval: (handle: ReturnType<typeof setInterval>) => void
  now: () => number
}

const defaultTimers: WorkflowPaneTimers = { setInterval, clearInterval, now: Date.now }
let workflowPaneTimers = defaultTimers

/** Replace or restore workflow pane timers. */
export function setWorkflowPaneTimers(timers: WorkflowPaneTimers | undefined): void {
  workflowPaneTimers = timers ?? defaultTimers
}

/** Compact workflow elapsed time. */
export function formatWorkflowElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

function phaseSegment(run: WorkflowRunState): string | undefined {
  const phases = run.phases
  if (phases === undefined || phases.length === 0 || run.currentPhase === undefined) return undefined
  const index = phases.findIndex(phase => phase.title === run.currentPhase)
  const current = index >= 0
    ? index + 1
    : Math.max(1, run.phasesSeen.filter(title => phases.some(phase => phase.title === title)).length)
  return `phase ${String(current)}/${String(phases.length)}`
}

function runningHeader(run: WorkflowRunState, now: number): BlueUiNode {
  const running = run.agents.filter(agent => agent.outcome === undefined).length
  const parts = [
    phaseSegment(run),
    `${String(running)} running`,
    formatWorkflowElapsed(Math.max(0, Math.floor((now - run.startedAt) / 1000))),
  ].filter((value): value is string => value !== undefined)
  const spans: BlueInlineSpan[] = [
    { text: `  Workflow ${run.name}`, tone: 'accent', emphasis: 'strong' },
    { text: '  ', tone: 'muted' },
  ]
  parts.forEach((part, index) => {
    if (index > 0) spans.push({ text: ' · ', tone: 'muted' })
    if (part === `${String(running)} running` && running > 0) spans.push({ text: '● ', tone: 'accent', emphasis: 'strong' })
    spans.push({ text: part, tone: 'muted' })
  })
  return { kind: 'rich-text', spans }
}

function memberNode(agent: WorkflowAgentRow, last: boolean): BlueUiNode {
  const marker = agent.outcome === undefined
    ? { text: '● ', tone: 'accent' as const, emphasis: 'strong' as const }
    : agent.outcome === 'completed'
      ? { text: '✓ ', tone: 'success' as const }
      : agent.outcome === 'failed'
        ? { text: '✗ ', tone: 'danger' as const }
        : { text: '⊘ ', tone: 'muted' as const }
  return {
    kind: 'rich-text',
    spans: [
      { text: `  ${last ? '└─' : '├─'} `, tone: 'muted' },
      marker,
      { text: agent.label },
      { text: ` — agent #${String(agent.seq)}`, tone: 'muted' },
      ...(agent.phase === undefined ? [] : [{ text: ` · ${agent.phase}`, tone: 'muted' as const }]),
    ],
  }
}

function settledNode(run: WorkflowRunState): BlueUiNode {
  const reason = run.stopReason!
  const marker = reason === 'completed'
    ? { text: '✓ ', tone: 'success' as const }
    : reason === 'cancelled'
      ? { text: '⊘ ', tone: 'muted' as const }
      : { text: '✗ ', tone: 'danger' as const }
  const count = run.agentsStarted ?? run.agents.length
  const elapsed = formatWorkflowElapsed(Math.max(0, Math.floor(((run.endedAt ?? run.startedAt) - run.startedAt) / 1000)))
  return {
    kind: 'rich-text',
    spans: [
      { text: '  ' },
      marker,
      { text: `Workflow ${run.name}`, tone: 'accent', emphasis: 'strong' },
      { text: ` — ${reason} · ${String(count)} agent${count === 1 ? '' : 's'} · ${elapsed}`, tone: 'muted' },
    ],
  }
}

/** Build the canonical pane tree for attributed runs. */
export function workflowNode(runs: readonly WorkflowRunState[], now: number): BlueUiNode | null {
  if (runs.length === 0) return null
  const children: { readonly node: BlueUiNode }[] = []
  for (const run of runs) {
    children.push({ node: { kind: 'divider' } })
    if (run.stopReason !== undefined) {
      children.push({ node: settledNode(run) })
      continue
    }
    children.push({ node: runningHeader(run, now) })
    run.agents.forEach((agent, index) => children.push({ node: memberNode(agent, index === run.agents.length - 1) }))
  }
  return { kind: 'stack', direction: 'column', gap: 0, children }
}

/** Mount the native workflow event fold as a direct bottom-pane contribution. */
export function apply(ctx: Context): void {
  const runs = new Map<string, WorkflowRunState>()
  let tickHandle: ReturnType<typeof setInterval> | undefined
  let pane: ReturnType<typeof ctx.bluePanes.register>

  const currentChildIds = (): Set<string> => {
    const parent = ctx.blueCurrentAgent.current()
    if (parent === null) return new Set()
    return new Set([...ctx.sessions.list()].flatMap(session =>
      session.header.origin === 'subagent' && session.header.parentSession === parent.id
        ? [String(session.id)]
        : [],
    ))
  }
  const attribute = (run: WorkflowRunState): boolean => {
    if (run.attributed) return true
    const children = currentChildIds()
    if (run.agents.some(agent => children.has(agent.childId))) run.attributed = true
    return run.attributed
  }
  const attributedRuns = (): readonly WorkflowRunState[] => [...runs.values()].filter(run => run.attributed)
  const refresh = (): void => pane?.refresh()
  const standDownTick = (): void => {
    if (tickHandle === undefined) return
    workflowPaneTimers.clearInterval(tickHandle)
    tickHandle = undefined
  }
  const ensureTick = (): void => {
    const live = attributedRuns().some(run => run.stopReason === undefined)
    if (!live) {
      standDownTick()
      return
    }
    if (tickHandle !== undefined) return
    tickHandle = workflowPaneTimers.setInterval(() => {
      if (!attributedRuns().some(run => run.stopReason === undefined)) standDownTick()
      else refresh()
    }, WORKFLOW_TICK_MS)
    tickHandle.unref?.()
  }

  ctx.on('workflow/start', (info) => {
    runs.set(String(info.id), {
      id: String(info.id),
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
  })
  ctx.on('workflow/phase', (info, title) => {
    const run = runs.get(String(info.id))
    if (run === undefined) return
    run.currentPhase = title
    if (!run.phasesSeen.includes(title)) run.phasesSeen.push(title)
    if (attribute(run)) refresh()
  })
  ctx.on('workflow/log', (info) => {
    const run = runs.get(String(info.id))
    if (run !== undefined) attribute(run)
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
      runs.delete(run.id)
      return
    }
    run.stopReason = result.stopReason
    run.endedAt = workflowPaneTimers.now()
    run.agentsStarted = result.agentsStarted
    refresh()
    ensureTick()
  })

  const facts = ctx.get('blueSessionFacts') as SessionFactsService
  let lastTurn = -1
  const offFacts = facts.subscribe(next => {
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
  const offAgent = ctx.blueCurrentAgent.subscribe(() => {
    lastTurn = -1
    runs.clear()
    refresh()
    ensureTick()
  })

  pane = ctx.bluePanes.register({
    id: 'blue.pane.workflow',
    title: 'Workflow',
    placement: 'bottom',
    priority: WORKFLOW_PRIORITY,
    narrow: 'bottom',
    render: () => workflowNode(attributedRuns(), workflowPaneTimers.now()),
  })
  ctx.effect(() => () => {
    standDownTick()
    offFacts()
    offAgent()
    pane.dispose()
  })
}
