/**
 * Transcript-owned locale catalogs. Subpath plugins register independent
 * namespaces so bundle row order and optional plugin loading never create a
 * hidden registration dependency.
 *
 * @module @dsh-blue/blue-transcript/locale
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueLocaleCatalog, BlueTranslate } from '@dsh-blue/blue-frontend'

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
 * Register one transcript sub-surface catalog.
 * @param ctx - frontend-tree context.
 * @param namespace - independent sub-surface namespace.
 * @param catalog - package-owned messages.
 * @returns registration disposer.
 */
export function registerTranscriptLocale(ctx: Context, namespace: string, catalog: BlueLocaleCatalog): () => void {
  return ctx.get('blueLocale')?.register(namespace, catalog) ?? (() => {})
}

/**
 * Bind a dynamic translator with an English fallback.
 * @param ctx - frontend-tree context.
 * @param namespace - registered transcript namespace.
 * @returns translation function.
 */
export function transcriptTranslator(ctx: Context, namespace: string): BlueTranslate {
  return ctx.get('blueLocale')?.bind(namespace) ?? ((key, values) => {
    if (values === undefined) return key
    return key.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (placeholder, name: string) => {
      const value = values[name]
      /* v8 ignore next -- transcript callers supply every literal catalog placeholder */
      return value === undefined ? placeholder : String(value)
    })
  })
}
