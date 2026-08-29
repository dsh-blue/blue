/**
 * Harness settings adapter for Blue's renderer-neutral locale runtime. It
 * shares the official `locale.preference` wire shape while keeping the Web
 * client and its peer graph outside the terminal frontend tree.
 *
 * Deletion condition: remove this adapter when Harness publishes a
 * renderer-neutral locale service with the same process fallback, settings
 * snapshot, live update, and unload contracts.
 *
 * @module @dsh-blue/blue-harness-adapter/locale
 */

import type { Context } from '@deepseek-ai/cordis'
// Carries the optional settings service and settings/updated event merges.
import type {} from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { BLUE_LOCALE_IDS, BlueLocaleService, type BlueLocaleId } from '@dsh-blue/blue-frontend'

/** Official Harness settings namespace for the locale preference. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Official Harness settings field for an explicit locale choice. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Persisted Harness locale settings. */
export interface LocaleSettings {
  /** Explicit locale; absence follows the process environment. */
  readonly preference?: BlueLocaleId
}

/** Harness-compatible locale settings schema. */
export const LocaleSettingsSchema: z<LocaleSettings> = z.object({
  [LOCALE_PREFERENCE_FIELD]: z.union([...BLUE_LOCALE_IDS]).required(false),
})

/** Environment subset consumed by {@link detectSystemLocale}. */
export interface LocaleEnvironment {
  readonly LC_ALL?: string | undefined
  readonly LC_MESSAGES?: string | undefined
  readonly LANG?: string | undefined
}

/**
 * Normalize an OS locale to one Blue supports. All Chinese variants use
 * Simplified Chinese; unsupported, C/POSIX, and malformed locales use English.
 * @param value - environment or Intl locale string.
 * @returns supported locale id.
 */
export function normalizeSystemLocale(value: string | undefined): BlueLocaleId {
  if (value === undefined) return 'en'
  const base = value.trim().split(/[.@]/u, 1)[0]?.replaceAll('_', '-')
  if (base === undefined || base === '' || /^(?:C|POSIX)$/iu.test(base)) return 'en'
  return base.split('-', 1)[0]?.toLowerCase() === 'zh' ? 'zh' : 'en'
}

/**
 * Resolve the process locale using POSIX precedence, then Intl.
 * @param environment - process locale environment.
 * @param intlLocale - Intl fallback, injectable for deterministic tests.
 * @returns supported locale id.
 */
export function detectSystemLocale(
  environment: LocaleEnvironment = process.env,
  intlLocale: string | undefined = Intl.DateTimeFormat().resolvedOptions().locale,
): BlueLocaleId {
  const candidate = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG || intlLocale
  return normalizeSystemLocale(candidate)
}

/** Stable Cordis plugin name. */
export const name = 'blue-locale'

/** Locale service remains available when the optional settings service is absent. */
export const inject: readonly string[] = []

/**
 * Mount the locale service and bind it to Harness user settings when present.
 * @param ctx - owning frontend-tree context.
 */
export function apply(ctx: Context): void {
  const locale = new BlueLocaleService(ctx, { systemLocale: detectSystemLocale() })
  ctx.effect(() => () => locale.dispose())

  ctx.inject(['settings'], (settingsCtx) => {
    const namespace = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    settingsCtx.settings.register(namespace, LocaleSettingsSchema)
    const sync = (): void => {
      const section = settingsCtx.settings.get(namespace) as LocaleSettings | undefined
      locale.setPreference(section?.preference)
    }
    sync()
    settingsCtx.on('settings/updated', (changed) => {
      if (String(changed) === LOCALE_SETTINGS_NAMESPACE) sync()
    })
    settingsCtx.effect(() => () => locale.setPreference(undefined))
  })
}
