/** Core-private contextual hint locale lifecycle. */
import { Context } from '@deepseek-ai/cordis'
import { BlueLocaleService } from '../../frontend/src/locale.ts'
import { describe, expect, it, vi } from 'vitest'
import {
  contextHintTranslator,
  mountContextHintLocale,
} from '../src/context-hint-locale.ts'

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function localePlugin(systemLocale: 'en' | 'zh') {
  return {
    name: `core-context-hint-locale-${systemLocale}`,
    apply(ctx: Context) {
      const service = new BlueLocaleService(ctx, { systemLocale })
      ctx.effect(() => () => service.dispose())
    },
  }
}

describe('context hint locale lifecycle', () => {
  it('falls back to English keys and interpolation without a provider', () => {
    const t = contextHintTranslator(new Context())
    expect(t('run')).toBe('run')
    expect(t('run {count}', { count: 2 })).toBe('run 2')
  })

  it('registers with each provider lifetime and repaints on locale changes', async () => {
    const ctx = new Context()
    const repaint = vi.fn()
    mountContextHintLocale(ctx, repaint)
    const t = contextHintTranslator(ctx)

    const first = await ctx.plugin(localePlugin('zh'))
    await settle()
    expect(t('run')).toBe('执行')
    const before = repaint.mock.calls.length
    ctx.blueLocale.setPreference('en')
    expect(t('run')).toBe('run')
    expect(repaint.mock.calls.length).toBeGreaterThan(before)

    await first.dispose()
    expect(t('run')).toBe('run')

    const second = await ctx.plugin(localePlugin('zh'))
    await settle()
    expect(t('close')).toBe('关闭')
    await second.dispose()
  })
})
