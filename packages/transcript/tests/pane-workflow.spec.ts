/**
 * `blue-pane-workflow` plugin: the workflow-run dock pane. Covers the
 * zero-row empty render, the six-event fold into the running section
 * (header phase/running/elapsed + member tree with outcome markers paired
 * by seq), childId attribution (deferred, foreign dropped at end, agent-less
 * never shown), concurrent runs, the settled summary card surviving until
 * the next turn, session-change and unload cleanup, and the 1 Hz tick's
 * stand-up/stand-down.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from '@deepseek-ai/dsh-workflow'
import type { Context } from '@deepseek-ai/cordis'
import type { BlueSemanticColors } from '@dsh-blue/blue-core'
import { visibleWidth } from '../../core/src/width.ts'
import * as paneWorkflow from '../src/pane-workflow.ts'
import { formatWorkflowElapsed, setWorkflowPaneTimers, WorkflowPaneComponent } from '../src/pane-workflow.ts'
import { resetSeq, turnStart, fakeBlueComponents } from './helpers.ts'
import { bootPanePlugin, type PanePluginHarness } from './pane-fakes.ts'
import { COLORS, fakeAgent, type FakeAgent } from './status-fakes.ts'

afterEach(() => {
  setWorkflowPaneTimers(undefined)
})

/** The frozen wall clock origin the injected timers report from. */
const T0 = 1_700_000_000_000

let clock = T0

/** Captured tick callbacks so a spec can fire the 1 Hz redraw path. */
let ticks: (() => void)[]
let cleared: number

