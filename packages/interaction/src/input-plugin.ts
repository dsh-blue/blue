/**
 * `blue-input` plugin: the bottom input editor. Submit dispatches a slash
 * command through `ctx.commands` when the line parses as one, otherwise
 * queues the text as a user follow-up message on the current agent (the
 * harness inbox queues it when the agent is running). Slash-prefixed input
 * shows a discovery hint from the command registry.
 *
 * @module @deepseek-ai/dsh-blue-interaction/input-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import { parseCommand } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { BlueInput } from './editor.ts'
import { currentBlueAgent } from './session.ts'

/** Slash-command hint rows shown at once. */
const MAX_HINT_COMMANDS = 3

/** Stable Cordis plugin name. */
export const name = 'blue-input'
/** Services required before the editor can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap', 'commands']

/**
 * Mount the input editor at the root of the component tree and focus it;
 * both revert when the plugin's fiber unloads.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const screen = ctx.blueScreen
  const colors = ctx.blueTheme.colors
  /** One-shot notice shown in the hint line until the next edit. */
  let notice: string | undefined

  const input = new BlueInput({
    keymap: ctx.blueKeymap,
    theme: ctx.blueTheme,
    hint: () => notice ?? slashHint(),
    onChange: () => {
      notice = undefined
    },
    onSubmit: (value) => {
      submit(value)
    },
  })

  /** Matching-command hint for slash-prefixed input. */
  function slashHint(): string | undefined {
    const value = input.getValue()
    if (!value.startsWith('/')) return undefined
    const parsed = parseCommand(value)
    // A bare slash cannot parse (parseCommand requires a leading letter) but
    // is exactly the discovery affordance: list every registered command.
    if (parsed === undefined && value !== '/') return undefined
    const agent = currentBlueAgent(ctx)
    if (agent === undefined) return undefined
    const prefix = parsed?.name ?? ''
    const matches = ctx.commands.list(agent)
      .filter(command => command.name.startsWith(prefix))
    if (matches.length === 0) return `no matching command: /${prefix}`
    return matches.slice(0, MAX_HINT_COMMANDS)
      .map(command => `/${command.name} — ${command.description}`)
      .join('  ')
  }

  /** Flash a notice in the hint line. */
  function setNotice(text: string): void {
    notice = text
    screen.requestRender()
  }

  /** Route one submitted line to the command registry or the agent. */
  function submit(value: string): void {
    const line = value.trim()
    input.setValue('')
    notice = undefined
    if (line.length === 0) return
    const agent = currentBlueAgent(ctx)
    if (agent === undefined) {
      setNotice('no active session')
      return
    }
    if (parseCommand(line) === undefined) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: line }],
        source: { kind: 'user' },
      }))
      return
    }
    void ctx.commands.execute(agent, line, new AbortController().signal).then(
      (execution) => {
        if (execution === undefined) setNotice(`unknown command: ${line}`)
        else if (execution.result.kind === 'error') setNotice(colors.error(execution.result.text))
        else if (execution.result.text !== undefined) setNotice(execution.result.text)
      },
      (error: unknown) => {
        /* v8 ignore next -- execute() normalizes handler rejections to Error before this rejection handler runs */
        setNotice(colors.error(error instanceof Error ? error.message : String(error)))
      },
    )
  }

  ctx.effect(() => {
    // Pin below the transcript: pi-tui renders root children in mount order,
    // and transcript components only appear once a session exists.
    const remove = screen.addBottomChild(input)
    screen.setFocus(input)
    return () => {
      remove()
      screen.setFocus(null)
    }
  })
}
