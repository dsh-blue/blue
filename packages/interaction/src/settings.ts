/**
 * `blue-settings` plugin: the consolidated `blue` settings namespace. This
 * is the tree's ONE `installSettingsSection` registration for
 * `settingsNamespace('blue')` — every consumer (the boot update check, the
 * `/settings` panel, the `/update` channel read) resolves the tree-scoped
 * {@link currentBlueSettings} source instead of registering its own section, so a
 * host's settings service sees exactly one `blue` schema. Until a settings
 * service layers user overrides the thunk answers the composition defaults.
 *
 * The plugin also owns the persisted default theme: the initial apply is
 * gated on session attach — when `blueSessionReader.current()` is non-null the
 * swap runs as soon as the resolved settings scope goes live (the section
 * installer's `onChange`, one inject-beat after apply), otherwise the
 * first reader notification arms it (the app publishes that snapshot only
 * after `boot()` returns, so disposing the baseline theme fiber can never
 * race the loader's activation assertion; session-less headless hosts
 * never swap — there is no UI to paint). After the attach the plugin
 * re-reads on every `settings/updated` commit of the `blue` namespace.
 * The swap goes through `./theme-switch.ts`'s `applyTheme` — the same
 * provider exchange `/theme` drives — so the command's live-provider
 * record stays honest. A session-level `/theme` pick survives unrelated
 * `blue` writes: the plugin records only the themes IT applied
 * (`lastAppliedTheme`), so a commit that leaves the persisted theme
 * unchanged never touches the live provider. The plugin never injects
 * `blueTheme` (a swap disposes every dependent fiber — injecting would
 * self-dispose mid-swap); every service read is a lazy `ctx.get`.
 *
 * @module @dsh-blue/blue-interaction/settings
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the `settings` Context merge and the
// 'settings/updated' Events merge this plugin subscribes to.
import type {} from '@deepseek-ai/dsh-settings'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
// Empty type import carries the app-owned reader Context merge.
import type {} from '@dsh-blue/blue-app'
import { applyTheme } from './theme-switch.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** The consolidated Blue settings source became readable in this tree. */
    'blue/settings-source-ready'(value: unknown): void
  }
}

/** The user-tunable Blue settings (the `blue` settings namespace). */
export interface BlueSettings {
  /** Whether the boot update check runs at all; `false` is the offline switch. */
  readonly updateCheck: boolean
  /** The dist-tag the update check follows (`rc` today). */
  readonly updateChannel: string
  /** The default theme, applied at startup; `/theme` overrides per session. */
  readonly theme: 'dark' | 'light' | 'ocean' | 'paper' | 'auto'
  /** User-selected status provider id; `blue.default` keeps the built-in footer. */
  readonly statusProvider: string
  /** User-selected editor provider id; `blue.default` keeps the built-in shell. */
  readonly editorProvider: string
  /** Whether thinking blocks start collapsed. */
  readonly collapseThinking: boolean
  /** Whether tool output starts collapsed (ctrl+o toggles in the session). */
  readonly collapseToolCalls: boolean
  /** Completed turns kept mounted in the transcript window (mirrors transcript's DEFAULT_WINDOW_TURNS). */
  readonly windowTurns: number
  /** Recent steps of a turn keeping their cards before step folding (mirrors DEFAULT_RECENT_STEPS_RETENTION). */
  readonly recentStepsRetention: number
  /** Turns the Ctrl-O expansion toggle reaches back (mirrors transcript's EXPAND_TURNS). */
  readonly expandTurns: number
  /** Lines of a user message before it folds (mirrors DEFAULT_USER_FOLD_LINES). */
  readonly userFoldLines: number
  /** Characters of a user message before it folds (mirrors DEFAULT_USER_FOLD_CHARS). */
  readonly userFoldChars: number
  /** External editor command overriding `$VISUAL`/`$EDITOR`; empty follows the environment. */
  readonly editorCommand: string
  /** Linux clipboard backend for image paste; `auto` probes the session (the plugin config stands when the user layer never sets this). */
  readonly pasteImageBackend: 'auto' | 'wayland' | 'x11'
}