function freezeClock(): void {
  clock = T0
  ticks = []
  cleared = 0
  setWorkflowPaneTimers({
    setInterval: (callback) => {
      ticks.push(callback)
      return ticks.length as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: () => {
      cleared += 1
    },
    now: () => clock,
  })
}

/** The run identity fixture: `publish-check` with two declared phases. */
function runInfo(id = 'run-1', name = 'publish-check'): WorkflowRunInfo {
  return {
    id: id as WorkflowRunInfo['id'],
    meta: {
      name,
      description: 'Release checks',
      phases: [{ title: 'build' }, { title: 'publish' }],
    },
  }
}

function agentStart(seq: number, label: string, childId: string, phase?: string): WorkflowAgentInfo {
  return {
    seq,
    label,
    childId: childId as WorkflowAgentInfo['childId'],
    ...(phase === undefined ? {} : { phase }),
  }
}

function agentEnd(seq: number, outcome: WorkflowAgentEndInfo['outcome'], childId = 'child-1', label = 'npm publish'): WorkflowAgentEndInfo {
  return { ...agentStart(seq, label, childId), outcome }
}

interface Rig extends PanePluginHarness {
  agent: FakeAgent
}

/** Strip SGR runs so assertions see structure, not escape codes. */
const plain = (screen: PanePluginHarness['screen'], width = 80): string[] =>
  screen.paneLines(width).map(row => row.replace(/\x1b\[[0-9;]*m/g, ''))

async function boot(current: FakeAgent | null = null): Promise<Rig> {
  resetSeq()
  freezeClock()
  const agent = current ?? fakeAgent([], { cwd: '/tmp' })
  const harness = await bootPanePlugin(paneWorkflow, agent)
  return { ...harness, agent }
}

/** Emit one full running sequence: start, phase, and one agent start. */
function startRun(ctx: Context, info: WorkflowRunInfo, childId: string): void {
  ctx.emit('workflow/start', info)
  ctx.emit('workflow/phase', info, 'build')
  ctx.emit('workflow/agent-start', info, agentStart(1, 'npm publish', childId, 'build'))
}

describe('blue-pane-workflow plugin', () => {
  it('renders zero rows with no runs', async () => {
    const { screen } = await boot()
    expect(screen.paneLines(80)).toEqual([])
  })

  it('folds the six-event sequence into the running section and the settled card', async () => {
    const rig = await boot()
    const info = runInfo()
    rig.sessionProjections.childIds = ['child-1']
    rig.ctx.emit('workflow/start', info)
    // A start alone is unattributed and renders nothing.
    expect(plain(rig.screen)).toEqual([])
    rig.ctx.emit('workflow/phase', info, 'build')
    rig.ctx.emit('workflow/log', info, 'building artifacts')
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'npm publish', 'child-1', 'build'))
    clock = T0 + 10_000
    let rows = plain(rig.screen)
    expect(rows[0]).toMatch(/^─+$/)
    expect(rows[1]).toContain('Workflow publish-check')
    expect(rows[1]).toContain('phase 1/2')
    expect(rows[1]).toContain('● 1 running')
    expect(rows[1]).toContain('10s')
    expect(rows[2]).toContain('└─')
    expect(rows[2]).toContain('● npm publish')
    expect(rows[2]).toContain('— agent #1')
    expect(rows[2]).toContain('· build')

    rig.ctx.emit('workflow/agent-end', info, agentEnd(1, 'completed'))
    rig.ctx.emit('workflow/end', info, { stopReason: 'completed', agentsStarted: 1 } satisfies WorkflowResultInfo)
    rows = plain(rig.screen)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain('✓ Workflow publish-check — completed · 1 agent · 10s')
  })

  it('does not double-count a repeated phase title', async () => {
    const rig = await boot()
    const info = runInfo()
    rig.sessionProjections.childIds = ['child-1']
    rig.ctx.emit('workflow/start', info)
    rig.ctx.emit('workflow/phase', info, 'build')
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'npm publish', 'child-1', 'build'))
    // A script may re-enter the same phase; the seen-titles set dedupes it.
    rig.ctx.emit('workflow/phase', info, 'build')
    const rows = plain(rig.screen)
    expect(rows[1]).toContain('phase 1/2')
  })

  it('pairs member outcomes by seq and renders every marker', async () => {
    const rig = await boot()
    const info = runInfo()
    rig.sessionProjections.childIds = ['c1', 'c2', 'c3']
    rig.ctx.emit('workflow/start', info)
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'first', 'c1'))
    rig.ctx.emit('workflow/agent-start', info, agentStart(2, 'second', 'c2'))
    rig.ctx.emit('workflow/agent-start', info, agentStart(3, 'third', 'c3'))
    rig.ctx.emit('workflow/agent-end', info, { ...agentStart(2, 'second', 'c2'), outcome: 'failed' })
    rig.ctx.emit('workflow/agent-end', info, { ...agentStart(1, 'first', 'c1'), outcome: 'cancelled' })
    const rows = plain(rig.screen)
    expect(rows[1]).toContain('● 1 running')
    expect(rows[2]).toContain('├─ ⊘ first')
    expect(rows[3]).toContain('├─ ✗ second')
    expect(rows[4]).toContain('└─ ● third')
  })

  it('defers attribution until a member child session is known', async () => {
    const rig = await boot()
    const info = runInfo()
    startRun(rig.ctx, info, 'child-late')
    expect(plain(rig.screen)).toEqual([])
    // The child session registers after its agent-start; the next event of
    // the same run re-attempts attribution and the section appears.
    rig.sessionProjections.childIds = ['child-late']
    rig.ctx.emit('workflow/phase', info, 'publish')
    const rows = plain(rig.screen)
    expect(rows[1]).toContain('Workflow publish-check')
    expect(rows[1]).toContain('phase 2/2')
  })

  it('drops a foreign run at workflow/end without ever rendering it', async () => {
    const rig = await boot()
    const info = runInfo('run-foreign', 'elsewhere')
    startRun(rig.ctx, info, 'someone-elses-child')
    rig.ctx.emit('workflow/end', info, { stopReason: 'completed', agentsStarted: 1 })
    expect(plain(rig.screen)).toEqual([])
  })

  it('never shows an agent-less run', async () => {
    const rig = await boot()
    const info = runInfo('run-solo', 'no-agents')
    rig.ctx.emit('workflow/start', info)
    rig.ctx.emit('workflow/phase', info, 'build')
    rig.ctx.emit('workflow/log', info, 'working alone')
    rig.ctx.emit('workflow/end', info, { stopReason: 'completed', agentsStarted: 0 })
    expect(plain(rig.screen)).toEqual([])
  })

  it('renders concurrent attributed runs as separate sections and hides foreign ones', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-a', 'child-b']
    const first = runInfo('run-a', 'alpha')
    const second = runInfo('run-b', 'beta')
    const foreign = runInfo('run-c', 'gamma')
    startRun(rig.ctx, first, 'child-a')
    startRun(rig.ctx, foreign, 'foreign-child')
    startRun(rig.ctx, second, 'child-b')
    const rows = plain(rig.screen)
    const text = rows.join('\n')
    expect(text).toContain('Workflow alpha')
    expect(text).toContain('Workflow beta')
    expect(text).not.toContain('gamma')
    expect(rows.filter(row => row.match(/^─+$/))).toHaveLength(2)
  })

  it('clears the settled card at the next turn start but keeps a live run', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1', 'child-2']
    const settled = runInfo('run-1', 'settled-run')
    startRun(rig.ctx, settled, 'child-1')
    rig.ctx.emit('workflow/agent-end', settled, agentEnd(1, 'completed', 'child-1'))
    rig.ctx.emit('workflow/end', settled, { stopReason: 'completed', agentsStarted: 1 })
    const live = runInfo('run-2', 'live-run')
    startRun(rig.ctx, live, 'child-2')
    expect(plain(rig.screen).join('\n')).toContain('— completed · 1 agent ·')
    rig.ctx.emit('session/event', rig.agent.session, { ...turnStart(2), seq: 99, time: T0 + 20_000 })
    const rows = plain(rig.screen)
    expect(rows.join('\n')).not.toContain('settled-run')
    expect(rows.join('\n')).toContain('Workflow live-run')
  })

  it('drops every run on a session change', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1']
    startRun(rig.ctx, runInfo(), 'child-1')
    expect(plain(rig.screen).join('\n')).toContain('Workflow publish-check')
    rig.ctx.emit('test/session-changed', fakeAgent([], { cwd: '/tmp' }))
    expect(plain(rig.screen)).toEqual([])
  })

  it('ignores events for unknown runs and unmatched agent-end seqs', async () => {
    const rig = await boot()
    const info = runInfo()
    rig.ctx.emit('workflow/phase', info, 'build')
    rig.ctx.emit('workflow/log', info, 'orphan')
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'x', 'child-1'))
    rig.ctx.emit('workflow/agent-end', info, agentEnd(1, 'completed'))
    rig.ctx.emit('workflow/end', info, { stopReason: 'completed', agentsStarted: 1 })
    expect(plain(rig.screen)).toEqual([])
    // A known run with an agent-end whose seq never started pairs nothing.
    rig.sessionProjections.childIds = ['child-1']
    rig.ctx.emit('workflow/start', info)
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'npm publish', 'child-1'))
    rig.ctx.emit('workflow/agent-end', info, agentEnd(9, 'failed'))
    const rows = plain(rig.screen)
    expect(rows[1]).toContain('● 1 running')
  })

  it('ticks at 1 Hz while an attributed run is live and stands down at settle', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1']
    const info = runInfo()
    rig.ctx.emit('workflow/start', info)
    expect(ticks).toHaveLength(0)
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'npm publish', 'child-1'))
    expect(ticks).toHaveLength(1)
    // A second concurrent run does not stack a second timer.
    rig.ctx.emit('workflow/start', runInfo('run-2', 'beta'))
    rig.ctx.emit('workflow/agent-start', runInfo('run-2', 'beta'), agentStart(1, 'other', 'child-1'))
    expect(ticks).toHaveLength(1)
    const before = rig.screen.renderRequests.length
    clock = T0 + 65_000
    ticks[0]!()
    expect(rig.screen.renderRequests.length).toBeGreaterThan(before)
    expect(plain(rig.screen)[1]).toContain('1m 5s')
    // Settling both runs stands the tick down on the next fire.
    rig.ctx.emit('workflow/agent-end', info, agentEnd(1, 'completed'))
    rig.ctx.emit('workflow/end', info, { stopReason: 'completed', agentsStarted: 1 })
    rig.ctx.emit('workflow/end', runInfo('run-2', 'beta'), { stopReason: 'cancelled', agentsStarted: 1 })
    ticks[0]!()
    expect(cleared).toBeGreaterThan(0)
    const rows = plain(rig.screen).join('\n')
    expect(rows).toContain('⊘ Workflow beta — cancelled · 1 agent ·')
  })

  it('unmounts the pane and stands the tick down with its fiber', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1']
    startRun(rig.ctx, runInfo(), 'child-1')
    expect(rig.screen.bottomChildren.length).toBeGreaterThan(0)
    await rig.dispose()
    expect(rig.screen.bottomChildren).toHaveLength(0)
    expect(cleared).toBe(1)
    // Post-unload events fold into nothing and never throw.
    rig.ctx.emit('workflow/start', runInfo('run-late', 'late'))
    rig.ctx.emit('workflow/agent-start', runInfo('run-late', 'late'), agentStart(1, 'x', 'child-1'))
  })

  it('marks a failed run with the error marker', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1']
    const info = runInfo()
    startRun(rig.ctx, info, 'child-1')
    rig.ctx.emit('workflow/agent-end', info, agentEnd(1, 'failed'))
    rig.ctx.emit('workflow/end', info, { stopReason: 'error', error: 'boom', agentsStarted: 1 })
    const rows = plain(rig.screen)
    expect(rows[1]).toContain('✗ Workflow publish-check — error · 1 agent ·')
  })

  it('derives the phase counter from seen titles when the script uses undeclared text', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1']
    const info = runInfo()
    rig.ctx.emit('workflow/start', info)
    rig.ctx.emit('workflow/phase', info, 'mystery')
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'npm publish', 'child-1'))
    const rows = plain(rig.screen)
    expect(rows[1]).toContain('phase 1/2')
  })

  it('omits the phase segment for scripts without declared phases', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1']
    const info: WorkflowRunInfo = {
      id: 'run-plain' as WorkflowRunInfo['id'],
      meta: { name: 'plain', description: 'no phases' },
    }
    rig.ctx.emit('workflow/start', info)
    rig.ctx.emit('workflow/phase', info, 'ad-hoc')
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'solo', 'child-1'))
    const rows = plain(rig.screen)
    expect(rows[1]).toContain('Workflow plain')
    expect(rows[1]).not.toContain('phase')
  })

  it('clamps every row at narrow widths', async () => {
    const rig = await boot()
    rig.sessionProjections.childIds = ['child-1']
    startRun(rig.ctx, runInfo('run-wide', 'a-very-long-workflow-name-for-narrow-terminals'), 'child-1')
    for (const width of [20, 10, 4]) {
      for (const row of rig.screen.paneLines(width)) {
        expect(visibleWidth(row)).toBeLessThanOrEqual(width)
      }
    }
  })
})

describe('formatWorkflowElapsed', () => {
  it('formats sub-minute seconds and minute+remainder', () => {
    expect(formatWorkflowElapsed(0)).toBe('0s')
    expect(formatWorkflowElapsed(45)).toBe('45s')
    expect(formatWorkflowElapsed(60)).toBe('1m 0s')
    expect(formatWorkflowElapsed(130)).toBe('2m 10s')
  })
})

describe('WorkflowPaneComponent', () => {
  it('renders the settled and running shapes directly and no-ops invalidate', () => {
    const component = new WorkflowPaneComponent(() => [{
      id: 'run-1',
      name: 'direct',
      phases: [{ title: 'only' }],
      phasesSeen: ['only'],
      currentPhase: 'only',
      agents: [{ seq: 1, label: 'member', phase: 'only', childId: 'c1' }],
      startedAt: T0,
      stopReason: undefined,
      endedAt: undefined,
      agentsStarted: undefined,
      attributed: true,
    }], COLORS as BlueSemanticColors, fakeBlueComponents(), () => T0 + 1_000)
    expect(component.render(80).join('\n')).toContain('Workflow direct')
    component.invalidate()
  })
})
