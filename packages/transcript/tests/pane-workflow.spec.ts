/** Native workflow event pane behavior.
 * @module @dsh-blue/blue-transcript/tests/pane-workflow
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from '@deepseek-ai/dsh-workflow'
import { afterEach, describe, expect, it } from 'vitest'
import * as workflow from '../src/pane-workflow.ts'
import { formatWorkflowElapsed, setWorkflowPaneTimers, workflowNode } from '../src/pane-workflow.ts'
import { resetSeq, turnStart } from './helpers.ts'
import { bootPanePlugin, type PanePluginHarness } from './pane-fakes.ts'
import { fakeAgent, type FakeAgent } from './status-fakes.ts'

const T0 = 1_700_000_000_000
let clock = T0
let ticks: Array<() => void> = []
let cleared = 0

afterEach(() => { setWorkflowPaneTimers(undefined) })

function freezeClock(): void {
  clock = T0
  ticks = []
  cleared = 0
  setWorkflowPaneTimers({
    setInterval(callback) {
      ticks.push(callback)
      return { unref() {} } as unknown as ReturnType<typeof setInterval>
    },
    clearInterval() { cleared += 1 },
    now: () => clock,
  })
}

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
    childId: SessionId(childId),
    ...(phase === undefined ? {} : { phase }),
  }
}

function agentEnd(seq: number, outcome: WorkflowAgentEndInfo['outcome'], childId = 'child-1', label = 'npm publish'): WorkflowAgentEndInfo {
  return { ...agentStart(seq, label, childId), outcome }
}

interface Rig extends PanePluginHarness {
  readonly agent: FakeAgent
  readonly childIds: string[]
}

async function boot(): Promise<Rig> {
  resetSeq()
  freezeClock()
  const agent = fakeAgent([], { cwd: '/tmp' })
  const childIds: string[] = []
  const sessions = {
    list: () => [
      { id: SessionId('ordinary'), header: { origin: 'user', cwd: '/tmp' } } as unknown as Session,
      ...childIds.map(id => ({
      id: SessionId(id),
      header: { origin: 'subagent', parentSession: agent.id, cwd: '/tmp' },
      } as unknown as Session)),
    ],
  }
  const harness = await bootPanePlugin(workflow, agent, { sessions })
  return { ...harness, agent, childIds }
}

function plain(rig: Rig, width = 80): string[] {
  return rig.screen.paneLines(width).map(row => row.replace(/\x1b\[[0-9;]*m/g, ''))
}

function startRun(ctx: Context, info: WorkflowRunInfo, childId: string): void {
  ctx.emit('workflow/start', info)
  ctx.emit('workflow/phase', info, 'build')
  ctx.emit('workflow/agent-start', info, agentStart(1, 'npm publish', childId, 'build'))
}

describe('workflow model helpers', () => {
  it('formats elapsed values and returns no node for no runs', () => {
    expect(formatWorkflowElapsed(0)).toBe('0s')
    expect(formatWorkflowElapsed(45)).toBe('45s')
    expect(formatWorkflowElapsed(60)).toBe('1m 0s')
    expect(formatWorkflowElapsed(130)).toBe('2m 10s')
    expect(workflowNode([], T0)).toBeNull()
  })

  it('builds running and settled nodes for every marker and phase shape', () => {
    const running = workflowNode([{
      id: 'run', name: 'direct', phases: [{ title: 'only' }], phasesSeen: ['only'], currentPhase: 'only',
      agents: [
        { seq: 1, label: 'running', childId: 'c1' },
        { seq: 2, label: 'done', childId: 'c2', outcome: 'completed' },
        { seq: 3, label: 'failed', childId: 'c3', outcome: 'failed' },
        { seq: 4, label: 'cancelled', childId: 'c4', outcome: 'cancelled' },
      ],
      startedAt: T0, stopReason: undefined, endedAt: undefined, agentsStarted: undefined, attributed: true,
    }], T0 + 1_000)
    expect(JSON.stringify(running)).toContain('phase 1/1')
    expect(JSON.stringify(running)).toContain('cancelled')
    for (const reason of ['completed', 'cancelled', 'error'] as const) {
      const settled = workflowNode([{
        id: reason, name: reason, phases: undefined, phasesSeen: [], currentPhase: undefined, agents: [],
        startedAt: T0, stopReason: reason, endedAt: T0 + 1_000,
        agentsStarted: reason === 'completed' ? 1 : undefined, attributed: true,
      }], T0 + 2_000)
      expect(JSON.stringify(settled)).toContain(reason)
    }
    expect(JSON.stringify(workflowNode([{
      id: 'fallback', name: 'fallback', phases: undefined, phasesSeen: [], currentPhase: undefined,
      agents: [{ seq: 1, label: 'member', childId: 'child' }], startedAt: T0,
      stopReason: 'completed', endedAt: undefined, agentsStarted: undefined, attributed: true,
    }], T0))).toContain('1 agent')
  })
})

describe('blue-pane-workflow', () => {
  it('renders no rows until a native child Session attributes the run', async () => {
    const rig = await boot()
    const info = runInfo()
    startRun(rig.ctx, info, 'child-late')
    expect(plain(rig)).toEqual([])
    rig.childIds.push('child-late')
    rig.ctx.emit('workflow/log', info, 'retry attribution')
    rig.ctx.emit('workflow/phase', info, 'publish')
    expect(plain(rig)[1]).toContain('phase 2/2')
    await rig.dispose()
  })

  it('folds all lifecycle facts into a running tree and settled summary', async () => {
    const rig = await boot()
    rig.childIds.push('child-1', 'child-2', 'child-3')
    const info = runInfo()
    rig.ctx.emit('workflow/start', info)
    rig.ctx.emit('workflow/phase', info, 'build')
    rig.ctx.emit('workflow/phase', info, 'build')
    rig.ctx.emit('workflow/agent-start', info, agentStart(1, 'first', 'child-1', 'build'))
    rig.ctx.emit('workflow/agent-start', info, agentStart(2, 'second', 'child-2'))
    rig.ctx.emit('workflow/agent-start', info, agentStart(3, 'third', 'child-3'))
    rig.ctx.emit('workflow/agent-end', info, agentEnd(1, 'cancelled', 'child-1', 'first'))
    rig.ctx.emit('workflow/agent-end', info, agentEnd(2, 'failed', 'child-2', 'second'))
    rig.ctx.emit('workflow/agent-end', info, agentEnd(99, 'completed'))
    clock = T0 + 10_000
    let rows = plain(rig)
    expect(rows[1]).toContain('Workflow publish-check')
    expect(rows[1]).toContain('● 1 running')
    expect(rows[1]).toContain('10s')
    expect(rows[2]).toContain('├─ ⊘ first')
    expect(rows[3]).toContain('├─ ✗ second')
    expect(rows[4]).toContain('└─ ● third')
    rig.ctx.emit('workflow/agent-end', info, agentEnd(3, 'completed', 'child-3', 'third'))
    rig.ctx.emit('workflow/end', info, { stopReason: 'completed', agentsStarted: 3 } satisfies WorkflowResultInfo)
    rows = plain(rig)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain('✓ Workflow publish-check — completed · 3 agents · 10s')
    await rig.dispose()
  })

  it('keeps concurrent attributed runs separate and drops foreign or agent-less runs', async () => {
    const rig = await boot()
    rig.childIds.push('child-a', 'child-b')
    const first = runInfo('run-a', 'alpha')
    const second = runInfo('run-b', 'beta')
    const foreign = runInfo('run-c', 'gamma')
    startRun(rig.ctx, first, 'child-a')
    startRun(rig.ctx, foreign, 'foreign')
    startRun(rig.ctx, second, 'child-b')
    rig.ctx.emit('workflow/agent-end', foreign, agentEnd(1, 'failed', 'foreign'))
    rig.ctx.emit('workflow/end', foreign, { stopReason: 'completed', agentsStarted: 1 })
    const solo = runInfo('run-solo', 'solo')
    rig.ctx.emit('workflow/start', solo)
    rig.ctx.emit('workflow/phase', solo, 'build')
    rig.ctx.emit('workflow/log', solo, 'no agents')
    rig.ctx.emit('workflow/end', solo, { stopReason: 'completed', agentsStarted: 0 })
    const text = plain(rig).join('\n')
    expect(text).toContain('Workflow alpha')
    expect(text).toContain('Workflow beta')
    expect(text).not.toContain('gamma')
    expect(text).not.toContain('solo')
    rig.ctx.emit('workflow/agent-end', runInfo('missing-run'), agentEnd(1, 'failed', 'foreign'))
    await rig.dispose()
  })

  it('clears settled runs at the next turn while retaining live runs', async () => {
    const rig = await boot()
    rig.childIds.push('child-1', 'child-2')
    const settled = runInfo('settled', 'settled-run')
    startRun(rig.ctx, settled, 'child-1')
    rig.ctx.emit('workflow/end', settled, { stopReason: 'completed', agentsStarted: 1 })
    startRun(rig.ctx, runInfo('live', 'live-run'), 'child-2')
    rig.ctx.emit('session/event', rig.agent.session as unknown as Session, { ...turnStart(2), seq: 99, time: T0 + 20_000 })
    rig.ctx.emit('session/event', rig.agent.session as unknown as Session, { ...turnStart(2), seq: 100, time: T0 + 21_000 })
    const text = plain(rig).join('\n')
    expect(text).not.toContain('settled-run')
    expect(text).toContain('live-run')
    await rig.dispose()
  })

  it('drops all runs on current-Agent replacement and ignores unknown events', async () => {
    const rig = await boot()
    const unknown = runInfo('unknown')
    rig.ctx.emit('workflow/phase', unknown, 'build')
    rig.ctx.emit('workflow/log', unknown, 'orphan')
    rig.ctx.emit('workflow/agent-start', unknown, agentStart(1, 'x', 'child-1'))
    rig.ctx.emit('workflow/agent-end', unknown, agentEnd(1, 'completed'))
    rig.ctx.emit('workflow/end', unknown, { stopReason: 'completed', agentsStarted: 1 })
    rig.ctx.emit('test/session-changed', null)
    startRun(rig.ctx, runInfo('no-agent'), 'child-1')
    expect(plain(rig)).toEqual([])
    rig.ctx.emit('test/session-changed', rig.agent)
    rig.childIds.push('child-1')
    startRun(rig.ctx, runInfo(), 'child-1')
    expect(plain(rig).join('\n')).toContain('publish-check')
    rig.ctx.emit('test/session-changed', fakeAgent([], { cwd: '/tmp' }))
    expect(plain(rig)).toEqual([])
    await rig.dispose()
  })

  it('ticks once for concurrent live runs and stands down after settlement and unload', async () => {
    const rig = await boot()
    rig.childIds.push('child-1')
    const first = runInfo()
    startRun(rig.ctx, first, 'child-1')
    startRun(rig.ctx, runInfo('run-2', 'beta'), 'child-1')
    expect(ticks).toHaveLength(1)
    const before = rig.screen.renderRequests.length
    clock = T0 + 65_000
    ticks[0]!()
    expect(rig.screen.renderRequests.length).toBeGreaterThan(before)
    expect(plain(rig)[1]).toContain('1m 5s')
    rig.ctx.emit('workflow/end', first, { stopReason: 'error', agentsStarted: 1 })
    rig.ctx.emit('workflow/end', runInfo('run-2', 'beta'), { stopReason: 'cancelled', agentsStarted: 1 })
    expect(plain(rig).join('\n')).toContain('✗ Workflow publish-check')
    expect(plain(rig).join('\n')).toContain('⊘ Workflow beta')
    ticks[0]!()
    expect(cleared).toBeGreaterThan(0)
    await rig.dispose()
    rig.ctx.emit('workflow/start', runInfo('late'))
    rig.ctx.emit('workflow/agent-start', runInfo('late'), agentStart(1, 'late', 'child-1'))
  })

  it('omits phases when undeclared and derives fallback progress for unknown titles', async () => {
    const rig = await boot()
    rig.childIds.push('child-1')
    const unknown = runInfo()
    rig.ctx.emit('workflow/start', unknown)
    rig.ctx.emit('workflow/phase', unknown, 'mystery')
    rig.ctx.emit('workflow/agent-start', unknown, agentStart(1, 'one', 'child-1'))
    expect(plain(rig)[1]).toContain('phase 1/2')
    const plainRun: WorkflowRunInfo = { id: 'plain' as WorkflowRunInfo['id'], meta: { name: 'plain', description: 'none' } }
    rig.ctx.emit('workflow/start', plainRun)
    rig.ctx.emit('workflow/phase', plainRun, 'ad-hoc')
    rig.ctx.emit('workflow/agent-start', plainRun, agentStart(1, 'two', 'child-1'))
    expect(plain(rig).find(row => row.includes('Workflow plain'))).not.toContain('phase')
    await rig.dispose()
  })

  it('keeps every canonical row within narrow width budgets', async () => {
    const rig = await boot()
    rig.childIds.push('child-1')
    startRun(rig.ctx, runInfo('wide', 'a-very-long-workflow-name-for-narrow-terminals'), 'child-1')
    for (const width of [20, 10, 4]) {
      for (const row of rig.screen.paneLines(width)) expect([...row].length).toBeLessThanOrEqual(width)
    }
    await rig.dispose()
  })
})
