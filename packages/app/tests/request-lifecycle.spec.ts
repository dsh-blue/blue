/**
 * Request lifecycle tests: epoch isolation, terminal interrupted state and
 * Cordis-owned cleanup.
 *
 * @module @dsh-blue/blue-app/tests/request-lifecycle
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createBlueRequestController } from '../src/request-lifecycle.ts'

describe('Blue request lifecycle', () => {
  it('emits started and interrupted exactly once, then rejects stale transitions', () => {
    const ctx = new Context()
    const events: unknown[] = []
    ctx.on('blue/request-state-changed', event => { events.push(event) })
    const requests = createBlueRequestController(ctx)
    const ref = requests.begin()
    requests.interrupt(ref)
    requests.transition(ref, 'completed')
    expect(events).toHaveLength(2)
    expect((events[1] as { state: string }).state).toBe('interrupted')
  })

  it('increments session epochs and rejects the previous request', () => {
    const ctx = new Context()
    const events: unknown[] = []
    ctx.on('blue/request-state-changed', event => { events.push(event) })
    const requests = createBlueRequestController(ctx)
    const old = requests.begin()
    expect(requests.commitSession()).toBe(1)
    requests.transition(old, 'completed')
    const next = requests.begin('btw')
    expect(next).toMatchObject({ sessionEpoch: 1, requestEpoch: 2, scope: 'btw' })
    expect(events).toHaveLength(2)
  })
})
