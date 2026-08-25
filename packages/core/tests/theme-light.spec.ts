/**
 * `blue-theme-light` plugin entry: registration and disposal on the fiber,
 * and the built-in light semantic color table (28 tokens).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, BlueThemeService, LIGHT_COLORS, name } from '../src/theme-light.ts'
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

describe('blue-theme-light plugin', () => {
  it('registers as ctx.blueTheme and unregisters when the fiber disposes', async () => {
    expect(name).toBe('blue-theme-light')
    const ctx = new Context()
    const fiber = ctx.plugin({ name, apply })
    await fiber
    expect(ctx.get('blueTheme')).toBeInstanceOf(BlueThemeService)
    expect(ctx.blueTheme.colors).toBe(LIGHT_COLORS)
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
    // text #1f2328 → rgb(31, 35, 40)
    expect(colors.text('hi')).toBe('\x1b[38;2;31;35;40mhi\x1b[39m')
    // primary #0969da → rgb(9, 105, 218)
    expect(colors.primary('hi')).toBe('\x1b[38;2;9;105;218mhi\x1b[39m')
    // textMuted #8c959f → rgb(140, 149, 159)
    expect(colors.textMuted('hi')).toBe('\x1b[38;2;140;149;159mhi\x1b[39m')
    // roleUser #2e3fb8 → rgb(46, 63, 184)
    expect(colors.roleUser('hi')).toBe('\x1b[38;2;46;63;184mhi\x1b[39m')
    // mdHeading #1f2328 → rgb(31, 35, 40)
    expect(colors.mdHeading('hi')).toBe('\x1b[38;2;31;35;40mhi\x1b[39m')
    // selectedBg #d0d7de → rgb(208, 215, 222)
    expect(colors.selectedBg('hi')).toBe('\x1b[48;2;208;215;222mhi\x1b[49m')
  })
})
