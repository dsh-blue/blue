/**
 * `blue-theme-dark` plugin: the built-in dark palette, providing the
 * `blueTheme` service contract declared in `types.ts`. Ships as a subpath
 * entry so the composing bundle lists it as its own patch row and other
 * theme plugins (light/auto/custom) can replace it fiber-for-fiber.
 * Palette values follow pi's dark theme so Blue reads consistently next to
 * pi-based tooling. The palette construction lives in `theme-palette.ts`,
 * shared with the rest of the theme plugin family.
 *
 * @module @deepseek-ai/dsh-blue-core/theme-dark
 */

import type { Context } from '@deepseek-ai/cordis'
import { colorsFromForegrounds, defineThemeService } from './theme-palette.ts'
import type { BlueSemanticColors } from './types.ts'

const DARK_FOREGROUNDS = {
  text: '#d4d4d4',
  textStrong: '#ffffff',
  muted: '#808080',
  textMuted: '#666666',
  accent: '#8abeb7',
  primary: '#5f87ff',
  border: '#4a5468',
  borderFocus: '#de935f',
  success: '#b5bd68',
  error: '#cc6666',
  warning: '#de935f',
  roleUser: '#f0c674',
  shellMode: '#b294bb',
  mdHeading: '#d4d4d4',
  mdLink: '#5f87ff',
  mdLinkUrl: '#666666',
  mdCode: '#5f87ff',
  mdCodeBlock: '#d4d4d4',
  mdCodeBlockBorder: '#666666',
  mdQuote: '#808080',
  mdQuoteBorder: '#808080',
  mdHr: '#4a5468',
  mdListBullet: '#d4d4d4',
  diffAdded: '#a1b56c',
  diffRemoved: '#ab4642',
  diffAddedStrong: '#c0d67a',
  diffRemovedStrong: '#d05852',
  diffGutter: '#666666',
  diffMeta: '#808080',
} as const

const DARK_SELECTED_BG = '#3a3a4a'

/** The built-in dark palette as a frozen semantic color table. */
export const DARK_COLORS: BlueSemanticColors = colorsFromForegrounds(DARK_FOREGROUNDS, DARK_SELECTED_BG)

/**
 * The built-in `blueTheme` provider. Exposes the frozen semantic color
 * table; unregistered automatically when the plugin's fiber unloads.
 */
export class BlueThemeService extends defineThemeService(DARK_COLORS) {}

/** Stable Cordis plugin name. */
export const name = 'blue-theme-dark'

/**
 * Provide the built-in dark palette as `ctx.blueTheme`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(BlueThemeService)
}
