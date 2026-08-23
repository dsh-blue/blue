/**
 * `blue-theme-light` plugin entry: registration and disposal on the fiber,
 * and the remade light semantic color table (32 tokens) — one gray tier
 * deeper than GitHub's primer so the palette reads crisp, not pale.
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
  'modelHighlight',
  'logoGradient',
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
    // text #1f2328 → rgb(31, 35, 40)
    expect(colors.text('hi')).toBe('\x1b[38;2;31;35;40mhi\x1b[39m')
    // primary #0969da → rgb(9, 105, 218)
    expect(colors.primary('hi')).toBe('\x1b[38;2;9;105;218mhi\x1b[39m')
    // muted #57606a → rgb(87, 96, 106) — gray-700, not the primer's gray-600
    expect(colors.muted('hi')).toBe('\x1b[38;2;87;96;106mhi\x1b[39m')
    // textMuted #6e7781 → rgb(110, 119, 129) — gray-600, not gray-500
    expect(colors.textMuted('hi')).toBe('\x1b[38;2;110;119;129mhi\x1b[39m')
    // roleUser #1f3ec2 → rgb(31, 62, 194)
    expect(colors.roleUser('hi')).toBe('\x1b[38;2;31;62;194mhi\x1b[39m')
    // mdHeading #1f2328 → rgb(31, 35, 40)
    expect(colors.mdHeading('hi')).toBe('\x1b[38;2;31;35;40mhi\x1b[39m')
    // selectedBg #cfe0ff → rgb(207, 224, 255) — the blue-leaning selection
    expect(colors.selectedBg('hi')).toBe('\x1b[48;2;207;224;255mhi\x1b[49m')
    // modelHighlight #1d4fd7 → rgb(29, 79, 215)
    expect(colors.modelHighlight('hi')).toBe('\x1b[38;2;29;79;215mhi\x1b[39m')
  })

  it('carries the deep-navy logo sweep, frozen', async () => {
    const ctx = new Context()
    await ctx.plugin({ name, apply })
    const { logoGradient } = ctx.blueTheme.colors
    expect(logoGradient).toHaveLength(9)
    expect(Object.isFrozen(logoGradient)).toBe(true)
    // #0a2c6b → rgb(10, 44, 107) at the top …
    expect(logoGradient[0]!('hi')).toBe('\x1b[38;2;10;44;107mhi\x1b[39m')
    // … to #63a0f2 → rgb(99, 160, 242) at the tail.
    expect(logoGradient[8]!('hi')).toBe('\x1b[38;2;99;160;242mhi\x1b[39m')
  })
})
