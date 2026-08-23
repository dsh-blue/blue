/**
 * The Blue app's command-line provider: it parses the optional `[task]`
 * positional and `--resume <id>`, then publishes {@link BLUE_STARTUP_SERVICE}.
 * The app driver is an ordinary consumer whose lazy config waits for that
 * service, so `--help` and parse errors leave the whole UI pending.
 * @module @dsh-blue/blue-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'blue-startup'

/** Services required before the launch values can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the Blue app driver. */
export const BLUE_STARTUP_SERVICE = 'blueStartup'

/** What the app driver row reads from {@link BLUE_STARTUP_SERVICE}. */
export interface BlueStartupValues {
  /** The task text to send immediately after startup, when given. */
  task?: string
  /** The persisted session id to resume instead of creating one, when given. */
  resume?: string
}

/**
 * This app's command: the optional task positional, the resume option, and
 * the help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function blueCommand(): Command {
  return new Command()
    .name('dsh --profile blue')
    .description('Open the Blue interactive terminal UI.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'an optional task sent immediately; multiple words are joined by spaces')
    .option('--resume <id>', 'resume a persisted session instead of creating one')
    .addHelpText('after', `
Examples:
  dsh --profile blue                    open the interactive UI
  dsh --profile blue "fix the build"    open the UI and send a task first
  dsh --profile blue --resume abc123    resume session abc123
`)
}

/**
 * Parse and provide the launch values as an ordinary Cordis service. The
 * command's action publishes them; both fields are optional because an
 * interactive invocation needs neither. On `--help` or a parse rejection the
 * action never runs, so nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = blueCommand()
  program.action(() => {
    const task = program.args.join(' ')
    const { resume } = program.opts<{ resume?: string }>()
    ctx.provide(BLUE_STARTUP_SERVICE, {
      ...task.trim() === '' ? {} : { task },
      ...resume === undefined ? {} : { resume },
    } satisfies BlueStartupValues)
  })
  parseCmdline(ctx, program)
}
