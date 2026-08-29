import { Context } from '@deepseek-ai/cordis'
import { BlueLocaleService } from '../../frontend/src/locale.ts'
import { describe, expect, it } from 'vitest'
import {
  BANNER_LOCALE,
  mountTranscriptLocale,
  observeTranscriptLocale,
  transcriptTranslator,
} from '../src/locale.ts'

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function localePlugin(systemLocale: 'en' | 'zh') {
  return {
    name: `transcript-locale-${systemLocale}`,
    apply(ctx: Context) {
      const service = new BlueLocaleService(ctx, { systemLocale })
      ctx.effect(() => () => service.dispose())
    },
  }
}

describe('transcript locale lifecycle', () => {
  it('falls back to interpolated English without a locale provider', () => {
    const ctx = new Context()
    mountTranscriptLocale(ctx, 'transcript.banner.test', BANNER_LOCALE)
    const t = transcriptTranslator(ctx, 'transcript.banner.test')
    expect(t('value {count}', { count: 2 })).toBe('value 2')
    expect(t('plain')).toBe('plain')
  })

  it('observes the current provider before the injected observer fiber starts', async () => {
    const ctx = new Context()
    const provider = await ctx.plugin(localePlugin('en'))
    await settle()
    const seen: string[] = []
    const off = observeTranscriptLocale(ctx, snapshot => seen.push(snapshot?.locale ?? 'absent'))

    ctx.blueLocale.setPreference('zh')
    expect(seen.at(-1)).toBe('zh')

    off()
    await provider.dispose()
  })

  it('disposes idempotently after a provider gap', async () => {
    const ctx = new Context()
    const provider = await ctx.plugin(localePlugin('en'))
    await settle()
    const seen: string[] = []
    const off = observeTranscriptLocale(ctx, snapshot => seen.push(snapshot?.locale ?? 'absent'))
    await settle()
    await provider.dispose()
    expect(seen.at(-1)).toBe('absent')
    off()
    off()
  })

  it('registers package copy and follows provider unload and reload', async () => {
    const ctx = new Context()
    mountTranscriptLocale(ctx, 'transcript.banner.test', BANNER_LOCALE)
    const t = transcriptTranslator(ctx, 'transcript.banner.test')
    const seen: string[] = []
    const off = observeTranscriptLocale(ctx, snapshot => seen.push(
      snapshot === undefined ? 'absent' : `${snapshot.locale}:${snapshot.revision}`,
    ))

    const first = await ctx.plugin(localePlugin('zh'))
    await settle()
    expect(t('Welcome to Blue!')).toBe('欢迎使用 Blue！')
    expect(seen.at(-1)?.startsWith('zh:')).toBe(true)
    await first.dispose()
    expect(t('Welcome to Blue!')).toBe('Welcome to Blue!')
    expect(seen.at(-1)).toBe('absent')

    const second = await ctx.plugin(localePlugin('en'))
    await settle()
    expect(t('Welcome to Blue!')).toBe('Welcome to Blue!')
    const before = seen.length
    off()
    ctx.blueLocale.setPreference('zh')
    expect(seen).toHaveLength(before)
    await second.dispose()
  })
})
