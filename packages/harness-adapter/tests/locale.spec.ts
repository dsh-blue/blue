import { Context } from '@deepseek-ai/cordis'
import {
  LOCALE_IDS as HARNESS_LOCALE_IDS,
  LOCALE_PREFERENCE_FIELD as HARNESS_LOCALE_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE as HARNESS_LOCALE_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-client-locale'
import type {} from '@deepseek-ai/dsh-settings'
import SettingsProvider, { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
import { BLUE_LOCALE_IDS } from '../../frontend/src/locale.ts'
import {
  apply,
  detectSystemLocale,
  LocaleSettingsSchema,
  LOCALE_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE,
  name,
  normalizeSystemLocale,
} from '../src/locale.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  constructor(ctx: Context, private readonly document: Record<string, unknown>) { super(ctx) }
  protected async load(): Promise<Record<string, unknown>> { return this.document }
  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> { this.document[String(ns)] = section }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

describe('locale environment resolution', () => {
  it('normalizes Chinese variants and defaults unsupported or invalid locales to English', () => {
    expect(normalizeSystemLocale('zh_CN.UTF-8')).toBe('zh')
    expect(normalizeSystemLocale('zh-Hant-TW@calendar')).toBe('zh')
    expect(normalizeSystemLocale('en_US.UTF-8')).toBe('en')
    expect(normalizeSystemLocale('C')).toBe('en')
    expect(normalizeSystemLocale('POSIX')).toBe('en')
    expect(normalizeSystemLocale('')).toBe('en')
    expect(normalizeSystemLocale(undefined)).toBe('en')
  })

  it('uses LC_ALL, LC_MESSAGES, LANG, then Intl precedence', () => {
    expect(detectSystemLocale({ LC_ALL: 'en', LC_MESSAGES: 'zh_CN', LANG: 'zh_CN' }, 'zh')).toBe('en')
    expect(detectSystemLocale({ LC_MESSAGES: 'zh_CN', LANG: 'en' }, 'en')).toBe('zh')
    expect(detectSystemLocale({ LANG: 'zh_CN' }, 'en')).toBe('zh')
    expect(detectSystemLocale({}, 'zh-CN')).toBe('zh')
  })
})

describe('Harness locale settings adapter', () => {
  it('drifts red if the official wire constants or locale set change', () => {
    expect(name).toBe('blue-locale')
    expect(BLUE_LOCALE_IDS).toEqual(HARNESS_LOCALE_IDS)
    expect(LOCALE_SETTINGS_NAMESPACE).toBe(HARNESS_LOCALE_SETTINGS_NAMESPACE)
    expect(LOCALE_PREFERENCE_FIELD).toBe(HARNESS_LOCALE_PREFERENCE_FIELD)
    expect(LocaleSettingsSchema({})).toEqual({})
    expect(LocaleSettingsSchema({ preference: 'zh' })).toEqual({ preference: 'zh' })
    expect(() => LocaleSettingsSchema({ preference: 'fr' })).toThrow()
  })

  it('follows the environment without settings and binds live persisted updates', async () => {
    vi.stubEnv('LC_ALL', 'zh_CN.UTF-8')
    const ctx = new Context()
    const localeFiber = await ctx.plugin({ name, apply })
    expect(ctx.blueLocale.snapshot).toMatchObject({ locale: 'zh', preference: undefined, revision: 0 })
    await ctx.plugin(MemorySettings, { locale: { preference: 'en' } })
    await settle()
    expect(ctx.blueLocale.snapshot).toMatchObject({ locale: 'en', preference: 'en' })
    ctx.emit('settings/updated', settingsNamespace('blue'), {}, {}, 'update')
    expect(ctx.blueLocale.preference).toBe('en')
    await ctx.settings.update(settingsNamespace('locale'), { preference: 'zh' })
    await settle()
    expect(ctx.blueLocale.snapshot).toMatchObject({ locale: 'zh', preference: 'zh' })
    await ctx.settings.mutate(settingsNamespace('locale'), [{ op: 'unset', path: ['preference'] }])
    await settle()
    expect(ctx.blueLocale.snapshot).toMatchObject({ locale: 'zh', preference: undefined })
    await localeFiber.dispose()
    expect(ctx.get('blueLocale')).toBeUndefined()
    vi.unstubAllEnvs()
  })

  it('returns to the system locale across settings unload and reload', async () => {
    vi.stubEnv('LC_ALL', 'en_US.UTF-8')
    const ctx = new Context()
    const localeFiber = await ctx.plugin({ name, apply })
    const first = await ctx.plugin(MemorySettings, { locale: { preference: 'zh' } })
    await settle()
    expect(ctx.blueLocale.locale).toBe('zh')
    expect(() => ctx.settings.register(settingsNamespace('locale'), LocaleSettingsSchema)).toThrow(/already registered/u)
    await first.dispose()
    await settle()
    expect(ctx.blueLocale.snapshot).toMatchObject({ locale: 'en', preference: undefined })
    const second = await ctx.plugin(MemorySettings, { locale: { preference: 'zh' } })
    await settle()
    expect(ctx.blueLocale.locale).toBe('zh')
    await second.dispose()
    await localeFiber.dispose()
    vi.unstubAllEnvs()
  })
})
