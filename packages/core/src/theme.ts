/**
 * `ctx.blueTheme` service: the semantic color table. The MVP ships one
 * built-in dark palette as truecolor ANSI wrappers; palette values follow
 * pi's dark theme so Blue reads consistently next to pi-based tooling.
 *
 * @module @deepseek-ai/dsh-blue-core/theme
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BlueColorFn, BlueSemanticColors, BlueTheme } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueTheme: BlueThemeService
  }
}

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
  muted: '#808080',
  accent: '#8abeb7',
  border: '#5f87ff',
  success: '#b5bd68',
  error: '#cc6666',
  warning: '#ffff00',
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
 * The `blueTheme` service. Exposes the frozen semantic color table;
 * unregistered automatically when the plugin's fiber unloads.
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
