/**
 * Trusted shell facts for the profile-installed Blue plugin author command.
 *
 * @module @dsh-blue/blue-interaction/author-command-environment-tests
 */

import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as shellEnv from '@deepseek-ai/dsh-shell-env'
import { describe, expect, it } from 'vitest'
import * as authorCommandEnvironment from '../src/author-command-environment.ts'

const require = createRequire(import.meta.url)

describe('blue plugin author command environment', () => {
  it('publishes absolute installed command facts and retracts them on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(shellEnv, { dshHome: '/tmp/blue-author-env-home' })
    const fiber = await ctx.plugin(authorCommandEnvironment)
    const expectedBin = join(dirname(require.resolve('@dsh-blue/blue-plugin-kit/package.json')), 'lib', 'bin.js')

    expect(ctx.shellEnv.list().filter(value => value.contributor === 'blue-plugin-author-command'))
      .toEqual([
        {
          contributor: 'blue-plugin-author-command',
          description: 'Absolute JavaScript entry for the installed Blue plugin author command.',
          key: authorCommandEnvironment.BLUE_PLUGIN_BIN_ENV,
        },
        {
          contributor: 'blue-plugin-author-command',
          description: 'Absolute Node.js executable for the installed Blue plugin author command.',
          key: authorCommandEnvironment.BLUE_PLUGIN_NODE_ENV,
        },
      ])
    const collected = ctx.shellEnv.collect({} as never)
    expect(collected).toMatchObject({
      [authorCommandEnvironment.BLUE_PLUGIN_NODE_ENV]: process.execPath,
      [authorCommandEnvironment.BLUE_PLUGIN_BIN_ENV]: expectedBin,
    })
    expect(isAbsolute(collected[authorCommandEnvironment.BLUE_PLUGIN_NODE_ENV]!)).toBe(true)
    expect(isAbsolute(collected[authorCommandEnvironment.BLUE_PLUGIN_BIN_ENV]!)).toBe(true)

    await fiber.dispose()
    expect(ctx.shellEnv.list().some(value => value.contributor === 'blue-plugin-author-command')).toBe(false)
    await ctx.fiber.dispose()
  })
})
