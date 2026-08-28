/**
 * Blue-owned public session adapter. The app remains the only Agent/session
 * owner; this bridge attaches its readonly reader and narrow requester to the
 * host without exposing the app's broader action service.
 *
 * @module @dsh-blue/blue-app/plugin-host-session-bridge
 */

import { symbols, type Context } from '@deepseek-ai/cordis'
import {
  attachBluePluginHostSessionOwner,
  type BluePluginHostService,
} from '@dsh-blue/blue-api'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-session-bridge'

/** App-owned services required before public session capabilities become ready. */
export const inject = ['bluePluginHost', 'blueSessionReader', 'blueSessionRequester']

/** Attach the app-owned session facades for this bridge Fiber's lifetime. */
export function apply(ctx: Context): void {
  const host = (ctx.bluePluginHost as unknown as Record<symbol, BluePluginHostService | undefined>)[symbols.original]
    ?? ctx.bluePluginHost
  attachBluePluginHostSessionOwner(host, ctx, ctx.blueSessionReader, ctx.blueSessionRequester)
}
