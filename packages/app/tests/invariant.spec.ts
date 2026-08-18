/** The session-changed commit-point invariant: the broadcast Agent must already be the referenced one. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
    ctx.provide('blueSession', { current: agent })
    expect(() => { ctx.emit('blue/session-changed', agent) }).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('rejects a broadcast that precedes the reference update', async () => {
    const ctx = await setup()
    const agent = { id: 'a1' } as Agent
    ctx.provide('blueSession', { current: null })
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
})
