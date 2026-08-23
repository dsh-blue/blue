/**
 * `blue-theme-custom` plugin: a user palette loaded from a JSON file and
 * layered over a built-in base palette. The file maps semantic token names
 * to `#rrggbb` hexes — except `logoGradient`, which maps to an array of
 * them (one per banner logo row); entries that name unknown tokens or
 * carry invalid colors are dropped (with a warning) and fall back to the
 * base palette entry, and an unreadable or malformed file falls back to
 * the whole base palette. Ships as a subpath entry so it can replace
 * `blue-theme-dark` fiber-for-fiber in the bundle patch.
 *
 * @module @dsh-blue/blue-core/theme-custom
 */

import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { backgroundColor, defineThemeService, foregroundColor } from './theme-palette.ts'
import { DARK_COLORS } from './theme-dark.ts'
import { LIGHT_COLORS } from './theme-light.ts'
import { OCEAN_COLORS } from './theme-ocean.ts'
import { PAPER_COLORS } from './theme-paper.ts'
import type { BlueColorFn, BlueSemanticColors } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-theme-custom'

/** The built-in palettes a custom file can layer over. */
export type BlueThemeBase = 'dark' | 'light' | 'ocean' | 'paper'

/** Plugin config: the palette file and the base palette beneath it. */
export interface Config {
  /** Path to the JSON palette file. */
  path: string
  /** Base palette for tokens the file does not override. Defaults to `'dark'`. */
  base: BlueThemeBase
}

/** Validated plugin config; `base` defaults to `'dark'`. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  base: z.union([z.const('dark'), z.const('light'), z.const('ocean'), z.const('paper')]).default('dark'),
})

const BASE_PALETTES: Record<BlueThemeBase, BlueSemanticColors> = {
  dark: DARK_COLORS,
  light: LIGHT_COLORS,
  ocean: OCEAN_COLORS,
  paper: PAPER_COLORS,
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Provide the file-defined palette as `ctx.blueTheme`, falling back to the
 * base palette wherever the file does not supply a valid token.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const logger = ctx.logger(name)
  const base = BASE_PALETTES[config.base]
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(config.path, 'utf8'))
  } catch {
    logger.warn('cannot load theme file %s; using the %s base palette', config.path, config.base)
    ctx.plugin(defineThemeService(base))
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logger.warn('theme file %s is not a token object; using the %s base palette', config.path, config.base)
    ctx.plugin(defineThemeService(base))
    return
  }
  const overrides: Record<string, BlueColorFn | readonly BlueColorFn[]> = {}
  for (const [token, value] of Object.entries(parsed)) {
    if (!Object.hasOwn(base, token)) {
      logger.warn('ignoring unknown theme token %s', token)
      continue
    }
    // The one array token: a sweep of hexes, one per logo row. A ramp that
    // fails as a whole falls back to the base sweep (per-entry salvage
    // would bend the gradient).
    if (token === 'logoGradient') {
      const entries = Array.isArray(value) ? value : undefined
      if (entries === undefined || entries.length === 0
        || entries.some(entry => typeof entry !== 'string' || !HEX_COLOR.test(entry))) {
        logger.warn('ignoring invalid gradient for theme token %s; using the base palette entry', token)
        continue
      }
      overrides[token] = Object.freeze(entries.map(hex => foregroundColor(hex)))
      continue
    }
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      logger.warn('ignoring invalid color for theme token %s; using the base palette entry', token)
      continue
    }
    overrides[token] = token === 'selectedBg' ? backgroundColor(value) : foregroundColor(value)
  }
  ctx.plugin(defineThemeService(Object.freeze({ ...base, ...overrides }) as BlueSemanticColors))
}
