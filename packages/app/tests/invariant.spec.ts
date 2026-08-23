/** The session-changed commit-point invariant: the broadcast Agent and its model handle must already be the referenced ones. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueModelSelectionRef } from '../src/model-ref.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BlueAppInvariant from '../src/invariant.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(BlueAppInvariant)
  return ctx
}

describe('blue app invariants', () => {
  it('accepts a broadcast whose reference already points at the Agent', async () => {
    const ctx = await setup()
    const agent = { id: 'a1' } as Agent
    const modelRef = {} as BlueModelSelectionRef
    ctx.provide('blueSession', { current: agent, modelRef })
    expect(() => { ctx.emit('blue/session-changed', agent) }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('rejects a broadcast that precedes the reference update', async () => {
    const ctx = await setup()
    const agent = { id: 'a1' } as Agent
    ctx.provide('blueSession', { current: null, modelRef: {} as BlueModelSelectionRef })
    expect(() => { ctx.emit('blue/session-changed', agent) })
      .toThrow(/before blueSession\.current pointed at the broadcast Agent/)
    await ctx.fiber.dispose()
  })

  it('rejects a broadcast without the blueSession service', async () => {
    const ctx = await setup()
    const agent = { id: 'a1' } as Agent
    expect(() => { ctx.emit('blue/session-changed', agent) })
      .toThrow(/without the blueSession service/)
    await ctx.fiber.dispose()
  })

  it('rejects a broadcast that precedes the model-handle publication', async () => {
    const ctx = await setup()
    const agent = { id: 'a1' } as Agent
    ctx.provide('blueSession', { current: agent, modelRef: undefined })
    expect(() => { ctx.emit('blue/session-changed', agent) })
      .toThrow(/before blueSession\.modelRef was published/)
    await ctx.fiber.dispose()
  })
})
