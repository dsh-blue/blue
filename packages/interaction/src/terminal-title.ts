/**
 * `blue-terminal-title` plugin: mirrors the session title onto the terminal
 * window/tab title through `blueScreen.setTitle` (the core OSC 0 emitter).
 * The title itself is generated upstream — the harness session-title
 * service derives it from the conversation with an auxiliary model (the
 * Blue bundle runs the all-prompts cadence, so it tracks the latest task)
 * — so this plugin only folds the latest logged title and re-emits:
 *
 * - on load, for a fiber that activates after a session already attached
 *   (the status-basic discipline);
 * - on `'blue/session-changed'` — `/new`, resume, and `/sessions` switches;
 *   a resumed log replays no live events, so the fold over `session.events`
 *   is the only correct source there;
 * - on the current session's events — the `session/title` append runs the
 *   observers synchronously, so an accepted title lands on the terminal
 *   immediately.
 *
 * Emission is deduped: the fold is re-derived cheaply on every event, but
 * an unchanged title writes nothing. No session, no service, or an
 * untitled session falls back to the product name `'blue'` (the kimi
 * PRODUCT_NAME shape); a missing screen silently skips — a plugin fiber
 * waiting on `blueScreen` never races the core plugin that provides it.
 * Nothing is injected beyond the screen: `blueSession` and `sessionTitle`
 * resolve lazily through `ctx.get` (the `/theme` fiber-dispose trap), and
 * the title service is read through a structural interface so this package
 * needs no harness session-title dependency.
 *
 * @module @dsh-blue/blue-interaction/terminal-title
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'

/** The title shown while nothing is attached or titled yet. */
export const PRODUCT_TITLE = 'blue'

/**
 * The slice of the harness `sessionTitle` service this plugin reads: the
 * log fold over a session's events. Structural, so the package carries no
 * dependency on the service's own package.
 */
export interface TitleReading {
  get(session: Session): { title: string } | undefined
}

/** Stable Cordis plugin name. */
export const name = 'blue-terminal-title'

/** The terminal mirror requires the screen; everything else resolves lazily. */
export const inject = ['blueScreen']

/**
 * Derive the title text to mirror: the given session's folded title, or
 * {@link PRODUCT_TITLE} while no agent is attached, the service is absent
 * (a thin host), or the session is not yet titled.
 * @param agent - the tracked current agent (the event-argument discipline:
 *   `'blue/session-changed'` fires after the app moved the ref, so the
 *   plugin's tracked value is the source, not a re-read).
 * @param service - the title service, resolved lazily per derivation.
 * @returns the text for the terminal title.
 */
export function currentTitleText(
  agent: Agent | undefined | null,
  service: TitleReading | undefined,
): string {
  if (agent === undefined || agent === null) return PRODUCT_TITLE
  const title = service?.get(agent.session)?.title
  return title !== undefined && title.length > 0 ? title : PRODUCT_TITLE
}

/**
 * Mirror the session title onto the terminal window title, re-emitting
 * only when the derived text actually changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let agent: Agent | undefined = ctx.get('blueSession')?.current ?? undefined
  let emitted: string | undefined

  const emit = (): void => {
    const next = currentTitleText(agent, ctx.get('sessionTitle') as TitleReading | undefined)
    if (next === emitted) return
    emitted = next
    ctx.blueScreen.setTitle(next)
  }

  emit()
  ctx.on('blue/session-changed', (next) => {
    agent = next
    emit()
  })
  ctx.on('session/event', (session) => {
    if (agent === undefined || session !== agent.session) return
    emit()
  })
}
