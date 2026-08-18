/**
 * Registration test for the package's invariant companion: it installs
 * under the real invariant registry and disposes cleanly.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as companion from '../src/invariant.ts'

describe('blue-interaction invariant companion', () => {
  it('registers and unregisters with the invariant registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = await ctx.plugin(companion)
    expect(ctx.get('invariants')).toBeDefined()
    await expect(fiber.dispose()).resolves.toBeUndefined()
  })
})
