/**
 * `blue-status-cwd` plugin: enhancement footer entry showing the session's
 * working directory, home-shortened and abbreviated to its last three
 * segments on deep paths (the kimi `shortenCwd` port) in the `muted` tier at
 * priority 5 — between the model (0) and the git badge (10), the kimi slot
 * order. The cwd comes from the current session's durable header
 * (`header.cwd`), falling back to `process.cwd()`, re-read on every
 * `'blue/session-changed'` — same source and refresh discipline as
 * `blue-status-git`. An empty path renders '' and occupies nothing.
 *
 * @module @deepseek-ai/dsh-blue-transcript/status-cwd
 */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@deepseek-ai/dsh-blue-app'
// The named import also carries this package's `blueStatus` Context merge.
import type { BlueStatusEntry } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-cwd'

/** Services required before the cwd entry can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']

/** How many trailing path segments a deep cwd keeps. */
const MAX_CWD_SEGMENTS = 3

/**
 * Abbreviate a working directory for the footer: `~` for the home directory
 * itself, `~` + the rest under home, and once more than
 * {@link MAX_CWD_SEGMENTS} segments remain, everything above the last three
 * collapses to a leading `…`.
 * @param path - the working directory.
 * @param home - the home directory to shorten against.
 * @returns the abbreviated cwd; `path` unchanged when empty or shallow.
 */
export function shortenCwd(path: string, home: string): string {
  if (path === '') return path
  let work = path
  if (home !== '' && path === home) return '~'
  if (home !== '' && path.startsWith(home + '/')) {
    work = '~' + path.slice(home.length)
  }

  const segments = work.split('/').filter(segment => segment.length > 0)
  if (segments.length <= MAX_CWD_SEGMENTS) return work
  return `…/${segments.slice(-MAX_CWD_SEGMENTS).join('/')}`
}

/**
 * Register the cwd entry. Recomputes the abbreviation on load and on every
 * `'blue/session-changed'`; a redraw is requested only when the rendered
 * text actually changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  let text = shortenCwd(
    ctx.get('blueSession')?.current?.session.header.cwd ?? process.cwd(),
    homedir(),
  )

  ctx.on('blue/session-changed', (agent) => {
    const next = shortenCwd(agent.session.header.cwd ?? process.cwd(), homedir())
    if (next === text) return
    text = next
    screen.requestRender()
  })

  const entry: BlueStatusEntry = {
    id: 'blue.status.cwd',
    priority: 5,
    render(width: number): string {
      if (text === '') return ''
      return colors.muted(components.truncateToWidth(text, width))
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
