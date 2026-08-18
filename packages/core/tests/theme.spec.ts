/**
 * `ctx.blueTheme` service: registration and disposal on the fiber, and the
 * built-in dark semantic color table.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BlueThemeService } from '../src/theme.ts'
import type { BlueSemanticColors } from '../src/types.ts'

const EXPECTED_ROLES: (keyof BlueSemanticColors)[] = [
  'text',
  'muted',
  'accent',
  'border',
  'success',
  'error',
  'warning',
  'selectedBg',
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
]

describe('BlueThemeService', () => {
  it('registers as ctx.blueTheme and unregisters when the fiber disposes', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(BlueThemeService)
    await fiber
    expect(ctx.get('blueTheme')).toBeInstanceOf(BlueThemeService)
    await fiber.dispose()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('exposes a frozen table covering every semantic role', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueThemeService)
    const { colors } = ctx.blueTheme
    expect(Object.isFrozen(colors)).toBe(true)
    expect(Object.keys(colors).sort()).toEqual([...EXPECTED_ROLES].sort())
    for (const role of EXPECTED_ROLES) {
      expect(typeof colors[role]).toBe('function')
    }
  })

  it('wraps text in truecolor foreground and background sequences', async () => {
    const ctx = new Context()
    await ctx.plugin(BlueThemeService)
    const { colors } = ctx.blueTheme
    // accent #8abeb7 → rgb(138, 190, 183)
    expect(colors.accent('hi')).toBe('\x1b[38;2;138;190;183mhi\x1b[39m')
    // selectedBg #3a3a4a → rgb(58, 58, 74)
    expect(colors.selectedBg('hi')).toBe('\x1b[48;2;58;58;74mhi\x1b[49m')
  })
})
