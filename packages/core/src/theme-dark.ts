/**
 * `blue-theme-dark` plugin: the built-in dark palette, providing the
 * `blueTheme` service contract declared in `types.ts`. Ships as a subpath
 * entry so the composing bundle lists it as its own patch row and other
 * theme plugins (light/auto/custom) can replace it fiber-for-fiber.
 * Palette values follow pi's dark theme so Blue reads consistently next to
 * pi-based tooling.
 *
 * @module @deepseek-ai/dsh-blue-core/theme-dark
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BlueColorFn, BlueSemanticColors, BlueTheme } from './types.ts'

/** Wrap text in a truecolor foreground. */
function foreground(hex: string): BlueColorFn {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return text => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`
}

/** Wrap text in a truecolor background. */
function background(hex: string): BlueColorFn {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return text => `\x1b[48;2;${r};${g};${b}m${text}\x1b[49m`
}

const DARK_FOREGROUNDS = {
  text: '#d4d4d4',
  textStrong: '#ffffff',
  muted: '#808080',
  accent: '#8abeb7',
  border: '#5f87ff',
  borderFocus: '#8abeb7',
  success: '#b5bd68',
  error: '#cc6666',
  warning: '#ffff00',
  roleUser: '#8abeb7',
  shellMode: '#b294bb',
  mdHeading: '#f0c674',
  mdLink: '#81a2be',
  mdLinkUrl: '#666666',
  mdCode: '#8abeb7',
  mdCodeBlock: '#b5bd68',
  mdCodeBlockBorder: '#808080',
  mdQuote: '#808080',
  mdQuoteBorder: '#808080',
  mdHr: '#808080',
  mdListBullet: '#8abeb7',
  diffAdded: '#a1b56c',
  diffRemoved: '#ab4642',
  diffAddedStrong: '#c0d67a',
  diffRemovedStrong: '#d05852',
  diffGutter: '#666666',
  diffMeta: '#808080',
} as const

const DARK_SELECTED_BG = '#3a3a4a'

/** The built-in dark palette as semantic color functions. */
function buildDarkColors(): BlueSemanticColors {
  const foregrounds = Object.fromEntries(
    Object.entries(DARK_FOREGROUNDS).map(([role, hex]) => [role, foreground(hex)]),
  )
  return { ...foregrounds, selectedBg: background(DARK_SELECTED_BG) } as BlueSemanticColors
}

/**
 * The built-in `blueTheme` provider. Exposes the frozen semantic color
 * table; unregistered automatically when the plugin's fiber unloads.
 */
export class BlueThemeService extends Service implements BlueTheme {
  readonly colors: BlueSemanticColors = Object.freeze(buildDarkColors())

  /**
   * Create and register the service.
   * @param ctx - the owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'blueTheme')
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-theme-dark'

/**
 * Provide the built-in dark palette as `ctx.blueTheme`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(BlueThemeService)
}
