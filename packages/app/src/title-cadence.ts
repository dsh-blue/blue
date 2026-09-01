/**
 * App-owned session-title all-prompts cadence. Raw Session and SessionEvent
 * values remain inside blue-app.
 *
 * @module @dsh-blue/blue-app/title-cadence
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'

interface TitleRefreshing {
  refresh(session: Session, signal?: AbortSignal): Promise<unknown>
}

/**
 * Refresh the active session title after each direct human message once a
 * request route exists.
 * @param ctx - the app plugin context.
 * @param currentSession - resolves the currently committed Harness session.
 * @returns a disposer for the listener and pending refreshes.
 */
export function installSessionTitleCadence(
  ctx: Context,
  currentSession: () => Session | undefined,
): () => void {
  const controller = new AbortController()
  let disposed = false
  const offEvent = ctx.on('session/event', (session, event) => {
    if (session !== currentSession()) return
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
    if (session.requestHeader() === undefined) return
    const service = ctx.get('sessionTitle') as TitleRefreshing | undefined
    if (service === undefined) return
    queueMicrotask(() => {
      if (disposed || session !== currentSession()) return
      void service.refresh(session, controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) ctx.logger.warn(`session title refresh failed: ${String(error)}`)
      })
    })
  })
  return () => {
    if (disposed) return
    disposed = true
    controller.abort()
    offEvent()
  }
}
