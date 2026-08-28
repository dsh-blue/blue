/**
 * Renderer-neutral locale registry and active-locale service. Dictionary
 * owners register plain message tables; renderers bind a namespace and read
 * the active locale at call time, so a language switch never replaces UI
 * models or renderer objects.
 *
 * @module @dsh-blue/blue-frontend/locale
 */

import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueLocale: BlueLocaleService
  }
}

/** Locale identifiers supported by Blue. */
export const BLUE_LOCALE_IDS = ['zh', 'en'] as const

/** A locale identifier supported by Blue. */
export type BlueLocaleId = typeof BLUE_LOCALE_IDS[number]

/** Explicit preference; absence means follow the current system locale. */
export type BlueLocalePreference = BlueLocaleId | undefined

/** One namespace's messages for both shipped locales. */
export interface BlueLocaleCatalog {
  /** Simplified Chinese messages. */
  readonly zh: Readonly<Record<string, string>>
  /** English source and fallback messages. */
  readonly en: Readonly<Record<string, string>>
}

/** Snapshot emitted after the effective locale changes. */
export interface BlueLocaleSnapshot {
  /** Effective locale used for lookup. */
  readonly locale: BlueLocaleId
  /** Explicit persisted preference, absent while following the system. */
  readonly preference: BlueLocalePreference
  /** Monotonic revision for renderer refresh coalescing. */
  readonly revision: number
}

/** Values interpolated into `{name}` message placeholders. */
export type BlueLocaleValues = Readonly<Record<string, string | number>>

/** Namespace-bound translation function. */
export type BlueTranslate = (key: string, values?: BlueLocaleValues) => string

/** Options for {@link BlueLocaleService}. */
export interface BlueLocaleServiceOptions {
  /** Locale resolved from the process environment. */
  readonly systemLocale?: BlueLocaleId
  /** Initial explicit preference. */
  readonly preference?: BlueLocaleId
}

/** Renderer-neutral locale registry scoped to one frontend tree. */
export class BlueLocaleService extends Service {
  private readonly catalogs = new Map<string, BlueLocaleCatalog>()
  private readonly listeners = new Set<(snapshot: BlueLocaleSnapshot) => void>()
  private readonly systemLocale: BlueLocaleId
  private explicitPreference: BlueLocalePreference
  private currentRevision = 0

  /**
   * Create the tree-scoped locale service.
   * @param ctx - owning Cordis context.
   * @param options - resolved system locale and optional preference.
   */
  constructor(ctx: Context, options: BlueLocaleServiceOptions = {}) {
    super(ctx, 'blueLocale')
    this.systemLocale = options.systemLocale ?? 'en'
    this.explicitPreference = options.preference
  }

  /** Effective locale after applying the explicit preference. */
  get locale(): BlueLocaleId {
    return this.explicitPreference ?? this.systemLocale
  }

  /** Explicit persisted preference, absent while following the system. */
  get preference(): BlueLocalePreference {
    return this.explicitPreference
  }

  /** Current immutable service snapshot. */
  get snapshot(): BlueLocaleSnapshot {
    return Object.freeze({
      locale: this.locale,
      preference: this.preference,
      revision: this.currentRevision,
    })
  }

  /**
   * Apply a persisted preference and notify only when effective state moved.
   * @param preference - explicit locale, or undefined to follow the system.
   * @returns whether the locale snapshot changed.
   */
  setPreference(preference: BlueLocalePreference): boolean {
    if (preference === this.explicitPreference) return false
    this.explicitPreference = preference
    this.currentRevision += 1
    this.emit()
    return true
  }

  /**
   * Register one package-owned dictionary namespace.
   * @param namespace - stable dictionary namespace.
   * @param catalog - English and Simplified Chinese messages.
   * @returns idempotent registration disposer.
   */
  register(namespace: string, catalog: BlueLocaleCatalog): () => void {
    if (this.catalogs.has(namespace)) {
      throw new Error(`locale namespace "${namespace}" is already registered`)
    }
    const frozen = Object.freeze({
      zh: Object.freeze({ ...catalog.zh }),
      en: Object.freeze({ ...catalog.en }),
    })
    this.catalogs.set(namespace, frozen)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.catalogs.delete(namespace)
    }
  }

  /**
   * Bind a translator that follows later locale switches.
   * @param namespace - package dictionary namespace.
   * @returns stable translation function.
   */
  bind(namespace: string): BlueTranslate {
    return (key, values) => this.translate(namespace, key, values)
  }

  /**
   * Resolve one message through namespace/common and English fallbacks.
   * @param namespace - package dictionary namespace.
   * @param key - message key.
   * @param values - optional placeholder values.
   * @returns resolved and interpolated message, or the key when absent.
   */
  translate(namespace: string, key: string, values?: BlueLocaleValues): string {
    const locale = this.locale
    const own = this.catalogs.get(namespace)
    const common = this.catalogs.get('common')
    const message = own?.[locale][key]
      ?? own?.en[key]
      ?? common?.[locale][key]
      ?? common?.en[key]
      ?? key
    if (values === undefined) return message
    return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (placeholder, name: string) => {
      const value = values[name]
      return value === undefined ? placeholder : String(value)
    })
  }

  /**
   * Subscribe to preference/effective-locale changes.
   * @param listener - snapshot listener, called immediately.
   * @returns subscription disposer.
   */
  subscribe(listener: (snapshot: BlueLocaleSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  /** Release dictionaries and listeners owned by this frontend tree. */
  dispose(): void {
    this.catalogs.clear()
    this.listeners.clear()
  }

  /** Notify current listeners with one immutable snapshot. */
  private emit(): void {
    const snapshot = this.snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}
