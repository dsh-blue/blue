import { Context } from '@deepseek-ai/cordis'
import { BlueLocaleService } from '../../frontend/src/locale.ts'
import { describe, expect, it } from 'vitest'
import {
  interactionTranslator,
  mountInteractionLocale,
  observeInteractionLocale,
} from '../src/locale.ts'

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function localePlugin(systemLocale: 'en' | 'zh') {
  return {
    name: `test-locale-${systemLocale}`,
    apply(ctx: Context) {
      const service = new BlueLocaleService(ctx, { systemLocale })
      ctx.effect(() => () => service.dispose())
    },
  }
}

describe('interaction locale lifecycle', () => {
  it('observes the current provider before the injected observer fiber starts', async () => {
    const ctx = new Context()
    const provider = await ctx.plugin(localePlugin('en'))
    await settle()
    const seen: string[] = []
    const off = observeInteractionLocale(ctx, snapshot => seen.push(snapshot?.locale ?? 'absent'))

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
    const off = observeInteractionLocale(ctx, snapshot => seen.push(snapshot?.locale ?? 'absent'))
    await settle()
    await provider.dispose()
    expect(seen.at(-1)).toBe('absent')
    off()
    off()
  })

  it('falls back to English and follows provider unload and reload', async () => {
    const ctx = new Context()
    mountInteractionLocale(ctx)
    const t = interactionTranslator(ctx)
    const seen: string[] = []
    const off = observeInteractionLocale(ctx, snapshot => seen.push(
      snapshot === undefined ? 'absent' : `${snapshot.locale}:${snapshot.revision}`,
    ))
    expect(t('Language')).toBe('Language')
    expect(t('Question {current} of {total}', { current: 1, total: 2 })).toBe('Question 1 of 2')

    const first = await ctx.plugin(localePlugin('zh'))
    await settle()
    expect(t('Language')).toBe('语言')
    expect(seen.at(-1)?.startsWith('zh:')).toBe(true)
    await first.dispose()
    expect(t('Language')).toBe('Language')
    expect(seen.at(-1)).toBe('absent')

    const second = await ctx.plugin(localePlugin('en'))
    await settle()
    expect(t('Language')).toBe('Language')
    const before = seen.length
    off()
    ctx.blueLocale.setPreference('zh')
    expect(seen).toHaveLength(before)
    await second.dispose()
  })
})
