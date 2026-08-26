/** The renderer-neutral app companion remains stable and registerable. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BlueAppInvariant from '../src/invariant.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(BlueAppInvariant)
  return ctx
}

describe('blue app invariants', () => {
  it('registers the stable no-op companion', async () => {
    const ctx = await setup()
    const listener = vi.fn()
    ctx.on('blue/session-epoch-changed', listener)
    expect(() => { ctx.emit('blue/session-epoch-changed', 1) }).not.toThrow()
    expect(listener).toHaveBeenCalledWith(1)
    await ctx.fiber.dispose()
  })
})
