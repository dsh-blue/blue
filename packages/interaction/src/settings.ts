/**
 * `blue-settings` plugin: the consolidated `blue` settings namespace. This
 * is the tree's ONE `installSettingsSection` registration for
 * `settingsNamespace('blue')` — every consumer (the boot update check, the
 * `/settings` panel, the `/update` channel read) resolves the shared thunk
 * {@link currentBlueSettings} instead of registering its own section, so a
 * host's settings service sees exactly one `blue` schema. Until a settings
 * service layers user overrides the thunk answers the composition defaults.
 *
 * The plugin also owns the persisted default theme: after the loader
 * settles it reads `blue.theme` and swaps the live provider when the
 * persisted key differs from the baseline bundle theme, and it re-reads on
 * every `settings/updated` commit of the `blue` namespace. The swap goes
 * through `./theme-switch.ts`'s `applyTheme` — the same provider exchange
 * `/theme` drives — so the command's live-provider record stays honest. A
 * session-level `/theme` pick survives unrelated `blue` writes: the plugin
 * records only the themes IT applied (`lastAppliedTheme`), so a commit that
 * leaves the persisted theme unchanged never touches the live provider.
 * The plugin never injects `blueTheme` (a swap disposes every dependent
 * fiber — injecting would self-dispose mid-swap); every service read is a
 * lazy `ctx.get`.
 *
 * @module @dsh-blue/blue-interaction/settings
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the loader Context merge for the settlement
// await (the update check's own discipline).
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Empty type import carries the `settings` Context merge and the
// 'settings/updated' Events merge this plugin subscribes to.
import type {} from '@deepseek-ai/dsh-settings'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { applyTheme } from './theme-switch.ts'

/** The user-tunable Blue settings (the `blue` settings namespace). */
export interface BlueSettings {
  /** Whether the boot update check runs at all; `false` is the offline switch. */
  readonly updateCheck: boolean
  /** The dist-tag the update check follows (`rc` today). */
  readonly updateChannel: string
  /** The default theme, applied at startup; `/theme` overrides per session. */
  readonly theme: 'dark' | 'light' | 'ocean' | 'paper' | 'auto'
  /** Whether thinking blocks start collapsed. */
  readonly collapseThinking: boolean
  /** Whether tool output starts collapsed (ctrl+o toggles in the session). */
  readonly collapseToolCalls: boolean
}

/** The settings schema; defaults double as the composition base. */
export const Config: z<BlueSettings> = z.object({
  updateCheck: z.boolean().default(true),
  updateChannel: z.string().default('rc'),
  theme: z.union([z.const('dark'), z.const('light'), z.const('ocean'), z.const('paper'), z.const('auto')]).default('dark'),
  collapseThinking: z.boolean().default(true),
  collapseToolCalls: z.boolean().default(true),
})

/** The resolved defaults, used until a settings service layers overrides. */
export const DEFAULT_SETTINGS: BlueSettings = {
  updateCheck: true,
  updateChannel: 'rc',
  theme: 'dark',
  collapseThinking: true,
  collapseToolCalls: true,
}

/** Stable Cordis plugin name. */
export const name = 'blue-settings'

/** The active source: the resolved scope while a settings service is attached, the composition entry otherwise. */
let source: () => BlueSettings = () => DEFAULT_SETTINGS

/**
 * Read the current `blue` settings: schema defaults layered with the user
 * document while a settings service is attached, the composition defaults
 * otherwise.
 * @returns the resolved Blue settings.
 */
export function currentBlueSettings(): BlueSettings {
  return source()
}

/**
 * The theme this plugin last applied itself. Initialized to the baseline
 * bundle theme (`blue-theme-dark` is the loader-loaded patch row); a
 * session-level `/theme` pick never moves it, which is what lets unrelated
 * `blue` namespace writes leave the live provider alone.
 */
let lastAppliedTheme: BlueSettings['theme'] = 'dark'

/**
 * Swap the live theme provider to the persisted default when it moved.
 * Records only successful swaps, so a failed mount retries on the next
 * commit instead of being treated as applied.
 * @param ctx - plugin context.
 * @param isUnloaded - the fiber's unload flag.
 */
async function syncTheme(ctx: Context, isUnloaded: () => boolean): Promise<void> {
  const theme = currentBlueSettings().theme
  if (theme === lastAppliedTheme) return
  const result = await applyTheme(ctx, theme)
  /* v8 ignore next 1 -- a fiber unload landing inside the swap's awaits is
     a shutdown race no spec can stage deterministically */
  if (isUnloaded()) return
  if (result.kind === 'success') {
    lastAppliedTheme = theme
  } else {
    /* v8 ignore next 1 -- the swap's error results always carry text */
    ctx.logger.warn(result.text ?? `could not apply theme "${theme}"`)
  }
}

/**
 * Mount the settings consolidation: register the `blue` section (the
 * thunk flips to the resolved scope while a settings service lives), apply
 * the persisted theme once the tree settles, and follow later commits.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })
  installSettingsSection(ctx, settingsNamespace('blue'), Config, DEFAULT_SETTINGS, {
    setSource: next => {
      source = next
    },
    onChange: () => {},
  })
  ctx.on('settings/updated', (ns) => {
    if (String(ns) !== 'blue') return
    /* v8 ignore next 1 -- the defensive catch; syncTheme never rejects */
    void syncTheme(ctx, () => unloaded).catch(() => {})
  })
  // Fire-and-forget with the fiber's unload flag gating every continuation
  // (the update check's discipline): the persisted theme applies only after
  // the whole tree settles, never mid-boot.
  /* v8 ignore next 1 -- the defensive catch; the boot body never rejects */
  void (async () => {
    await ctx.get('loader')?.await()
    if (unloaded) return
    await syncTheme(ctx, () => unloaded)
  })().catch(() => {})
}
