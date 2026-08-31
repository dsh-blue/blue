import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { JobsBridge, type HarnessJobsSource } from '../src/jobs.ts'

const agent = { id: 'a1' } as unknown as Agent
const snap = (id: string, status: JobSnapshot['status'] = 'running', ownerSession?: string): JobSnapshot => ({ id: id as JobId, kind: 'bash', label: `label-${id}`, ...(ownerSession === undefined ? {} : { ownerSession: ownerSession as JobSnapshot['ownerSession'] }), status, startedAt: 1, reported: false })

const fakeSource = () => {
  const listeners = new Set<(owner: Agent | undefined) => void>()
  const source: HarnessJobsSource = {
    list: vi.fn((_caller?: Agent) => [snap('bash-1')]),
    get: vi.fn((id: JobId) => snap(id)),
    read: vi.fn((id: JobId) => ({ text: 'out', snapshot: snap(id, 'completed') })),
    kill: vi.fn((_id: JobId) => 'requested' as const),
    onJobsChanged: vi.fn((listener: (owner: Agent | undefined) => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
  }
  return { source, listeners, changed: (owner: Agent | undefined) => { for (const listener of listeners) listener(owner) } }
}

describe('JobsBridge', () => {
  it('returns structured absence before attach and after detach', () => {
    const bridge = new JobsBridge()
    expect(bridge.attached).toBe(false)
    expect(bridge.list()).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT', absent: { capability: 'jobs' } })
    expect(bridge.get('bash-1')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(bridge.kill('bash-1')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(bridge.readOutput('bash-1')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    const { source } = fakeSource()
    bridge.attach(source, () => agent)
    expect(bridge.attached).toBe(true)
    expect(bridge.list()).toMatchObject({ ok: true })
    bridge.detach()
    expect(bridge.attached).toBe(false)
    expect(bridge.list()).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
  })
  it('passes the current caller agent through every operation', () => {
    const { source } = fakeSource()
    let current: Agent | undefined
    const bridge = new JobsBridge()
    bridge.attach(source, () => current)
    bridge.list(); expect(source.list).toHaveBeenCalledWith(undefined)
    current = agent
    bridge.list(); bridge.get('bash-1'); bridge.readOutput('bash-1'); bridge.kill('bash-1', 'user request')
    expect(source.list).toHaveBeenLastCalledWith(agent)
    expect(source.get).toHaveBeenCalledWith('bash-1', agent)
    expect(source.read).toHaveBeenCalledWith('bash-1', agent)
    expect(source.kill).toHaveBeenCalledWith('bash-1', agent, 'user request')
    bridge.dispose()
  })
  it('notifies subscribers on attach, detach, and visible-set changes for the caller or unowned jobs only', () => {
    const { source, changed } = fakeSource()
    const other = { id: 'a2' } as unknown as Agent
    const bridge = new JobsBridge()
    const events: string[] = []
    const off = bridge.subscribe(() => events.push('change'))
    bridge.attach(source, () => agent)
    expect(events).toEqual(['change'])
    changed(agent); changed(undefined); changed(other)
    expect(events).toEqual(['change', 'change', 'change'])
    bridge.detach()
    expect(events).toHaveLength(4)
    changed(agent)
    expect(events).toHaveLength(4)
    off(); off()
    bridge.attach(source, () => agent)
    expect(events).toHaveLength(4)
    bridge.dispose()
  })
  it('maps source throws to structured failures', () => {
    const { source } = fakeSource()
    const bridge = new JobsBridge()
    bridge.attach(source, () => agent)
    vi.mocked(source.list).mockImplementationOnce(() => { throw new Error('down') })
    expect(bridge.list()).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'down' })
    vi.mocked(source.list).mockImplementationOnce(() => { throw 'list down' })
    expect(bridge.list()).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'list down' })
    vi.mocked(source.get).mockImplementationOnce(() => { throw new Error('foreign job') })
    expect(bridge.get('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'foreign job' })
    vi.mocked(source.get).mockImplementationOnce(() => { throw 'foreign job' })
    expect(bridge.get('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'foreign job' })
    vi.mocked(source.kill).mockImplementationOnce(() => { throw new Error('unknown') })
    expect(bridge.kill('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'unknown' })
    vi.mocked(source.kill).mockImplementationOnce(() => { throw 'unknown' })
    expect(bridge.kill('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'unknown' })
    vi.mocked(source.read).mockImplementationOnce(() => { throw new Error('unknown') })
    expect(bridge.readOutput('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'unknown' })
    vi.mocked(source.read).mockImplementationOnce(() => { throw 'unknown' })
    expect(bridge.readOutput('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'unknown' })
    bridge.dispose()
  })
  it('unsubscribes the source on detach and dispose and stops emitting after dispose', () => {
    const { source, changed, listeners } = fakeSource()
    const bridge = new JobsBridge()
    const events: string[] = []
    bridge.subscribe(() => events.push('change'))
    bridge.attach(source, () => agent)
    expect(listeners.size).toBe(1)
    bridge.detach()
    expect(listeners.size).toBe(0)
    bridge.attach(source, () => agent)
    bridge.dispose()
    expect(listeners.size).toBe(0)
    changed(agent)
    expect(events.filter(event => event === 'change')).toHaveLength(3)
    expect(bridge.list()).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
  })
})
