/**
 * Registration smoke for the renderer-independent API invariant companion.
 *
 * @module @dsh-blue/blue-api/tests/invariant
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as companion from '../src/invariant.ts'

describe('blue API invariant companion', () => {
  it('mounts and unloads without runtime state', async () => {
    expect(companion.name).toBe('blue-api-invariant')
    const ctx = new Context()
    const fiber = await ctx.plugin(companion)
    await expect(fiber.dispose()).resolves.toBeUndefined()
  })
})
