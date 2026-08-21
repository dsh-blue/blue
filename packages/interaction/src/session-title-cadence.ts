/**
 * `blue-session-title-cadence` plugin: the all-prompts bridge (D41). The
 * harness session-title service schedules its `all-prompts` cadence from
 * two triggers — the `request/header` event, logged once for a session's
 * first request, and every main LLM request whose route matches the logged
 * header (`onMainRequest`). dsh-agent-loop logs `step/start` before the
 * turn's `user/message`, so `onMainRequest`'s boundary gate
 * (`boundary.seq <= pending.throughSeq`) rejects the very message that
 * opened the turn, and from the second message on the cadence is inert:
 * the title stays at the first derivation (observed live — a four-message
 * session carried exactly one title request, `messageSeqs [7]`).
 *
 * The bridge restores the intended behavior through the public service
 * API: on every human message of the current session, once a request
 * header exists, call `sessionTitle.refresh(session)` — the explicit
 * re-derivation over ALL logged human messages (the all-prompts provider's
 * selector), which supersedes any in-flight generation, so rapid messages
 * collapse to the last one. Before the first header the service's own
 * header path owns the derivation, and a header-less refresh would fail
 * for lack of a route AND cancel that path by superseding its pending —
 * so the bridge stays out. `refresh` runs the provider with the logged
 * header's route. Nothing is injected: `blueSession` and `sessionTitle`
 * resolve lazily through `ctx.get` (the `/theme` fiber-dispose trap), and
 * the service is read through a structural interface so this package
 * carries no harness session-title dependency.
 *
 * @module @dsh-blue/blue-interaction/session-title-cadence
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-session-title-cadence'

/**
 * The slice of the harness `sessionTitle` service this bridge drives: the
 * explicit refresh. Structural, so the package carries no dependency on
 * the service's own package.
 */
interface TitleRefreshing {
  refresh(session: Session, signal?: AbortSignal): Promise<unknown>
}

/**
 * Re-derive the session title on every human message of the current
 * session — the all-prompts cadence the service cannot schedule itself
 * against this agent-loop event order (D41).
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let agent: Agent | undefined = ctx.get('blueSession')?.current ?? undefined

  ctx.on('blue/session-changed', (next) => {
    agent = next ?? undefined
  })

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (agent === undefined || session !== agent.session) return
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
    // Before the first request header the service's own header path owns
    // the derivation; a header-less refresh would fail for lack of a route
    // and supersede that path's pending work.
    if (session.requestHeader() === undefined) return
    const service = ctx.get('sessionTitle') as TitleRefreshing | undefined
    if (service === undefined) return
    // The observer runs inside `session.append`; the refresh itself
    // appends, so it must leave that stack first (the queueMicrotask
    // discipline).
    queueMicrotask(() => {
      service.refresh(session).catch((error: unknown) => {
        ctx.logger.warn(`session title refresh failed: ${String(error)}`)
      })
    })
  })
}
