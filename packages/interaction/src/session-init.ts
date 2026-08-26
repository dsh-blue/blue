/**
 * The `/init` command: one canned prompt, the kimi registry's `init`
 * spirit — analyze the current codebase and write the findings to
 * `AGENTS.md` in the project root. The prompt goes to the UI's current
 * session through the app-owned follow-up action, so the
 * exploration runs as a normal turn of the live session; the reading side
 * is already upstream (dsh-agent-instructions feeds `AGENTS.md` into later
 * sessions), the command only seeds the writing side. A non-idle agent
 * refuses the invocation — a second canned prompt would interleave with
 * the running turn (the /fork guard's rule; the kimi registry marks `init`
 * idle-only the same way).
 *
 * @module @dsh-blue/blue-interaction/session-init
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

/**
 * The canned exploration prompt `/init` submits as a follow-up turn: the
 * kimi text's spirit (structure, stack, conventions, then one coherent
 * `AGENTS.md` for a reader who knows nothing about the project) in Blue's
 * English UI voice.
 */
const INIT_PROMPT = [
  'Please explore the current project directory and analyze the codebase.',
  '',
  'Specifically:',
  '1. Identify the key configuration files and the technology stack (languages, frameworks, package manager).',
  '2. Understand the build process, the test setup, and how to run them.',
  '3. Map how the code is organized: the main modules and what each owns.',
  '4. Note project-specific development conventions: code style, testing strategy, anything unusual.',
  '',
  'Then write your findings to the AGENTS.md file in the project root, aimed at AI coding agents who know nothing about the project. If AGENTS.md already exists, read it first and carry forward whatever is still accurate — rewrite it into one coherent, up-to-date file rather than appending. Compose it from what you can verify in the repository, without assumptions or generalizations, and write it in the natural language the project\'s own comments and documentation mainly use.',
].join('\n')

/**
 * Register the `/init` command on `ctx.commands`. The handler targets the
 * UI's current agent (not necessarily the dispatching one — the /fork
 * rule) and refuses while it is running.
 * @param ctx - plugin context carrying the command registry.
 * @returns the registration disposer.
 */
export function registerInitCommand(ctx: Context): () => void {
  return ctx.commands.register({
    name: 'init',
    description: 'Analyze the codebase and write AGENTS.md',
    handler: (): CommandResult => {
      const session = ctx.blueSessionReader.current()
      if (session === null) {
        return { kind: 'error', text: 'no active session' }
      }
      if (session.status !== 'idle') {
        return { kind: 'error', text: 'cannot run /init while the agent is running' }
      }
      const submitted = ctx.blueSessionActions.followup([{ type: 'text', text: INIT_PROMPT }])
      if (!submitted.ok) return { kind: 'error', text: submitted.message }
      return { kind: 'success', text: 'analyzing the codebase to write AGENTS.md' }
    },
  })
}
