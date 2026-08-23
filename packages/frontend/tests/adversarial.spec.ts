import { describe, expect, it } from 'vitest'
import { FrontendHost } from '../src/host.ts'

describe('provider swap races', () => {
  it('serializes concurrent swaps so the last requested provider remains active', async () => {
    const host = new FrontendHost()
    let releaseA!: () => void
    const a = host.swap({ id: 'a', activate: async context => { await new Promise<void>(resolve => { releaseA = resolve }); context.publish({ providerId: 'a', capabilities: [], views: [] }) } })
    const b = host.swap({ id: 'b', activate: context => { context.publish({ providerId: 'b', capabilities: [], views: [] }) } })
    await Promise.resolve()
    releaseA()
    await Promise.all([a, b])
    expect(host.currentProvider.id).toBe('b')
    expect(host.snapshot.providerId).toBe('b')
  })

  it('serializes asynchronous capture before starting a later swap', async () => {
    const host = new FrontendHost()
    const releases: Array<() => void> = []
    await host.activateInitial({
      id: 'initial',
      capture: async () => new Promise(resolve => releases.push(() => resolve({}))),
      activate: context => context.publish({ providerId: 'initial', capabilities: [], views: [] }),
    })
    const first = host.swap({ id: 'first', capture: async () => new Promise(resolve => releases.push(() => resolve({}))), activate: context => context.publish({ providerId: 'first', capabilities: [], views: [] }) })
    const second = host.swap({ id: 'second', activate: context => context.publish({ providerId: 'second', capabilities: [], views: [] }) })
    await Promise.resolve()
    expect(releases).toHaveLength(1)
    releases.shift()?.()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(releases).toHaveLength(1)
    releases.shift()?.()
    await Promise.all([first, second])
    expect(host.currentProvider.id).toBe('second')
    expect(host.snapshot.providerId).toBe('second')
  })
})
