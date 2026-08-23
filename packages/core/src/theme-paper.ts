/**
 * `blue-theme-paper` plugin: the built-in paper palette — a warm light
 * theme (ink-brown text on an implied cream background, a burnt-orange
 * primary against an ink-teal accent) for light terminals where the cool
 * GitHub-family grays feel sterile. Ships as a subpath entry so
 * `/theme paper` can replace `blue-theme-dark` fiber-for-fiber and
 * `blue-theme-custom` can use it as a base palette. The banner logo
 * carries an amber sweep so the mark follows the palette.
 *
 * @module @dsh-blue/blue-core/theme-paper
 */

import type { Context } from '@deepseek-ai/cordis'
import { colorsFromForegrounds, defineThemeService } from './theme-palette.ts'
import type { BlueSemanticColors } from './types.ts'

const PAPER_FOREGROUNDS = {
  text: '#3b322a',
  textStrong: '#201a13',
  muted: '#6f6357',
  textMuted: '#8a7d6e',
  accent: '#0e7a70',
  primary: '#b4541e',
  border: '#a89a88',
  borderFocus: '#a16207',
  success: '#47763a',
  error: '#c03d2e',
  warning: '#a16207',
  roleUser: '#35509e',
  shellMode: '#7c5cbf',
  mdHeading: '#3b322a',
  mdLink: '#b4541e',
  mdLinkUrl: '#8a7d6e',
  mdCode: '#b4541e',
  mdCodeBlock: '#3b322a',
  mdCodeBlockBorder: '#8a7d6e',
  mdQuote: '#6f6357',
  mdQuoteBorder: '#a89a88',
  mdHr: '#c3b6a4',
  mdListBullet: '#3b322a',
  diffAdded: '#47763a',
  diffRemoved: '#c03d2e',
  diffAddedStrong: '#2f5d28',
  diffRemovedStrong: '#992a1d',
  diffGutter: '#8a7d6e',
  diffMeta: '#6f6357',
  modelHighlight: '#a04e1a',
} as const

/** The paper banner logo sweep: burnt umber up top to parchment at the tail. */
const PAPER_LOGO_GRADIENT = [
  '#7c3f0e', '#8f4d15', '#a35c1f', '#b76e2b', '#c7823c',
  '#d49655', '#dfaa70', '#e8bd8c', '#f0d0ab',
] as const

const PAPER_SELECTED_BG = '#efe6d3'

/** The built-in paper palette as a frozen semantic color table. */
export const PAPER_COLORS: BlueSemanticColors = colorsFromForegrounds(PAPER_FOREGROUNDS, PAPER_SELECTED_BG, PAPER_LOGO_GRADIENT)

/**
 * The paper `blueTheme` provider. Exposes the frozen semantic color table;
 * unregistered automatically when the plugin's fiber unloads.
 */
export class BlueThemeService extends defineThemeService(PAPER_COLORS) {}

/** Stable Cordis plugin name. */
export const name = 'blue-theme-paper'

/**
 * Provide the paper palette as `ctx.blueTheme`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(BlueThemeService)
}
