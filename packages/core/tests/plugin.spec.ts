/**
 * REAL-composition test: boot the blue-core plugin plus the blue-theme-dark
 * entry through the real Loader from a cordis.yml in a temp directory,
 * asserting the terminal starts, all five services register, the
 * terminal-theme-changed broadcast fires, and unloading restores the
 * terminal and removes the services.
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
import { apply as themeDarkApply } from '../src/theme-dark.ts'

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.restoreAllMocks()
})

/**
 * Boot a real Loader tree whose entries delegate to the source-plane
 * plugins already imported by this test (the Loader imports through Node's
 * resolver, which cannot reach tsconfig paths).
 * @returns the root context and the terminal output observed so far.
 */
async function bootBlueCore(): Promise<{ ctx: Context; output: () => string }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-blue-core-'))
  // The fixtures re-export the real plugins' namespace shape (name + apply)
  // so the Loader exercises the same unwrap path as a packaged install.
  writeFileSync(join(dir, 'blue-core.mjs'), `
export const name = 'blue-core'
export const apply = ctx => globalThis.__blueCoreApply(ctx)
`)
  writeFileSync(join(dir, 'blue-theme-dark.mjs'), `
export const name = 'blue-theme-dark'
export const apply = ctx => globalThis.__blueThemeDarkApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: blue-core',
    `  name: ${pathToFileURL(join(dir, 'blue-core.mjs')).href}`,
    '- id: blue-theme-dark',
    `  name: ${pathToFileURL(join(dir, 'blue-theme-dark.mjs')).href}`,
    '',
  ].join('\n'))
  const globals = globalThis as unknown as {
    __blueCoreApply: typeof apply
    __blueThemeDarkApply: typeof themeDarkApply
  }
  globals.__blueCoreApply = apply
  globals.__blueThemeDarkApply = themeDarkApply

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
  it('starts the terminal and registers the L1 services', async () => {
    const { ctx, output } = await bootBlueCore()
    expect(ctx.get('blueScreen')).toBeDefined()
    expect(ctx.get('blueKeymap')).toBeDefined()
    expect(ctx.get('blueTerminalInfo')).toBeDefined()
    expect(ctx.get('blueComponents')).toBeDefined()
    expect(ctx.get('blueTheme')).toBeDefined()
    // ProcessTerminal.start enables bracketed paste on the real stdout.
    expect(output()).toContain('\x1b[?2004h')
  })

  it('broadcasts blue/terminal-theme-changed when the terminal reports a scheme', async () => {
    const { ctx } = await bootBlueCore()
    const schemes: ('dark' | 'light')[] = []
    ctx.on('blue/terminal-theme-changed', scheme => schemes.push(scheme))
    // Simulate the terminal's mode 2031 report arriving on process stdin.
    process.stdin.emit('data', Buffer.from('\x1b[?997;2n', 'utf8'))
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(schemes).toEqual(['light'])
  })

  it('stops the terminal and removes the services when the tree unloads', async () => {
    const { ctx, output } = await bootBlueCore()
    await ctx.fiber.dispose()
    // TuiBase.stop shows the cursor; ProcessTerminal.stop disables bracketed paste.
    expect(output()).toContain('\x1b[?2004l')
    expect(ctx.get('blueScreen')).toBeUndefined()
    expect(ctx.get('blueKeymap')).toBeUndefined()
    expect(ctx.get('blueTerminalInfo')).toBeUndefined()
    expect(ctx.get('blueComponents')).toBeUndefined()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })
})
