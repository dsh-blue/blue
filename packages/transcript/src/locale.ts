/**
 * Transcript-owned locale catalogs and lifecycle helpers. Each sub-surface
 * owns its namespace so optional bundle rows can load and unload without a
 * hidden dependency on the transcript root.
 *
 * @module @dsh-blue/blue-transcript/locale
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  interpolateLocaleMessage,
  type BlueLocaleCatalog,
  type BlueLocaleSnapshot,
  type BlueTranslate,
} from '@dsh-blue/blue-frontend'

const identityCatalog = (zh: Readonly<Record<string, string>>): BlueLocaleCatalog => Object.freeze({
  en: Object.freeze(Object.fromEntries(Object.keys(zh).map(key => [key, key]))),
  zh: Object.freeze(zh),
})

/** Welcome-banner copy. */
export const BANNER_LOCALE = identityCatalog({
  'Welcome to Blue!': '欢迎使用 Blue！',
  'Send /help for help information.': '输入 /help 查看帮助信息。',
  'Directory: ': '目录：     ',
  'Model:     ': '模型：     ',
  'Version:   ': '版本：     ',
})

/** Transcript renderer chrome. */
export const TRANSCRIPT_LOCALE = identityCatalog({
  'Toggle detail expansion (tool output, long messages)': '切换详细内容展开状态（工具输出、长消息）',
  '... ({remaining} more lines, {total} total, ctrl+o to expand)': '...（还有 {remaining} 行，共 {total} 行，按 Ctrl-O 展开）',
  '[image]': '[图片]',
  '■ interrupted': '■ 已中断',
})

/** Activity-pane copy. */
export const ACTIVITY_LOCALE = identityCatalog({
  ' · Tip: ': ' · 提示：',
  ' working...': ' 工作中...',
})

/**
 * Register one catalog whenever a locale provider is active.
 * @param ctx - frontend-tree context.
 * @param namespace - package-owned namespace.
 * @param catalog - localized messages.
 */
export function mountTranscriptLocale(ctx: Context, namespace: string, catalog: BlueLocaleCatalog): void {
  ctx.inject(['blueLocale'], (localeCtx) => {
    localeCtx.effect(() => localeCtx.blueLocale.register(namespace, catalog))
  })
}

/**
 * Resolve the current locale service for every translation call.
 * @param ctx - frontend-tree context.
 * @param namespace - package-owned namespace.
 * @returns dynamic translator with interpolated English fallback.
 */
export function transcriptTranslator(ctx: Context, namespace: string): BlueTranslate {
  return (key, values) => ctx.get('blueLocale')?.translate(namespace, key, values)
    ?? interpolateLocaleMessage(key, values)
}

/**
 * Observe locale revisions across provider activation, unload, and reload.
 * An undefined snapshot marks the provider gap where translators fall back
 * to English.
 * @param ctx - owner context.
 * @param listener - presentation invalidation callback.
 * @returns synchronous subscription disposer.
 */
export function observeTranscriptLocale(
  ctx: Context,
  listener: (snapshot: BlueLocaleSnapshot | undefined) => void,
): () => void {
  let disposed = false
  let offCurrent: () => void = () => {}
  const current = ctx.get('blueLocale')
  if (current !== undefined) offCurrent = current.subscribe(listener)
  const fiber = ctx.inject(['blueLocale'], (localeCtx) => {
    /* v8 ignore next -- disposing the injected Fiber prevents late activation; this is a defensive fence. */
    if (disposed) return
    offCurrent()
    const off = localeCtx.blueLocale.subscribe(listener)
    offCurrent = off
    localeCtx.effect(() => () => {
      off()
      /* v8 ignore next -- Cordis forbids overlapping providers and serializes unload before replacement activation. */
      if (offCurrent !== off) return
      offCurrent = () => {}
      if (!disposed) listener(undefined)
    })
  })
  return () => {
    if (disposed) return
    disposed = true
    offCurrent()
    void fiber.dispose()
  }
}
