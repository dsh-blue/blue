/**
 * `blue-theme-auto` plugin entry: initial palette selection from the probed
 * terminal background and provider swaps on `'blue/terminal-theme-changed'`.
 * `blueTerminalInfo` is faked with the real `BlueTerminalInfoService`.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlueTerminalInfoService } from '../src/terminal-info.ts'
import { DARK_COLORS } from '../src/theme-dark.ts'
import { LIGHT_COLORS } from '../src/theme-light.ts'
import { apply, inject, name } from '../src/theme-auto.ts'

/** Mount the fake terminal facts, then the auto theme plugin. */
async function mount(ctx: Context, background: 'dark' | 'light' | undefined) {
  await ctx.plugin(BlueTerminalInfoService, { background, kittyKeyboard: false })
  const fiber = ctx.plugin({ name, inject, apply })
  await fiber
  return fiber
}

describe('blue-theme-auto plugin', () => {
  it('exposes its inject declaration and stable name', () => {
    expect(name).toBe('blue-theme-auto')
    expect(inject).toEqual(['blueTerminalInfo'])
  })

  it('mounts the dark palette for a dark terminal and unregisters with the fiber', async () => {
    const ctx = new Context()
    const fiber = await mount(ctx, 'dark')
    expect(ctx.get('blueTheme')?.colors).toBe(DARK_COLORS)
    await fiber.dispose()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('mounts the light palette for a light terminal', async () => {
    const ctx = new Context()
    await mount(ctx, 'light')
    expect(ctx.get('blueTheme')?.colors).toBe(LIGHT_COLORS)
  })

  it('falls back to the dark palette when the background probe failed', async () => {
    const ctx = new Context()
    await mount(ctx, undefined)
    expect(ctx.get('blueTheme')?.colors).toBe(DARK_COLORS)
  })

  it('swaps the provider when the terminal reports a scheme change', async () => {
    const ctx = new Context()
    await mount(ctx, 'dark')
    // Count dependent reloads: remounting `blueTheme` unloads and re-runs
    // every plugin injecting it through Cordis reload semantics.
    let reloads = 0
    await ctx.plugin({ name: 'theme-watcher', inject: ['blueTheme'], apply: () => {
      reloads++
    } })
    reloads = 0
    await ctx.parallel('blue/terminal-theme-changed', 'light')
    expect(ctx.get('blueTheme')?.colors).toBe(LIGHT_COLORS)
    expect(reloads).toBe(1)
    // A repeated report of the active scheme keeps the mounted provider.
    ctx.emit('blue/terminal-theme-changed', 'light')
    await Promise.resolve()
    expect(ctx.get('blueTheme')?.colors).toBe(LIGHT_COLORS)
    expect(reloads).toBe(1)
    // The chain supports swapping back and forth.
    await ctx.parallel('blue/terminal-theme-changed', 'dark')
    expect(ctx.get('blueTheme')?.colors).toBe(DARK_COLORS)
    await ctx.parallel('blue/terminal-theme-changed', 'light')
    expect(ctx.get('blueTheme')?.colors).toBe(LIGHT_COLORS)
    expect(reloads).toBe(3)
  })
})
