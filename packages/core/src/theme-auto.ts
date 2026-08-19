/**
 * `blue-theme-auto` plugin: follows the terminal's color scheme. Mounts the
 * dark or light built-in palette according to the probed
 * `blueTerminalInfo.background` (`undefined` falls back to dark), then
 * tracks `'blue/terminal-theme-changed'`: when the reported scheme implies
 * the other palette, the current provider sub-fiber is disposed and a fresh
 * one is mounted, so `blueTheme` consumers rebuild through Cordis reload
 * semantics. Duplicate reports are ignored without a remount.
 *
 * @module @dsh-blue/blue-core/theme-auto
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import { defineThemeService } from './theme-palette.ts'
import { DARK_COLORS } from './theme-dark.ts'
import { LIGHT_COLORS } from './theme-light.ts'
// Empty type imports carry the `blueTerminalInfo` Context merge and the
// `blue/terminal-theme-changed` Events merge used below.
import type {} from './terminal-info.ts'
import type {} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-theme-auto'

/** The probed terminal background selects the initial palette. */
export const inject = ['blueTerminalInfo']

const PALETTES = { dark: DARK_COLORS, light: LIGHT_COLORS } as const

/**
 * Provide the scheme-matching built-in palette as `ctx.blueTheme`, swapping
 * the provider whenever the terminal reports a scheme change.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let current: 'dark' | 'light' = ctx.blueTerminalInfo.background ?? 'dark'
  let fiber: Fiber = ctx.plugin(defineThemeService(PALETTES[current]))
  // Swaps serialize through this chain so rapid scheme reports cannot
  // interleave a remount with the previous dispose.
  let swap: Promise<void> = Promise.resolve()
  ctx.on('blue/terminal-theme-changed', (scheme) => {
    if (scheme === current) return
    current = scheme
    swap = swap.then(async () => {
      // Dispose before remounting: Cordis rejects a second `blueTheme`
      // registration while the previous provider is still live.
      await fiber.dispose()
      fiber = ctx.plugin(defineThemeService(PALETTES[scheme]))
      await fiber
    })
    return swap
  })
}
