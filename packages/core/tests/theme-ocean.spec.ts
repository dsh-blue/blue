/**
 * `blue-theme-ocean` plugin entry: registration and disposal on the fiber,
 * and the ocean semantic color table (32 tokens) — the blue-tinted dark
 * palette with its teal logo sweep.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, BlueThemeService, name, OCEAN_COLORS } from '../src/theme-ocean.ts'
import type { BlueSemanticColors } from '../src/types.ts'

const EXPECTED_ROLES: (keyof BlueSemanticColors)[] = [
  'text',
  'textStrong',
  'muted',
  'textMuted',
  'accent',
  'primary',
  'border',
  'borderFocus',
  'success',
  'error',
  'warning',
  'selectedBg',
  'roleUser',
  'shellMode',
  'mdHeading',
  'mdLink',
  'mdLinkUrl',
  'mdCode',
  'mdCodeBlock',
  'mdCodeBlockBorder',
  'mdQuote',
  'mdQuoteBorder',
  'mdHr',
  'mdListBullet',
  'diffAdded',
  'diffRemoved',
  'diffAddedStrong',
  'diffRemovedStrong',
  'diffGutter',
  'diffMeta',
  'modelHighlight',
  'logoGradient',
]

describe('blue-theme-ocean plugin', () => {
  it('registers as ctx.blueTheme and unregisters when the fiber disposes', async () => {
    expect(name).toBe('blue-theme-ocean')
    const ctx = new Context()
    const fiber = ctx.plugin({ name, apply })
    await fiber
    expect(ctx.get('blueTheme')).toBeInstanceOf(BlueThemeService)
    expect(ctx.blueTheme.colors).toBe(OCEAN_COLORS)
    await fiber.dispose()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('exposes a frozen table covering every semantic role', async () => {
    const ctx = new Context()
    await ctx.plugin({ name, apply })
    const { colors } = ctx.blueTheme
    expect(Object.isFrozen(colors)).toBe(true)
    expect(Object.keys(colors).sort()).toEqual([...EXPECTED_ROLES].sort())
    for (const role of EXPECTED_ROLES) {
      if (role === 'logoGradient') {
        expect(colors.logoGradient.every(entry => typeof entry === 'function')).toBe(true)
      } else {
        expect(typeof colors[role]).toBe('function')
      }
    }
  })

  it('wraps text in truecolor foreground and background sequences', async () => {
    const ctx = new Context()
    await ctx.plugin({ name, apply })
    const { colors } = ctx.blueTheme
    // text #d8e4f8 → rgb(216, 228, 248)
    expect(colors.text('hi')).toBe('\x1b[38;2;216;228;248mhi\x1b[39m')
    // primary #5db4ff → rgb(93, 180, 255)
    expect(colors.primary('hi')).toBe('\x1b[38;2;93;180;255mhi\x1b[39m')
    // accent #35d9ce → rgb(53, 217, 206)
    expect(colors.accent('hi')).toBe('\x1b[38;2;53;217;206mhi\x1b[39m')
    // textMuted #5c7499 → rgb(92, 116, 153)
    expect(colors.textMuted('hi')).toBe('\x1b[38;2;92;116;153mhi\x1b[39m')
    // selectedBg #22406b → rgb(34, 64, 107)
    expect(colors.selectedBg('hi')).toBe('\x1b[48;2;34;64;107mhi\x1b[49m')
    // modelHighlight #5fd9e8 → rgb(95, 217, 232)
    expect(colors.modelHighlight('hi')).toBe('\x1b[38;2;95;217;232mhi\x1b[39m')
  })

  it('carries the teal logo sweep, frozen', async () => {
    const ctx = new Context()
    await ctx.plugin({ name, apply })
    const { logoGradient } = ctx.blueTheme.colors
    expect(logoGradient).toHaveLength(9)
    expect(Object.isFrozen(logoGradient)).toBe(true)
    // #0e5f73 → rgb(14, 95, 115) at the top …
    expect(logoGradient[0]!('hi')).toBe('\x1b[38;2;14;95;115mhi\x1b[39m')
    // … to #a8f4fa → rgb(168, 244, 250) at the tail.
    expect(logoGradient[8]!('hi')).toBe('\x1b[38;2;168;244;250mhi\x1b[39m')
  })
})
