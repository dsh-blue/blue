/**
 * The `/theme` command and the provider swap behind it. The command knows
 * the four core theme subpath plugins (dark/light/auto/custom) and switches
 * by disposing the live provider's fibers — `ctx.registry.delete` keys
 * runtimes by plugin callback identity, and the loader-loaded baseline
 * `blue-theme-dark` row resolves to the same module this file statically
 * imports, so one registry record covers both — then mounting the
 * replacement through `ctx.plugin`. Dependents reload through Cordis
 * semantics (transcript and input rebuild; the input draft survives through
 * `./draft-stash.ts`). A failed mount best-effort restores the built-in
 * dark palette so the UI is never left without a theme.
 *
 * @module @dsh-blue/blue-interaction/theme-switch
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import * as themeAuto from '@dsh-blue/blue-core/theme-auto'
import * as themeCustom from '@dsh-blue/blue-core/theme-custom'
import * as themeDark from '@dsh-blue/blue-core/theme-dark'
import * as themeLight from '@dsh-blue/blue-core/theme-light'
import { CURRENT_MARK } from './symbols.ts'

/** Usage text returned for malformed `/theme` invocations. */
const USAGE = 'usage: /theme [dark|light|auto|custom <path> [dark|light]]'

/** One switchable theme provider: the command-facing key and the plugin module. */
interface ThemeTarget {
  readonly key: string
  readonly module: Plugin
}

/** The baseline provider, also the fallback restored after a failed mount. */
const DARK: ThemeTarget = { key: 'dark', module: themeDark }

/** The built-in palettes, switchable without extra config. */
const BUILTIN: ReadonlyMap<string, ThemeTarget> = new Map([
  ['dark', DARK],
  ['light', { key: 'light', module: themeLight }],
  ['auto', { key: 'auto', module: themeAuto }],
])

/** The file-backed palette, switched with a path (and optional base) config. */
const CUSTOM: ThemeTarget = { key: 'custom', module: themeCustom }

/** Theme keys in listing order. */
const KNOWN_KEYS = ['dark', 'light', 'auto', 'custom'] as const

/**
 * The live provider. Initialized to dark: the baseline bundle patch loads
 * `blue-theme-dark`, and its loader-resolved module is this same reference.
 */
let current: ThemeTarget = DARK

/**
 * The `/theme` listing: every known key, the live one marked with the
 * shared `← current` selector mark (the same vocabulary as the session
 * picker's badge).
 * @returns the listing text.
 */
function listText(): string {
  const entries = KNOWN_KEYS.map(key => key === current.key ? `${key} ${CURRENT_MARK}` : key)
  return `themes: ${entries.join(', ')}`
}

/**
 * Swap the live provider for `next`: dispose every fiber of the current
 * module, then mount the replacement. A mount failure restores dark.
 * @param ctx - plugin context.
 * @param next - the theme to activate.
 * @param config - the custom-theme config; omitted for built-ins.
 * @returns the command outcome.
 */
async function switchTheme(ctx: Context, next: ThemeTarget, config?: themeCustom.Config): Promise<CommandResult> {
  const runtime = ctx.registry.delete(current.module)
  // delete() removes the runtime record and starts disposal; awaiting each
  // fiber settles it before the remount (a second blueTheme registration
  // while the previous provider lives is rejected). dispose() is
  // single-shot, so re-awaiting an in-flight disposal is safe.
  if (runtime !== undefined) {
    await Promise.all([...runtime.fibers].map(fiber => fiber.dispose()))
  }
  try {
    await (config === undefined ? ctx.plugin(next.module) : ctx.plugin(next.module, config))
  } catch (error) {
    current = DARK
    // A restore failure propagates and settles as a command error.
    await ctx.plugin(themeDark)
    return {
      kind: 'error',
      /* v8 ignore next -- mount failures are Error instances (config validation or service conflicts) */
      text: `failed to apply theme "${next.key}": ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  current = next
  return { kind: 'success', text: `switched to theme "${next.key}"` }
}

/**
 * Register the `/theme` command on `ctx.commands`.
 * @param ctx - plugin context carrying the command registry.
 * @returns the registration disposer.
 */
export function registerThemeCommand(ctx: Context): () => void {
  return ctx.commands.register({
    name: 'theme',
    description: 'Switch the color theme',
    input: { hint: '[dark|light|auto|custom <path> [dark|light]]' },
    handler: async (invocation): Promise<CommandResult> => {
      const trimmed = invocation.rawInput.trim()
      const args = trimmed.length === 0 ? [] : trimmed.split(/\s+/)
      const name = args.shift()
      if (name === undefined) return { kind: 'success', text: listText() }
      const builtin = BUILTIN.get(name)
      if (builtin !== undefined) {
        if (args.length > 0) return { kind: 'error', text: USAGE }
        return switchTheme(ctx, builtin)
      }
      if (name === 'custom') {
        const path = args.shift()
        const base = args.shift()
        if (path === undefined || args.length > 0) return { kind: 'error', text: USAGE }
        // The base reaches theme-custom's Config schema unvalidated: an
        // invalid value fails the mount, and switchTheme restores dark.
        return switchTheme(ctx, CUSTOM, { path, base: base ?? 'dark' } as themeCustom.Config)
      }
      return { kind: 'error', text: USAGE }
    },
  })
}
