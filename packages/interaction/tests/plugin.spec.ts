/**
 * REAL-composition test: boot blue-core, the real command runtime and
 * user-questions service, and the blue-interaction plugin through the real
 * Loader from a cordis.yml in a temp directory. Asserts the key batch, the
 * built-in commands, and the user-questions provider register, and that
 * unloading the tree removes every contribution.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as blueCore from '../../core/src/index.ts'
import * as themeDark from '../../core/src/theme-dark.ts'
import { apply } from '../src/index.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'


registerTempDirCleanup()

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).__blueInteractionFixtures
})

/**
 * Boot a real Loader tree with blue-core, commands, user-questions, and
 * blue-interaction. Fixtures re-export the source-plane plugins through
 * globals because the Loader resolves through Node, not tsconfig paths.
 * @returns the root context and the terminal output observed so far.
 */
async function bootInteraction(): Promise<{ ctx: Context; output: () => string }> {
  const dir = mkdtempTracked('dsh-blue-interaction-')
  ;(globalThis as Record<string, unknown>).__blueInteractionFixtures = {
    coreApply: blueCore.apply,
    themeDarkApply: themeDark.apply,
    commands: CommandRuntime,
    userQuestions: UserQuestionService,
    interactionApply: apply,
  }
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: blue-core',
    `  name: ${pathToFileURL(join(dir, 'core.mjs')).href}`,
    // blueTheme moved out of blue-core into the theme-dark subpath plugin;
    // interaction's inject on blueTheme needs this row to activate.
    '- id: blue-theme-dark',
    `  name: ${pathToFileURL(join(dir, 'theme-dark.mjs')).href}`,
    '- id: commands',
    `  name: ${pathToFileURL(join(dir, 'commands.mjs')).href}`,
    '- id: user-questions',
    `  name: ${pathToFileURL(join(dir, 'user-questions.mjs')).href}`,
    '- id: blue-interaction',
    `  name: ${pathToFileURL(join(dir, 'interaction.mjs')).href}`,
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'core.mjs'), `
export const name = 'blue-core'
export const apply = ctx => globalThis.__blueInteractionFixtures.coreApply(ctx)
`)
  writeFileSync(join(dir, 'theme-dark.mjs'), `
export const name = 'blue-theme-dark'
export const apply = ctx => globalThis.__blueInteractionFixtures.themeDarkApply(ctx)
`)
  writeFileSync(join(dir, 'commands.mjs'), `
export default globalThis.__blueInteractionFixtures.commands
`)
  writeFileSync(join(dir, 'user-questions.mjs'), `
export default globalThis.__blueInteractionFixtures.userQuestions
`)
  writeFileSync(join(dir, 'interaction.mjs'), `
export const name = 'blue-interaction'
export const apply = ctx => globalThis.__blueInteractionFixtures.interactionApply(ctx)
`)

  const chunks: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  })

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, output: () => chunks.join('') }
}

/** A bare-agent stand-in for registry lookups (no command execution). */
function lookupAgent(): Agent {
  return { id: 'lookup' } as unknown as Agent
}

describe('blue-interaction through the real Loader', () => {
  it('registers the key batch, the built-in commands, and the questions provider', async () => {
    const { ctx } = await bootInteraction()
    expect(ctx.get('blueKeymap')?.getKeys('blue.interaction.submit')).toEqual(['enter'])
    expect(ctx.get('blueKeymap')?.getKeys('blue.interaction.interrupt')).toEqual(['ctrl+c'])
    expect(ctx.get('blueKeymap')?.getKeys('blue.interaction.steer')).toEqual(['ctrl+s'])
    expect(ctx.commands.find(lookupAgent(), 'quit')).toBeDefined()
    expect(ctx.commands.find(lookupAgent(), 'sessions')).toBeDefined()
    // The provider occupies the single user-questions slot.
    expect(() => ctx.userQuestions.registerProvider({ ask: () => Promise.resolve({ answers: [] }) }))
      .toThrow(/already registered/u)
  })

  it('removes every contribution when the tree unloads', async () => {
    const { ctx, output } = await bootInteraction()
    await ctx.fiber.dispose()
    expect(ctx.get('blueKeymap')?.getKeys('blue.interaction.submit') ?? []).toEqual([])
    expect(ctx.get('blueKeymap')?.getKeys('blue.interaction.interrupt') ?? []).toEqual([])
    expect(ctx.get('commands')).toBeUndefined()
    expect(ctx.get('userQuestions')).toBeUndefined()
    // ProcessTerminal.stop disables bracketed paste on the real stdout.
    expect(output()).toContain('\x1b[?2004l')
  })
})
