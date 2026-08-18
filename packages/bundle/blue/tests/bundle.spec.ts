/**
 * The Blue bundle module: it mounts nothing itself (every Blue row is inserted
 * by cordis.patch.yml) and its invariant companion registers with a justified
 * empty installer.
 */

import { describe, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as bundle from '../src/index.ts'
import * as BundleInvariant from '../src/invariant.ts'

describe('blue bundle', () => {
  it('mounts and disposes cleanly, registering nothing of its own', async () => {
    const ctx = new Context()
    await ctx.plugin(bundle)
    await ctx.fiber.dispose()
  })

  it('registers its invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BundleInvariant)
    await ctx.fiber.dispose()
  })
})
