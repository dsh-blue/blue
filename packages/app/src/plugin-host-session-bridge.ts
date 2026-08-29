/**
 * Blue-owned public session adapter. The app remains the only Agent/session
 * owner; this bridge attaches only its readonly reader to the public host.
 *
 * @module @dsh-blue/blue-app/plugin-host-session-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-session-bridge'

/** App-owned services required before public session capabilities become ready. */
export const inject = ['bluePluginControl', 'blueSessionReader']

/** Attach the app-owned session facades for this bridge Fiber's lifetime. */
export function apply(ctx: Context): void {
  ctx.bluePluginControl.attachSessionReader(ctx, ctx.blueSessionReader)
}
