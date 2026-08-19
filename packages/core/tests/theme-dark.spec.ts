/**
 * `blue-theme-dark` plugin entry: registration and disposal on the fiber,
 * and the built-in dark semantic color table (28 tokens).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, BlueThemeService, name } from '../src/theme-dark.ts'
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
]

describe('blue-theme-dark plugin', () => {
  it('registers as ctx.blueTheme and unregisters when the fiber disposes', async () => {
    expect(name).toBe('blue-theme-dark')
    const ctx = new Context()
    const fiber = ctx.plugin({ name, apply })
    await fiber
    expect(ctx.get('blueTheme')).toBeInstanceOf(BlueThemeService)
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
      expect(typeof colors[role]).toBe('function')
    }
  })

  it('wraps text in truecolor foreground and background sequences', async () => {
    const ctx = new Context()
    await ctx.plugin({ name, apply })
    const { colors } = ctx.blueTheme
    // accent #8abeb7 → rgb(138, 190, 183)
    expect(colors.accent('hi')).toBe('\x1b[38;2;138;190;183mhi\x1b[39m')
    // primary #5f87ff → rgb(95, 135, 255)
    expect(colors.primary('hi')).toBe('\x1b[38;2;95;135;255mhi\x1b[39m')
    // textMuted #666666 → rgb(102, 102, 102)
    expect(colors.textMuted('hi')).toBe('\x1b[38;2;102;102;102mhi\x1b[39m')
    // selectedBg #3a3a4a → rgb(58, 58, 74)
    expect(colors.selectedBg('hi')).toBe('\x1b[48;2;58;58;74mhi\x1b[49m')
    // shellMode #b294bb → rgb(178, 148, 187)
    expect(colors.shellMode('hi')).toBe('\x1b[38;2;178;148;187mhi\x1b[39m')
  })
})
