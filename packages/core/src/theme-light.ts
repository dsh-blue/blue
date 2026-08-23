/**
 * `blue-theme-light` plugin: the built-in light palette, providing the
 * `blueTheme` service contract declared in `types.ts`. Ships as a subpath
 * entry so it can replace `blue-theme-dark` fiber-for-fiber in the bundle
 * patch and serve `blue-theme-auto` / `blue-theme-custom` as a base
 * palette. Palette values are tuned for light terminal backgrounds in the
 * GitHub primer family but one tier deeper than the primer's second grays
 * (gray-700/gray-600, not gray-600/gray-500) — the first cut was measured
 * too pale on a real light terminal — and the selection background leans
 * blue so the interactive state reads as brand, not as chrome.
 *
 * @module @dsh-blue/blue-core/theme-light
 */

import type { Context } from '@deepseek-ai/cordis'
import { colorsFromForegrounds, defineThemeService } from './theme-palette.ts'
import type { BlueSemanticColors } from './types.ts'

const LIGHT_FOREGROUNDS = {
  text: '#1f2328',
  textStrong: '#0a0c10',
  muted: '#57606a',
  textMuted: '#6e7781',
  accent: '#0b7285',
  primary: '#0969da',
  border: '#57606a',
  borderFocus: '#9a6700',
  success: '#1a7f37',
  error: '#cf222e',
  warning: '#9a6700',
  roleUser: '#1f3ec2',
  shellMode: '#8250df',
  mdHeading: '#1f2328',
  mdLink: '#0969da',
  mdLinkUrl: '#6e7781',
  mdCode: '#0969da',
  mdCodeBlock: '#24292f',
  mdCodeBlockBorder: '#6e7781',
  mdQuote: '#57606a',
  mdQuoteBorder: '#57606a',
  mdHr: '#6e7781',
  mdListBullet: '#1f2328',
  diffAdded: '#1a7f37',
  diffRemoved: '#cf222e',
  diffAddedStrong: '#116329',
  diffRemovedStrong: '#a40e26',
  diffGutter: '#6e7781',
  diffMeta: '#57606a',
  modelHighlight: '#1d4fd7',
} as const

/** The light banner logo sweep: deep navy up top so the mark holds on a light background. */
const LIGHT_LOGO_GRADIENT = [
  '#0a2c6b', '#103581', '#164097', '#1d4ba9', '#2557bb',
  '#2f66cd', '#3d77dd', '#4f8ae8', '#63a0f2',
] as const

const LIGHT_SELECTED_BG = '#cfe0ff'

/** The built-in light palette as a frozen semantic color table. */
export const LIGHT_COLORS: BlueSemanticColors = colorsFromForegrounds(LIGHT_FOREGROUNDS, LIGHT_SELECTED_BG, LIGHT_LOGO_GRADIENT)

/**
 * The light `blueTheme` provider. Exposes the frozen semantic color table;
 * unregistered automatically when the plugin's fiber unloads.
 */
export class BlueThemeService extends defineThemeService(LIGHT_COLORS) {}

/** Stable Cordis plugin name. */
export const name = 'blue-theme-light'

/**
 * Provide the light palette as `ctx.blueTheme`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(BlueThemeService)
}
