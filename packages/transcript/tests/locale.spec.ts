import { Context } from '@deepseek-ai/cordis'
import { BlueLocaleService } from '@dsh-blue/blue-frontend'
import { describe, expect, it } from 'vitest'
import { BANNER_LOCALE, registerTranscriptLocale, transcriptTranslator } from '../src/locale.ts'

describe('transcript locale helpers', () => {
  it('falls back to interpolated English without the locale runtime', () => {
    const ctx = new Context()
    expect(registerTranscriptLocale(ctx, 'missing', BANNER_LOCALE)).toBeTypeOf('function')
    const t = transcriptTranslator(ctx, 'missing')
    expect(t('value {count}', { count: 2 })).toBe('value 2')
    expect(t('plain')).toBe('plain')
  })

  it('registers package copy and follows active locale changes', () => {
    const ctx = new Context()
    const locale = new BlueLocaleService(ctx, { systemLocale: 'en' })
    const dispose = registerTranscriptLocale(ctx, 'transcript.banner.test', BANNER_LOCALE)
    const t = transcriptTranslator(ctx, 'transcript.banner.test')
    expect(t('Welcome to Blue!')).toBe('Welcome to Blue!')
    locale.setPreference('zh')
    expect(t('Welcome to Blue!')).toBe('欢迎使用 Blue！')
    dispose(); locale.dispose()
  })
})
