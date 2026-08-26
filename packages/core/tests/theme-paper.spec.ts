/**
 * `blue-theme-paper` plugin entry: registration and disposal on the fiber,
 * and the paper semantic color table (32 tokens) — the warm light palette
 * with its amber logo sweep.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, BlueThemeService, name, PAPER_COLORS } from '../src/theme-paper.ts'
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

describe('blue-theme-paper plugin', () => {
  it('registers as ctx.blueTheme and unregisters when the fiber disposes', async () => {
    expect(name).toBe('blue-theme-paper')
    const ctx = new Context()
    const fiber = ctx.plugin({ name, apply })
    await fiber
    expect(ctx.get('blueTheme')).toBeInstanceOf(BlueThemeService)
    expect(ctx.blueTheme.colors).toBe(PAPER_COLORS)
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
    // text #3b322a → rgb(59, 50, 42)
    expect(colors.text('hi')).toBe('\x1b[38;2;59;50;42mhi\x1b[39m')
    // primary #b4541e → rgb(180, 84, 30)
    expect(colors.primary('hi')).toBe('\x1b[38;2;180;84;30mhi\x1b[39m')
    // accent #0e7a70 → rgb(14, 122, 112)
    expect(colors.accent('hi')).toBe('\x1b[38;2;14;122;112mhi\x1b[39m')
    // roleUser #35509e → rgb(53, 80, 158)
    expect(colors.roleUser('hi')).toBe('\x1b[38;2;53;80;158mhi\x1b[39m')
    // selectedBg #efe6d3 → rgb(239, 230, 211)
    expect(colors.selectedBg('hi')).toBe('\x1b[48;2;239;230;211mhi\x1b[49m')
    // modelHighlight #a04e1a → rgb(160, 78, 26)
    expect(colors.modelHighlight('hi')).toBe('\x1b[38;2;160;78;26mhi\x1b[39m')
  })

  it('carries the amber logo sweep, frozen', async () => {
    const ctx = new Context()
    await ctx.plugin({ name, apply })
    const { logoGradient } = ctx.blueTheme.colors
    expect(logoGradient).toHaveLength(9)
    expect(Object.isFrozen(logoGradient)).toBe(true)
    // #7c3f0e → rgb(124, 63, 14) at the top …
    expect(logoGradient[0]!('hi')).toBe('\x1b[38;2;124;63;14mhi\x1b[39m')
    // … to #f0d0ab → rgb(240, 208, 171) at the tail.
    expect(logoGradient[8]!('hi')).toBe('\x1b[38;2;240;208;171mhi\x1b[39m')
  })
})

