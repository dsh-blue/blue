import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { BlueLocaleService, interpolateLocaleMessage } from '../src/locale.ts'

describe('BlueLocaleService', () => {
  it('binds dynamic translators with namespace, English, common, and key fallbacks', () => {
    const service = new BlueLocaleService(new Context(), { systemLocale: 'zh' })
    const disposeCommon = service.register('common', {
      zh: { Cancel: '取消', Shared: '共享' },
      en: { Cancel: 'Cancel', Shared: 'Shared', EnglishOnly: 'English only' },
    })
    const disposePanel = service.register('panel', {
      zh: { Hello: '你好，{name}' },
      en: { Hello: 'Hello, {name}', OwnEnglish: 'Own English' },
    })
    const t = service.bind('panel')
    expect(t('Hello', { name: 'Blue' })).toBe('你好，Blue')
    expect(t('OwnEnglish')).toBe('Own English')
    expect(t('Shared')).toBe('共享')
    expect(t('EnglishOnly')).toBe('English only')
    expect(t('Missing')).toBe('Missing')
    expect(t('Hello', { missing: 1 })).toBe('你好，{name}')
    expect(interpolateLocaleMessage('Hello, {name}', { name: 'Blue' })).toBe('Hello, Blue')
    expect(interpolateLocaleMessage('Hello')).toBe('Hello')
    disposePanel(); disposePanel(); disposeCommon(); disposeCommon(); service.dispose(); service.dispose()
  })

  it('revises preference and catalog changes while isolating frontend trees', () => {
    const first = new BlueLocaleService(new Context(), { systemLocale: 'en' })
    const second = new BlueLocaleService(new Context(), { systemLocale: 'zh' })
    const seen: string[] = []
    const off = first.subscribe(snapshot => seen.push(`${snapshot.locale}:${snapshot.preference ?? 'system'}:${snapshot.revision}`))
    const dispose = first.register('owner', { zh: { Value: '值' }, en: { Value: 'Value' } })
    expect(first.setPreference('zh')).toBe(true)
    expect(first.setPreference('zh')).toBe(false)
    expect(first.setPreference(undefined)).toBe(true)
    dispose()
    expect(first.locale).toBe('en')
    expect(second.locale).toBe('zh')
    expect(seen).toEqual(['en:system:0', 'en:system:1', 'zh:zh:2', 'en:system:3', 'en:system:4'])
    off(); first.setPreference('zh'); expect(seen).toHaveLength(5)
    first.dispose(); second.dispose()
  })

  it('rejects duplicate or late namespaces and makes retained handles inert', () => {
    const service = new BlueLocaleService(new Context())
    const catalog = { zh: {}, en: { Value: 'value' } }
    const dispose = service.register('owner', catalog)
    expect(() => service.register('owner', catalog)).toThrow(/already registered/u)
    expect(service.translate('owner', 'Value')).toBe('value')
    service.dispose()
    expect(service.setPreference('zh')).toBe(false)
    const off = service.subscribe(() => { throw new Error('should not run') })
    expect(off).toBeTypeOf('function')
    off()
    expect(() => service.register('late', catalog)).toThrow(/disposed/u)
    dispose()
    expect(service.translate('owner', 'Value')).toBe('Value')
  })
})
