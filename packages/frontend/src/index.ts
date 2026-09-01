/** Renderer-neutral Blue frontend services and models.
 * @module @dsh-blue/blue-frontend
 */
import type { Context } from '@deepseek-ai/cordis'
import { BlueLocaleService } from './locale.ts'

export * from './models.ts'
export * from './theme.ts'
export * from './notification.ts'
export * from './locale.ts'

export const name = 'blue-frontend'

/** Mount Blue's ordinary frontend-tree locale service. */
export function apply(ctx: Context): void {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const service = new BlueLocaleService(ctx, { systemLocale: locale })
  ctx.effect(() => () => service.dispose())
}
