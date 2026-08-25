/**
 * `blue-theme-custom` plugin: a user palette loaded from a JSON file and
 * layered over a built-in base palette. The file maps semantic token names
 * to `#rrggbb` hexes; entries that name unknown tokens or carry invalid
 * colors are dropped (with a warning) and fall back to the base palette
 * entry, and an unreadable or malformed file falls back to the whole base
 * palette. Ships as a subpath entry so it can replace `blue-theme-dark`
 * fiber-for-fiber in the bundle patch.
 *
 * @module @dsh-blue/blue-core/theme-custom
 */

import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { backgroundColor, defineThemeService, foregroundColor, themeModel } from './theme-palette.ts'
import { DARK_COLORS, DARK_FOREGROUNDS, DARK_SELECTED_BG } from './theme-dark.ts'
import { LIGHT_COLORS, LIGHT_FOREGROUNDS, LIGHT_SELECTED_BG } from './theme-light.ts'
import type { BlueColorFn, BlueSemanticColors } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-theme-custom'

/** Plugin config: the palette file and the base palette beneath it. */
export interface Config {
  /** Path to the JSON palette file. */
  path: string
  /** Base palette for tokens the file does not override. Defaults to `'dark'`. */
  base: 'dark' | 'light'
}

/** Validated plugin config; `base` defaults to `'dark'`. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  base: z.union([z.const('dark'), z.const('light')]).default('dark'),
})

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Provide the file-defined palette as `ctx.blueTheme`, falling back to the
 * base palette wherever the file does not supply a valid token.
 * @param ctx - plugin context.
 * @param config - validated plugin config.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const logger = ctx.logger(name)
  const base = config.base === 'light' ? LIGHT_COLORS : DARK_COLORS
  const baseForegrounds = config.base === 'light' ? LIGHT_FOREGROUNDS : DARK_FOREGROUNDS
  const baseSelectedBg = config.base === 'light' ? LIGHT_SELECTED_BG : DARK_SELECTED_BG
  const baseModel = themeModel('custom', 'Custom', config.base !== 'light', baseForegrounds, baseSelectedBg)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(config.path, 'utf8'))
  } catch {
    logger.warn('cannot load theme file %s; using the %s base palette', config.path, config.base)
    ctx.plugin(defineThemeService(base, baseModel))
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logger.warn('theme file %s is not a token object; using the %s base palette', config.path, config.base)
    ctx.plugin(defineThemeService(base, baseModel))
    return
  }
  const overrides: Record<string, BlueColorFn | readonly BlueColorFn[]> = {}
  const rawOverrides: Record<string, string> = {}
  for (const [token, value] of Object.entries(parsed)) {
    if (!Object.hasOwn(base, token)) {
      logger.warn('ignoring unknown theme token %s', token)
      continue
    }
    if (token === 'logoGradient') {
      if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string' || !HEX_COLOR.test(entry))) {
        logger.warn('ignoring invalid gradient for theme token %s; using the base palette entry', token)
        continue
      }
      overrides[token] = Object.freeze(value.map(entry => foregroundColor(entry)))
      continue
    }
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      logger.warn('ignoring invalid color for theme token %s; using the base palette entry', token)
      continue
    }
    overrides[token] = token === 'selectedBg' ? backgroundColor(value) : foregroundColor(value)
    rawOverrides[token] = value
  }
  ctx.plugin(defineThemeService(Object.freeze({ ...base, ...overrides }) as BlueSemanticColors, { ...baseModel, colors: Object.freeze({ ...baseModel.colors, ...rawOverrides }) }))
}
