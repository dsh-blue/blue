/**
 * `blue-theme-ocean` plugin: the built-in ocean palette — a blue-tinted
 * dark theme (cool slate text, a luminous sky-blue primary, teal accent)
 * for terminals where the neutral dark reads flat. Ships as a subpath
 * entry so `/theme ocean` can replace `blue-theme-dark` fiber-for-fiber
 * and `blue-theme-custom` can use it as a base palette. The banner logo
 * carries a teal sweep so the mark follows the palette.
 *
 * @module @dsh-blue/blue-core/theme-ocean
 */

import type { Context } from '@deepseek-ai/cordis'
import { colorsFromForegrounds, defineThemeService } from './theme-palette.ts'
import type { BlueSemanticColors } from './types.ts'

const OCEAN_FOREGROUNDS = {
  text: '#d8e4f8',
  textStrong: '#f4f9ff',
  muted: '#7f96bc',
  textMuted: '#5c7499',
  accent: '#35d9ce',
  primary: '#5db4ff',
  border: '#3f5679',
  borderFocus: '#e6b455',
  success: '#42d68c',
  error: '#ff7070',
  warning: '#e6b455',
  roleUser: '#7b95ff',
  shellMode: '#b493ff',
  mdHeading: '#d8e4f8',
  mdLink: '#5db4ff',
  mdLinkUrl: '#5c7499',
  mdCode: '#5db4ff',
  mdCodeBlock: '#d8e4f8',
  mdCodeBlockBorder: '#5c7499',
  mdQuote: '#7f96bc',
  mdQuoteBorder: '#7f96bc',
  mdHr: '#3f5679',
  mdListBullet: '#d8e4f8',
  diffAdded: '#42d68c',
  diffRemoved: '#ff7070',
  diffAddedStrong: '#82efb8',
  diffRemovedStrong: '#ffa3a3',
  diffGutter: '#5c7499',
  diffMeta: '#7f96bc',
  modelHighlight: '#5fd9e8',
} as const

/** The ocean banner logo sweep: deep sea teal up top to pale lagoon at the tail. */
const OCEAN_LOGO_GRADIENT = [
  '#0e5f73', '#0b7c92', '#0891b2', '#0aa8c9', '#12bede',
  '#2ed3ea', '#52e2f2', '#7cecf6', '#a8f4fa',
] as const

const OCEAN_SELECTED_BG = '#22406b'

/** The built-in ocean palette as a frozen semantic color table. */
export const OCEAN_COLORS: BlueSemanticColors = colorsFromForegrounds(OCEAN_FOREGROUNDS, OCEAN_SELECTED_BG, OCEAN_LOGO_GRADIENT)

/**
 * The ocean `blueTheme` provider. Exposes the frozen semantic color table;
 * unregistered automatically when the plugin's fiber unloads.
 */
export class BlueThemeService extends defineThemeService(OCEAN_COLORS) {}

/** Stable Cordis plugin name. */
export const name = 'blue-theme-ocean'

/**
 * Provide the ocean palette as `ctx.blueTheme`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(BlueThemeService)
}
