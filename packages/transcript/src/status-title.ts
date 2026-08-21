/**
 * `blue-status-title` plugin: the session-title footer entry — the folded
 * title on the footer's second band, left of the context bar (priority 12,
 * the muted tier: ambient identity, not primary status). The title is
 * generated upstream by the harness session-title service (the Blue bundle
 * runs the all-prompts cadence, so it tracks the conversation's latest
 * task); this entry only re-derives the fold — on load (late activation),
 * on `'blue/session-changed'`, and on the current session's events (the
 * status-basic discipline: derive cheaply on every event, redraw only on
 * change). An untitled session renders '' and occupies nothing, so a
 * fresh session shows no empty slot; a thin host without the service
 * behaves the same. `blueSession`/`sessionTitle` resolve lazily through
 * `ctx.get`, and the title service is read through a structural interface
 * so this package needs no harness session-title dependency.
 *
 * @module @dsh-blue/blue-transcript/status-title
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'
// The named import also carries this package's `blueStatus` Context merge.
import type { BlueStatusEntry } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-title'

/** Services required before the title entry can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']

/**
 * The slice of the harness `sessionTitle` service this entry reads: the
 * log fold over a session's events. Structural, so the package carries no
 * dependency on the service's own package.
 */
interface TitleReading {
  get(session: Session): { title: string } | undefined
}

/**
 * Derive the entry's text: the given session's folded title, or '' —
 * which hides the entry — while no agent is attached, the service is
 * absent (a thin host), or the session is not yet titled.
 * @param agent - the tracked current agent (the event-argument discipline
 *   of the status family: `'blue/session-changed'` fires after the app
 *   moved the ref, so the plugin's tracked value is the source).
 * @param service - the title service, resolved lazily per derivation.
 * @returns the title text for the footer, or '' to hide the entry.
 */
function entryText(agent: Agent | undefined | null, service: TitleReading | undefined): string {
  if (agent === undefined || agent === null) return ''
  const title = service?.get(agent.session)?.title
  return title !== undefined && title.length > 0 ? title : ''
}

/**
 * Register the title entry. Re-derives on load and on every session
 * switch or current-session event; a redraw is requested only when the
 * rendered text actually changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  let agent: Agent | undefined = ctx.get('blueSession')?.current ?? undefined
  let text = entryText(agent, ctx.get('sessionTitle') as TitleReading | undefined)

  const refresh = (): void => {
    const next = entryText(agent, ctx.get('sessionTitle') as TitleReading | undefined)
    if (next === text) return
    text = next
    screen.requestRender()
  }

  ctx.on('blue/session-changed', (next) => {
    // The app broadcasts the moved ref; a failed `/new` carries null.
    agent = next ?? undefined
    refresh()
  })
  // The accepted-title append runs the session/event observers
  // synchronously, so a freshly derived title redraws immediately.
  ctx.on('session/event', (session) => {
    if (agent === undefined || session !== agent.session) return
    refresh()
  })

  const entry: BlueStatusEntry = {
    id: 'blue.status.title',
    priority: 12,
    row: 2,
    align: 'left',
    render(width: number): string {
      if (text === '') return ''
      return colors.muted(components.truncateToWidth(text, width))
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
