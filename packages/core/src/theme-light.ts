/**
 * `blue-theme-light` plugin: the built-in light palette, providing the
 * `blueTheme` service contract declared in `types.ts`. Ships as a subpath
 * entry so it can replace `blue-theme-dark` fiber-for-fiber in the bundle
 * patch and serve `blue-theme-auto` / `blue-theme-custom` as a base
 * palette. Palette values are tuned for light terminal backgrounds (dark
 * text, muted mid-grays), loosely following GitHub's light primer scale.
 *
 * @module @deepseek-ai/dsh-blue-core/theme-light
 */

import type { Context } from '@deepseek-ai/cordis'
import { colorsFromForegrounds, defineThemeService } from './theme-palette.ts'
import type { BlueSemanticColors } from './types.ts'

const LIGHT_FOREGROUNDS = {
  text: '#1f2328',
  textStrong: '#0a0c10',
  muted: '#6a737d',
  textMuted: '#8c959f',
  accent: '#0a7ea4',
  primary: '#0969da',
  border: '#6e7781',
  borderFocus: '#9a6700',
  success: '#1a7f37',
  error: '#cf222e',
  warning: '#9a6700',
  roleUser: '#953800',
  shellMode: '#8250df',
  mdHeading: '#1f2328',
  mdLink: '#0969da',
  mdLinkUrl: '#8c959f',
  mdCode: '#0969da',
  mdCodeBlock: '#24292f',
  mdCodeBlockBorder: '#8c959f',
  mdQuote: '#6a737d',
  mdQuoteBorder: '#6a737d',
  mdHr: '#6e7781',
  mdListBullet: '#1f2328',
  diffAdded: '#1a7f37',
  diffRemoved: '#cf222e',
  diffAddedStrong: '#116329',
  diffRemovedStrong: '#a40e26',
  diffGutter: '#8c959f',
  diffMeta: '#6a737d',
} as const

const LIGHT_SELECTED_BG = '#d0d7de'

/** The built-in light palette as a frozen semantic color table. */
export const LIGHT_COLORS: BlueSemanticColors = colorsFromForegrounds(LIGHT_FOREGROUNDS, LIGHT_SELECTED_BG)

/**
 * The light `blueTheme` provider. Exposes the frozen semantic color table;
 * unregistered automatically when the plugin's fiber unloads.
 */
export class BlueThemeService extends defineThemeService(LIGHT_COLORS) {}

/** Stable Cordis plugin name. */
export const name = 'blue-theme-light'

/**
 * Provide the built-in light palette as `ctx.blueTheme`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(BlueThemeService)
}
