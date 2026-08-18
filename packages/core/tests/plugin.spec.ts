/**
 * REAL-composition test: boot the blue-core plugin through the real Loader
 * from a cordis.yml in a temp directory, asserting the terminal starts, the
 * three services register, and unloading restores the terminal and removes
 * the services.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { apply } from '../src/index.ts'

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.restoreAllMocks()
})

/**
 * Boot a real Loader tree whose single entry delegates to the source-plane
 * plugin already imported by this test (the Loader imports through Node's
 * resolver, which cannot reach tsconfig paths).
 * @returns the root context and the terminal output observed so far.
 */
async function bootBlueCore(): Promise<{ ctx: Context; output: () => string }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-blue-core-'))
  // The fixture re-exports the real plugin's namespace shape (name + apply)
  // so the Loader exercises the same unwrap path as a packaged install.
  writeFileSync(join(dir, 'blue-core.mjs'), `
export const name = 'blue-core'
export const apply = ctx => globalThis.__blueCoreApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: blue-core',
    `  name: ${pathToFileURL(join(dir, 'blue-core.mjs')).href}`,
    '',
  ].join('\n'))
  ;(globalThis as unknown as { __blueCoreApply: typeof apply }).__blueCoreApply = apply

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

describe('blue-core plugin through the real Loader', () => {
  it('starts the terminal and registers the three L1 services', async () => {
    const { ctx, output } = await bootBlueCore()
    expect(ctx.get('blueScreen')).toBeDefined()
    expect(ctx.get('blueTheme')).toBeDefined()
    expect(ctx.get('blueKeymap')).toBeDefined()
    // ProcessTerminal.start enables bracketed paste on the real stdout.
    expect(output()).toContain('\x1b[?2004h')
  })

  it('stops the terminal and removes the services when the tree unloads', async () => {
    const { ctx, output } = await bootBlueCore()
    await ctx.fiber.dispose()
    // TuiBase.stop shows the cursor; ProcessTerminal.stop disables bracketed paste.
    expect(output()).toContain('\x1b[?2004l')
    expect(ctx.get('blueScreen')).toBeUndefined()
    expect(ctx.get('blueTheme')).toBeUndefined()
    expect(ctx.get('blueKeymap')).toBeUndefined()
  })
})
