/**
 * Blue-owned public session-data adapter. The app remains the only
 * Agent/session owner; this bridge attaches scoped read sources to the host.
 *
 * @module @dsh-blue/blue-app/plugin-host-session-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueRegistration } from '@dsh-blue/blue-api'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-session-bridge'

/** App-owned services required before public session capabilities become ready. */
export const inject = ['bluePluginControl', 'blueSessionReader', 'blueSessionProjections']

/** Attach the app-owned session facades for this bridge Fiber's lifetime. */
export function apply(ctx: Context): void {
  ctx.bluePluginControl.attachSessionReader(ctx, ctx.blueSessionReader)
  ctx.bluePluginControl.attachSessionProjections(ctx, {
    currentMany(keys) {
      if (ctx.blueSessionReader.current() === null) return null
      return ctx.blueSessionProjections.currentMany(keys)
    },
    subscribe(listener) {
      const off = ctx.blueSessionProjections.subscribe(listener)
      let disposed = false
      const registration: BlueRegistration = {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          off()
        },
      }
      return registration
    },
  })
}
