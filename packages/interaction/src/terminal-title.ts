/**
 * `blue-terminal-title` plugin: mirrors the session title onto the terminal
 * window/tab title through `blueScreen.setTitle` (the core OSC 0 emitter).
 * The title itself is generated upstream — the harness session-title
 * service derives it from the conversation with an auxiliary model (the
 * Blue bundle runs the all-prompts cadence, so it tracks the latest task)
 * — so this plugin mirrors the official `title` session projection through
 * `blueSessionFacts`. It never receives an Agent or folds Harness events.
 *
 * Emission is deduped: the fold is re-derived cheaply on every event, but
 * an unchanged title writes nothing. No session, no service, or an
 * untitled session falls back to the product name `'blue'` (the kimi
 * PRODUCT_NAME shape); a missing screen silently skips — a plugin fiber
 * waiting on `blueScreen` never races the core plugin that provides it.
 * The renderer only receives the projection's readonly string.
 *
 * @module @dsh-blue/blue-interaction/terminal-title
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionFactsService } from '@dsh-blue/blue-transcript'

/** The title shown while nothing is attached or titled yet. */
export const PRODUCT_TITLE = 'blue'

/** Stable Cordis plugin name. */
export const name = 'blue-terminal-title'

/** The terminal mirror requires the screen; everything else resolves lazily. */
export const inject = ['blueScreen', 'blueSessionFacts']

/**
 * Derive the title text to mirror: the given session's folded title, or
 * {@link PRODUCT_TITLE} while no agent is attached, the service is absent
 * (a thin host), or the session is not yet titled.
 * @param title - the current renderer-neutral title fact.
 * @returns the text for the terminal title.
 */
export function currentTitleText(title: string | undefined): string {
  return title !== undefined && title.length > 0 ? title : PRODUCT_TITLE
}

/**
 * Mirror the session title onto the terminal window title, re-emitting
 * only when the derived text actually changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const facts = ctx.get('blueSessionFacts') as SessionFactsService
  let emitted: string | undefined

  const emit = (title: string | undefined): void => {
    const next = currentTitleText(title)
    if (next === emitted) return
    emitted = next
    ctx.blueScreen.setTitle(next)
  }

  const offTitle = facts.subscribeTitle(emit)
  ctx.effect(() => () => offTitle())
}
