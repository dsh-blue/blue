/**
 * The Blue app's command-line provider over a real Loader tree: the optional
 * task and `--resume` become injected driver config, while help and parse
 * errors leave the consumer pending.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, BLUE_STARTUP_SERVICE, type BlueStartupValues } from '../src/startup.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'


registerTempDirCleanup()

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  driverConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

/**
 * Mount the real provider over a driver stand-in.
 * @param args - the invocation's inner arguments.
 * @returns the resolved service value and observed driver/process effects.
 */
async function bootStartup(args: string[]): Promise<{ startup: BlueStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempTracked('dsh-blue-startup-')
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__blueStartupObserved.driverConfig = config }\n')
  // Loader imports through Node's resolver, so this fixture delegates to the
  // source-plane plugin already imported by the test.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'blue-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__blueStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: blue-app',
    `  name: ${rowUrl}`,
    `  inject: [${BLUE_STARTUP_SERVICE}]`,
    '  config:',
    '    task: !!js ctx.blueStartup.task',
    '    resume: !!js ctx.blueStartup.resume',
    '- id: blue-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __blueStartupApply: typeof apply
    __blueStartupObserved: Observed
  }
  globals.__blueStartupApply = apply
  globals.__blueStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    startup: ctx.get(BLUE_STARTUP_SERVICE) as BlueStartupValues | undefined,
    observed,
  }
}

describe('blue command-line provider', () => {
  it('joins the task positional into the driver config', async () => {
    const { startup, observed } = await bootStartup(['fix', 'the', 'build'])
    expect(startup).toEqual({ task: 'fix the build' })
    expect(observed.driverConfig).toEqual({ task: 'fix the build' })
    expect(observed.exits).toEqual([])
  })

  it('carries --resume alongside the task', async () => {
    const { startup, observed } = await bootStartup(['--resume', 'abc123', 'continue', 'it'])
    expect(startup).toEqual({ task: 'continue it', resume: 'abc123' })
    expect(observed.driverConfig).toEqual({ task: 'continue it', resume: 'abc123' })
    expect(observed.exits).toEqual([])
  })

  it('publishes empty launch values for a bare interactive invocation', async () => {
    const { startup, observed } = await bootStartup([])
    expect(startup).toEqual({})
    expect(observed.driverConfig).toEqual({})
    expect(observed.exits).toEqual([])
  })

  it('treats a whitespace-only task as absent', async () => {
    const { startup } = await bootStartup(['   '])
    expect(startup).toEqual({})
  })

  it('prints its own help and leaves the driver pending', async () => {
    const { startup, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('dsh --profile blue')
    expect(startup).toBeUndefined()
    expect(observed.driverConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rebrands help to the blue shell when BLUE_LAUNCHER marks it (S37)', async () => {
    process.env.BLUE_LAUNCHER = 'blue'
    try {
      const { observed } = await bootStartup(['--help'])
      expect(observed.out).toContain('blue "fix the build"')
      expect(observed.out).not.toContain('dsh --profile blue')
    } finally {
      delete process.env.BLUE_LAUNCHER
    }
  })

  it('rejects an unknown option and leaves the driver pending', async () => {
    const { startup, observed } = await bootStartup(['--bogus'])
    expect(observed.out).toContain('unknown option')
    expect(startup).toBeUndefined()
    expect(observed.driverConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})
