/**
 * The `/theme` command and the provider swap behind it. The command knows
 * the six core theme subpath plugins (dark/light/ocean/paper/auto/custom)
 * and switches by disposing the live provider's fibers —
 * `ctx.registry.delete` keys runtimes by plugin callback identity, and the
 * loader-loaded baseline `blue-theme-dark` row resolves to the same module
 * this file statically imports, so one registry record covers both — then
 * mounting the replacement through `ctx.plugin`. Dependents reload through
 * Cordis semantics (transcript and input rebuild; the input draft survives
 * through `./draft-stash.ts`). A failed mount best-effort restores the
 * built-in dark palette so the UI is never left without a theme.
 *
 * A bare `/theme` opens the theme picker (the shared single-select panel):
 * every cursor move live-applies the highlighted palette so the whole UI —
 * banner logo sweep included — previews the difference in place, Enter
 * keeps the highlighted theme, Escape reverts to the theme that was live
 * when the panel opened. Each live swap rebuilds the input fiber, whose
 * teardown unmounts the panel's dock slot; the panel re-homes itself after
 * every swap (directly once the swap settles, and again on
 * `'blue/input-editor-changed'` deferred one microtask, past the point
 * where the remounted input re-installs its slot-swap machinery). Without
 * the display quartet (a headless context) the bare command falls back to
 * the plain text listing.
 *
 * @module @dsh-blue/blue-interaction/theme-switch
 */

import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Empty type import carries the 'blue/input-editor-changed' Events merge the
// picker's re-home subscription consumes.
import type {} from './editor-instance.ts'
import * as themeAuto from '@dsh-blue/blue-core/theme-auto'
import * as themeCustom from '@dsh-blue/blue-core/theme-custom'
import * as themeDark from '@dsh-blue/blue-core/theme-dark'
import * as themeLight from '@dsh-blue/blue-core/theme-light'
import * as themeOcean from '@dsh-blue/blue-core/theme-ocean'
import * as themePaper from '@dsh-blue/blue-core/theme-paper'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { SelectListPanel } from './select-list.ts'
import { CURRENT_MARK } from './symbols.ts'

/** Usage text returned for malformed `/theme` invocations. */
const USAGE = 'usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]'

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
  ['ocean', { key: 'ocean', module: themeOcean }],
  ['paper', { key: 'paper', module: themePaper }],
  ['auto', { key: 'auto', module: themeAuto }],
])

/** The file-backed palette, switched with a path (and optional base) config. */
const CUSTOM: ThemeTarget = { key: 'custom', module: themeCustom }

/** Theme keys in listing order. */
const KNOWN_KEYS = ['dark', 'light', 'ocean', 'paper', 'auto', 'custom'] as const

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

/** The picker's built-in keys (custom needs a path argument and stays off). */
type PickerKey = Exclude<(typeof KNOWN_KEYS)[number], 'custom'>

/** One muted hint per picker row, shown after the label. */
const THEME_DESCRIPTIONS: Record<PickerKey, string> = {
  dark: 'the built-in dark palette',
  light: 'light, one gray tier deeper',
  ocean: 'blue-tinted dark, teal logo',
  paper: 'warm light, amber logo',
  auto: 'follow the terminal background',
}

/**
 * Open the theme picker: the shared single-select panel over the built-in
 * keys, live-applying every highlighted palette. Falls back to the text
 * listing when the display quartet is absent.
 * @param ctx - plugin context.
 * @returns the command outcome.
 */
async function openThemePicker(ctx: Context): Promise<CommandResult> {
  const display = displayServices(ctx)
  if (display === undefined) return { kind: 'success', text: listText() }
  const openedAt = current.key
  let closed = false
  // The live-apply chain: moves serialize behind the in-flight swap, so
  // rapid arrows apply in order and never interleave a disposal with a
  // remount.
  let chain: Promise<void> = Promise.resolve()
  /* v8 ignore next -- the placeholder runs only if a swap settles before
     the initial mount returns, which the building order forbids */
  let restore: () => void = () => {}

  /**
   * Re-claim the editor's dock slot: every swap rebuilt the input fiber
   * (unmounting the panel with the old one), so the panel mounts fresh and
   * takes focus back from the remounted editor.
   */
  const rehome = (): void => {
    if (closed) return
    restore()
    restore = mountEditorReplacement(panel)
  }

  const panel = new SelectListPanel({
    keymap: display.keymap,
    // The live table, re-resolved per render: the panel itself recolors
    // with every previewed palette (the snapshot at open would freeze the
    // frame in the opening theme).
    theme: {
      get colors() {
        /* v8 ignore next -- the fallback arm only renders inside the
           provider gap of an in-flight swap, never in a settled state */
        return ctx.get('blueTheme')?.colors ?? display.colors
      },
    },
    components: display.components,
    rows: (KNOWN_KEYS.filter(key => key !== 'custom') as PickerKey[]).map(key => ({
      value: key,
      label: key,
      description: THEME_DESCRIPTIONS[key],
    })),
    title: 'Themes',
    titleHint: '· esc revert · ↵ keep',
    // The cursor starts on the live theme ('custom' seeds the head — its
    // palette is not re-selectable from the picker).
    ...(openedAt === 'custom' ? {} : { initialValue: openedAt }),
    onHighlight: row => {
      const target = BUILTIN.get(row.value)
      /* v8 ignore next -- every picker row is a BUILTIN key by construction */
      if (target === undefined) return
      chain = chain.then(async () => {
        if (closed) return
        await switchTheme(ctx, target)
        rehome()
      })
    },
    onSelect: row => {
      // The highlighted palette is already live; close first so the panel
      // is gone before any final swap rebuilds the input.
      close()
      if (current.key !== row.value) {
        void switchTheme(ctx, BUILTIN.get(row.value)!)
      }
      getSharedEditor()?.notice?.(`theme ${current.key}`)
    },
    onCancel: () => {
      close()
      // Escape reverts to the opening theme; a 'custom' opening theme has
      // no picker row to return to, so the previewed palette stands.
      const back = BUILTIN.get(openedAt)
      if (back !== undefined && current.key !== openedAt) void switchTheme(ctx, back)
    },
  })

  /**
   * Tear the picker down: stop the chain, drop the editor-changed
   * subscription, pop the dock slot.
   */
  function close(): void {
    /* v8 ignore next -- the panel fires exactly one exit callback */
    if (closed) return
    closed = true
    offEditorChanged()
    restore()
  }

  // The input fiber's mount emits before its slot-swap machinery installs;
  // one microtask later the panel can re-home against the fresh swap.
  const offEditorChanged = ctx.on('blue/input-editor-changed', () => {
    void Promise.resolve().then(rehome)
  })
  restore = mountEditorReplacement(panel)
  return { kind: 'success' }
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
    input: { hint: '[dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]' },
    handler: async (invocation): Promise<CommandResult> => {
      const trimmed = invocation.rawInput.trim()
      const args = trimmed.length === 0 ? [] : trimmed.split(/\s+/)
      const name = args.shift()
      if (name === undefined) return openThemePicker(ctx)
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
