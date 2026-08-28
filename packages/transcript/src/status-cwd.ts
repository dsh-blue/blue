/**
 * `blue-status-cwd` plugin: enhancement footer entry showing the session's
 * working directory, home-shortened and abbreviated to its last three
 * segments on deep paths (the kimi `shortenCwd` port) in the `muted` tier at
 * priority 5. The cwd comes from the app-owned current-session snapshot and
 * falls back to `process.cwd()`. An empty path renders '' and occupies nothing.
 *
 * @module @dsh-blue/blue-transcript/status-cwd
 */

import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type { BlueStatusEntry } from './status-model.ts'
import type { SessionFactsService } from './session-facts.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-cwd'

/** Services required before the cwd entry can register. */
export const inject = ['blueStatusEntries', 'blueSessionFacts']

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
 * Register the cwd entry. Recomputes on current-session snapshot changes; a
 * redraw is requested only when the rendered text actually changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const facts = ctx.get('blueSessionFacts') as SessionFactsService | undefined
  let text = shortenCwd(facts?.currentSession?.cwd ?? process.cwd(), homedir())

  const offSession = facts?.subscribeSession((session) => {
    const next = shortenCwd(session?.cwd ?? process.cwd(), homedir())
    if (next === text) return
    text = next
    ctx.blueStatusEntries.refresh('blue.status.cwd')
  })
  ctx.effect(() => () => offSession?.())

  const model = (): BlueStatusEntry => ({ id: 'blue.status.cwd', priority: 5, node: { kind: 'text', content: text, tone: 'muted' }, visible: text !== '' })
  ctx.effect(() => ctx.blueStatusEntries.register(model))
}
