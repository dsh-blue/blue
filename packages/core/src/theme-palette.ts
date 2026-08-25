/**
 * Shared palette machinery for the theme plugin family (`blue-theme-dark`,
 * `blue-theme-light`, `blue-theme-auto`, `blue-theme-custom`): the hex →
 * ANSI truecolor wrappers, the hex table → frozen semantic color table
 * builder, and the `blueTheme` Service subclass factory. Internal module —
 * not a package subpath export; the theme plugins are the public surface.
 *
 * @module @dsh-blue/blue-core/theme-palette
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { BlueColorFn, BlueSemanticColors, BlueTheme } from './types.ts'
import type { ThemeModel } from '@dsh-blue/blue-frontend'

/**
 * Wrap text in a truecolor foreground.
 * @param hex - the color as `#rrggbb`.
 * @returns a color function emitting `38;2` / `39` sequences.
 */
export function foregroundColor(hex: string): BlueColorFn {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return text => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`
}

/**
 * Wrap text in a truecolor background.
 * @param hex - the color as `#rrggbb`.
 * @returns a color function emitting `48;2` / `49` sequences.
 */
export function backgroundColor(hex: string): BlueColorFn {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return text => `\x1b[48;2;${r};${g};${b}m${text}\x1b[49m`
}

/**
 * The 27 foreground tokens of a palette as `#rrggbb` hexes. `selectedBg`
 * is excluded: it is the palette's only background token and is passed
 * separately to {@link colorsFromForegrounds}.
 */
export type BlueForegroundHexes = Record<Exclude<keyof BlueSemanticColors, 'selectedBg' | 'logoGradient'>, string>

/** Build the renderer-neutral companion model for a semantic palette. */
export function themeModel(id: string, name: string, dark: boolean, foregrounds: BlueForegroundHexes, selectedBg: string): Omit<ThemeModel, 'colors'> & { readonly colors: Readonly<Record<string, string>> } {
  return { kind: 'theme', id, name, dark, colors: Object.freeze({ ...foregrounds, selectedBg }) }
}

/** Build the renderer-neutral companion model for a semantic palette. */
export function themeModel(id: string, name: string, dark: boolean, foregrounds: BlueForegroundHexes, selectedBg: string): Omit<ThemeModel, 'colors'> & { readonly colors: Readonly<Record<string, string>> } {
  return { kind: 'theme', id, name, dark, colors: Object.freeze({ ...foregrounds, selectedBg }) }
}

/**
 * Build the frozen 28-token semantic color table from palette hexes.
 * @param foregrounds - one hex per foreground token.
 * @param selectedBg - the hex behind the selected list entry.
 * @returns the frozen semantic color table.
 */
export function colorsFromForegrounds(foregrounds: BlueForegroundHexes, selectedBg: string, logoGradient: readonly string[]): BlueSemanticColors {
  const colors = Object.fromEntries(
    Object.entries(foregrounds).map(([role, hex]) => [role, foregroundColor(hex)]),
  )
  return Object.freeze({
    ...colors,
    selectedBg: backgroundColor(selectedBg),
    logoGradient: Object.freeze(logoGradient.map(hex => foregroundColor(hex))),
  }) as BlueSemanticColors
}

/** Constructor shape of the `blueTheme` providers built by {@link defineThemeService}. */
export type BlueThemeServiceClass = new (ctx: Context) => Service & BlueTheme

/**
 * Build a `blueTheme` Service subclass around one frozen color table. The
 * returned class registers itself on construction and unregisters when its
 * fiber unloads, so theme plugins can swap providers fiber-for-fiber.
 * @param colors - the frozen semantic color table to expose.
 * @returns a Service subclass mountable via `ctx.plugin`.
 */
export function defineThemeService(colors: BlueSemanticColors, model?: Omit<ThemeModel, 'colors'> & { readonly colors: Readonly<Record<string, string>> }): BlueThemeServiceClass {
  return class extends Service implements BlueTheme {
    readonly colors = colors

    /**
     * Create and register the service.
     * @param ctx - the owning Cordis context.
     */
    constructor(ctx: Context) {
      super(ctx, 'blueTheme')
      const models = ctx.get('blueThemeModels')
      if (models !== undefined && model !== undefined) ctx.effect(() => models.register(model))
    }
  }
}
