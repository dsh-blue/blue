/**
 * `blue-theme-custom` plugin entry: JSON palette files layered over the
 * built-in base palettes, with per-token and whole-file fallback behavior.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DARK_COLORS } from '../src/theme-dark.ts'
import { LIGHT_COLORS } from '../src/theme-light.ts'
import { OCEAN_COLORS } from '../src/theme-ocean.ts'
import { PAPER_COLORS } from '../src/theme-paper.ts'
import { apply, Config, name } from '../src/theme-custom.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'blue-theme-custom-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * Register an exporter collecting the plugin's warnings; Cordis's built-in
 * buffer exporter filters at INFO level, which drops warnings. Register
 * before mounting so the mount-time warnings are captured.
 */
function recordWarnings(ctx: Context): string[] {
  const messages: string[] = []
  ctx.logger.exporter({
    levels: { default: 3 },
    export: (message) => {
      if (message.type === 'warn') messages.push(String(message.args[0]))
    },
  })
  return messages
}

/** Write a palette file and mount the plugin against it. */
async function mount(
  ctx: Context,
  content: string | undefined,
  base?: 'dark' | 'light' | 'ocean' | 'paper',
) {
  const path = join(dir, 'theme.json')
  if (content !== undefined) await writeFile(path, content)
  const fiber = ctx.plugin({ name, Config, apply }, base === undefined ? { path } : { path, base })
  await fiber
  return fiber
}

describe('blue-theme-custom plugin', () => {
  it('registers the file-defined palette and unregisters when the fiber disposes', async () => {
    expect(name).toBe('blue-theme-custom')
    const ctx = new Context()
    const fiber = await mount(ctx, JSON.stringify({ text: '#112233', selectedBg: '#445566' }))
    const theme = ctx.get('blueTheme')
    expect(theme).toBeDefined()
    expect(Object.isFrozen(theme!.colors)).toBe(true)
    expect(Object.keys(theme!.colors).sort()).toEqual(Object.keys(DARK_COLORS).sort())
    // text #112233 → rgb(17, 34, 51); selectedBg #445566 → rgb(68, 85, 102)
    expect(theme!.colors.text('hi')).toBe('\x1b[38;2;17;34;51mhi\x1b[39m')
    expect(theme!.colors.selectedBg('hi')).toBe('\x1b[48;2;68;85;102mhi\x1b[49m')
    // Untouched tokens fall back to the dark base (the Config default).
    expect(theme!.colors.muted).toBe(DARK_COLORS.muted)
    await fiber.dispose()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('layers overrides over the light base when configured', async () => {
    const ctx = new Context()
    await mount(ctx, JSON.stringify({ accent: '#112233' }), 'light')
    const { colors } = ctx.blueTheme
    expect(colors.accent('hi')).toBe('\x1b[38;2;17;34;51mhi\x1b[39m')
    expect(colors.muted).toBe(LIGHT_COLORS.muted)
  })

  it('drops invalid entries and falls back to the base palette entry', async () => {
    const ctx = new Context()
    const warns = recordWarnings(ctx)
    await mount(ctx, JSON.stringify({ text: 'red', accent: 123, roleUser: '#0a7ea4' }))
    const { colors } = ctx.blueTheme
    expect(colors.text).toBe(DARK_COLORS.text)
    expect(colors.accent).toBe(DARK_COLORS.accent)
    expect(colors.roleUser('hi')).toBe('\x1b[38;2;10;126;164mhi\x1b[39m')
    expect(warns).toHaveLength(2)
  })

  it('ignores unknown token names with a warning', async () => {
    const ctx = new Context()
    const warns = recordWarnings(ctx)
    await mount(ctx, JSON.stringify({ nope: '#112233' }))
    const { colors } = ctx.blueTheme
    for (const role of Object.keys(DARK_COLORS) as (keyof typeof DARK_COLORS)[]) {
      expect(colors[role]).toBe(DARK_COLORS[role])
    }
    expect(warns).toHaveLength(1)
  })

  it('layers the array-valued logoGradient and the modelHighlight hex', async () => {
    const ctx = new Context()
    await mount(ctx, JSON.stringify({
      modelHighlight: '#123456',
      logoGradient: ['#100000', '#200000'],
    }))
    const { colors } = ctx.blueTheme
    // modelHighlight #123456 → rgb(18, 52, 86)
    expect(colors.modelHighlight('hi')).toBe('\x1b[38;2;18;52;86mhi\x1b[39m')
    expect(colors.logoGradient).toHaveLength(2)
    // #100000 → rgb(16, 0, 0); #200000 → rgb(32, 0, 0)
    expect(colors.logoGradient[0]!('hi')).toBe('\x1b[38;2;16;0;0mhi\x1b[39m')
    expect(colors.logoGradient[1]!('hi')).toBe('\x1b[38;2;32;0;0mhi\x1b[39m')
    expect(Object.isFrozen(colors.logoGradient)).toBe(true)
    // Untouched tokens keep the dark base.
    expect(colors.muted).toBe(DARK_COLORS.muted)
  })

  it.each([
    ['with a non-hex entry', ['#100000', 'nope']],
    ['when empty', []],
    ['when not an array', '#100000'],
  ])('falls back to the base logoGradient %s', async (_label, gradient) => {
    const ctx = new Context()
    const warns = recordWarnings(ctx)
    await mount(ctx, JSON.stringify({ logoGradient: gradient }))
    expect(ctx.blueTheme.colors.logoGradient).toBe(DARK_COLORS.logoGradient)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('invalid gradient')
  })

  it.each([
    ['ocean', OCEAN_COLORS, '#112233'],
    ['paper', PAPER_COLORS, '#112233'],
  ] as const)('layers overrides over the %s base when configured', async (base, palette) => {
    const ctx = new Context()
    await mount(ctx, JSON.stringify({ accent: '#112233' }), base)
    const { colors } = ctx.blueTheme
    expect(colors.accent('hi')).toBe('\x1b[38;2;17;34;51mhi\x1b[39m')
    expect(colors.muted).toBe(palette.muted)
    expect(colors.logoGradient).toBe(palette.logoGradient)
  })

  it('falls back to the whole base palette when the file is unreadable', async () => {
    const ctx = new Context()
    const warns = recordWarnings(ctx)
    await mount(ctx, undefined)
    expect(ctx.get('blueTheme')?.colors).toBe(DARK_COLORS)
    expect(warns).toHaveLength(1)
  })

  it('falls back to the whole base palette when the file is not valid JSON', async () => {
    const ctx = new Context()
    const warns = recordWarnings(ctx)
    await mount(ctx, '{ not json')
    expect(ctx.get('blueTheme')?.colors).toBe(DARK_COLORS)
    expect(warns).toHaveLength(1)
  })

  it.each(['"just a string"', 'null', '[]'])(
    'falls back to the whole base palette when the file is %s',
    async (content) => {
      const ctx = new Context()
      const warns = recordWarnings(ctx)
      await mount(ctx, content)
      expect(ctx.get('blueTheme')?.colors).toBe(DARK_COLORS)
      expect(warns).toHaveLength(1)
    },
  )
})
