import { describe, expect, it } from 'vitest'
import { ProjectionRegistry, type RegistrySource } from '../src/registry.ts'

function sourceIgnoringAbort(gate: { release?: () => void }): RegistrySource<number> {
  return {
    snapshot: async () => { await new Promise<void>(resolve => { gate.release = resolve }); return { watermark: 0, value: [1] } },
    subscribe: () => () => undefined,
  }
}

describe('frontend runtime adversarial races', () => {
  it('does not install a projection slot when attach is aborted during baseline', async () => {
    const registry = new ProjectionRegistry()
    const controller = new AbortController()
    const gate: { release?: () => void } = {}
    registry.register('counter', { init: () => 0, apply: (state, event) => state + event }, sourceIgnoringAbort(gate))
    const attached = registry.attach('counter', 's1', controller.signal)
    await Promise.resolve()
    controller.abort()
    gate.release?.()
    await expect(attached).resolves.toEqual({ ok: false, code: 'BLUE_ABORTED' })
    expect(registry.snapshot('counter', 's1')).toEqual({ watermark: -1 })
  })
})