/** The settings schema; defaults double as the composition base. */
export const Config: z<BlueSettings> = z.object({
  updateCheck: z.boolean().default(true),
  updateChannel: z.string().default('rc'),
  theme: z.union([z.const('dark'), z.const('light'), z.const('ocean'), z.const('paper'), z.const('auto')]).default('dark'),
  statusProvider: z.string().default('blue.default'),
  editorProvider: z.string().default('blue.default'),
  collapseThinking: z.boolean().default(true),
  collapseToolCalls: z.boolean().default(true),
  windowTurns: z.number().step(1).min(1).default(15),
  recentStepsRetention: z.number().step(1).min(1).default(30),
  expandTurns: z.number().step(1).min(1).default(3),
  userFoldLines: z.number().step(1).min(1).default(10),
  userFoldChars: z.number().step(1).min(1).default(1000),
  editorCommand: z.string().default(''),
  pasteImageBackend: z.union([z.const('auto'), z.const('wayland'), z.const('x11')]).default('auto'),
})

/** The resolved defaults, used until a settings service layers overrides. */
export const DEFAULT_SETTINGS: BlueSettings = {
  updateCheck: true,
  updateChannel: 'rc',
  theme: 'dark',
  statusProvider: 'blue.default',
  editorProvider: 'blue.default',
  collapseThinking: true,
  collapseToolCalls: true,
  windowTurns: 15,
  recentStepsRetention: 30,
  expandTurns: 3,
  userFoldLines: 10,
  userFoldChars: 1000,
  editorCommand: '',
  pasteImageBackend: 'auto',
}

/** Stable Cordis plugin name. */
export const name = 'blue-settings'
/** Runtime state and session boundary required by the settings owner. */
export const inject = ['blueInteractionState', 'blueSessionReader']

/**
 * Read the current `blue` settings: schema defaults layered with the user
 * document while a settings service is attached, the composition defaults
 * otherwise.
 * @returns the resolved Blue settings.
 */
export function currentBlueSettings(ctx: Context): BlueSettings {
  return ctx.blueInteractionState.settingsSource()
}

/**
 * The theme this plugin last applied itself. Initialized to the baseline
 * bundle theme (`blue-theme-dark` is the loader-loaded patch row); a
 * session-level `/theme` pick never moves it, which is what lets unrelated
 * `blue` namespace writes leave the live provider alone.
 */
/**
 * Swap the live theme provider to the persisted default when it moved.
 * Records only successful swaps, so a failed mount retries on the next
 * commit instead of being treated as applied.
 * @param ctx - plugin context.
 * @param isUnloaded - the fiber's unload flag.
 */
async function syncTheme(ctx: Context, isUnloaded: () => boolean): Promise<void> {
  const state = ctx.blueInteractionState
  const theme = currentBlueSettings(ctx).theme
  if (theme === state.lastAppliedTheme) return
  const result = await applyTheme(ctx, theme)
  /* v8 ignore next 1 -- a fiber unload landing inside the swap's awaits is
     a shutdown race no spec can stage deterministically */
  if (isUnloaded()) return
  if (result.kind === 'success') {
    state.lastAppliedTheme = theme
  } else {
    /* v8 ignore next 1 -- the swap's error results always carry text */
    ctx.logger.warn(result.text ?? `could not apply theme "${theme}"`)
  }
}

/**
 * Mount the settings consolidation: register the `blue` section (the
 * thunk flips to the resolved scope while a settings service lives), apply
 * the persisted theme at session attach, and follow later commits.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })
  const sync = (): void => {
    /* v8 ignore next 1 -- the defensive catch; syncTheme never rejects */
    void syncTheme(ctx, () => unloaded).catch(() => {})
  }
  // `settings/updated` commits landing before the first attach need no
  // follow: the attach-time sync reads the current value.
  let attached = ctx.blueSessionReader.current() !== null
  // The initial sync must read the resolved scope, which goes live one
  // inject-beat after apply — installSettingsSection fires onChange then,
  // and re-fires it on every blue commit through the scope watch, so
  // `primed` keeps that watch from doubling the settings/updated channel.
  let primed = false
  const prime = (): void => {
    if (primed || !attached) return
    primed = true
    sync()
  }
  installSettingsSection(ctx, settingsNamespace('blue'), Config, DEFAULT_SETTINGS, {
    setSource: next => {
      ctx.blueInteractionState.settingsSource = next
      ctx.emit('blue/settings-source-ready', next())
    },
    onChange: prime,
  })
  ctx.on('settings/updated', (ns) => {
    if (String(ns) !== 'blue' || !attached) return
    sync()
  })
  // Session attach is the post-boot signal (the terminal-title precedent):
  // the app publishes the first non-null reader snapshot only after boot()
  // returns, so the
  // swap can never race the loader's entry-activation assertion. An
  // already-attached session skips the wait: the onChange prime above
  // carries the initial sync.
  const registration = ctx.blueSessionReader.subscribe((snapshot) => {
    if (attached || snapshot === null) return
    attached = true
    prime()
  })
  ctx.effect(() => () => registration.dispose())
}
