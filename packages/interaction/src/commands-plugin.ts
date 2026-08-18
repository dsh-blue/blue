/**
 * `blue-commands` plugin: the built-in slash commands. `/quit` requests
 * process exit through the launcher-owned `ctx.appExit`; `/resume <id>`
 * emits `blue/request-resume` for the app layer to perform the resume;
 * `/theme` swaps the live theme provider (see `./theme-switch.ts`).
 * Registrations are effect-bound, so unloading the fiber removes them.
 *
 * @module @deepseek-ai/dsh-blue-interaction/commands-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the app-owned `'blue/request-resume'` Events merge.
import type {} from '@deepseek-ai/dsh-blue-app'
import { registerThemeCommand } from './theme-switch.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-commands'
/** Services required before the commands can register. */
export const inject = ['commands']

/**
 * Register the built-in commands on `ctx.commands`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const quit = ctx.commands.register({
      name: 'quit',
      description: 'Exit Blue',
      handler: () => {
        // `appExit` is a launcher-provided host value declared by
        // `@deepseek-ai/dsh-cmdline`; read through the store since it is
        // optional and never an injected dependency.
        const exit = ctx.get('appExit')
        if (exit === undefined) {
          return { kind: 'error' as const, text: 'exit is unavailable: the launcher provided no appExit hook' }
        }
        exit(0)
        return { kind: 'success' as const }
      },
    })
    const resume = ctx.commands.register({
      name: 'resume',
      description: 'Resume a previous session',
      input: { hint: '<session-id>' },
      handler: (invocation) => {
        const sessionId = invocation.rawInput.trim()
        if (sessionId.length === 0) {
          return { kind: 'error' as const, text: 'usage: /resume <session-id>' }
        }
        ctx.emit('blue/request-resume', sessionId)
        return { kind: 'success' as const, text: `resuming session ${sessionId}` }
      },
    })
    const theme = registerThemeCommand(ctx)
    return () => {
      quit()
      resume()
      theme()
    }
  })
}
