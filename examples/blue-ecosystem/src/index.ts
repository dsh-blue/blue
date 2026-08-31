/**
 * Empty runtime entry for the opt-in ecosystem composition bundle.
 * The seven plugin Fibers are mounted exclusively by cordis.patch.yml.
 *
 * @module @dsh-blue-example/blue-ecosystem
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = '@dsh-blue-example/blue-ecosystem'

/** Bind the otherwise empty bundle entry to its Cordis Fiber. */
export function apply(ctx: Context): void {
  ctx.effect(() => () => {})
}
