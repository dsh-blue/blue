/**
 * `blue-theme-dark` plugin: the built-in dark palette, providing the
 * `blueTheme` service contract declared in `types.ts`. Ships as a subpath
 * entry so the composing bundle lists it as its own patch row and other
 * theme plugins (light/auto/custom) can replace it fiber-for-fiber.
 * Palette values follow pi's dark theme so Blue reads consistently next to
 * pi-based tooling. The palette construction lives in `theme-palette.ts`,
 * shared with the rest of the theme plugin family.
 *
 * @module @dsh-blue/blue-core/theme-dark
 */

import type { Context } from '@deepseek-ai/cordis'
import { colorsFromForegrounds, defineThemeService } from './theme-palette.ts'
import type { BlueSemanticColors } from './types.ts'

const DARK_FOREGROUNDS = {
  text: '#e0e0e0',
  textStrong: '#ffffff',
  muted: '#888888',
  textMuted: '#6b6b6b',
  accent: '#5bc0be',
  primary: '#4fa8ff',
  border: '#5a5a5a',
  borderFocus: '#e8a838',
  success: '#4ec87e',
  error: '#e85454',
  warning: '#e8a838',
  roleUser: '#ffcb6b',
  shellMode: '#bd93f9',
  mdHeading: '#e0e0e0',
  mdLink: '#4fa8ff',
  mdLinkUrl: '#6b6b6b',
  mdCode: '#4fa8ff',
  mdCodeBlock: '#e0e0e0',
  mdCodeBlockBorder: '#6b6b6b',
  mdQuote: '#888888',
  mdQuoteBorder: '#888888',
  mdHr: '#5a5a5a',
  mdListBullet: '#e0e0e0',
  diffAdded: '#4ec87e',
  diffRemoved: '#e85454',
  diffAddedStrong: '#7ad99b',
  diffRemovedStrong: '#f08585',
  diffGutter: '#6b6b6b',
  diffMeta: '#888888',
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
