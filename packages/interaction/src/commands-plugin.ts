/**
 * `blue-commands` plugin: the built-in slash commands. `/quit` requests
 * process exit through the launcher-owned `ctx.appExit`; `/sessions` lists
 * persisted sessions in a picker overlay, or with an id argument emits
 * `blue/request-resume` directly (`/resume` is its alias — the S24a
 * dogfood ruling: one command, both surfaces); `/new` emits
 * `blue/request-new`, and `/fork` emits `blue/request-fork` for the app
 * layer to perform the switch; `/help` lists
 * the registered commands and key bindings in an overlay; `/theme` swaps
 * the live theme provider (see `./theme-switch.ts`); `/yolo` and the
 * plan/yolo exclusivity wiring live in `./mode-commands.ts`.
 * Registrations are
 * effect-bound, so unloading the fiber removes them. Only `commands` is
 * injected: the overlay commands read the Blue display services through
 * `ctx.get`, because injecting `blueTheme` would make this fiber a theme
 * dependent — `/theme` would then dispose its own handler's fiber mid-swap
 * and the remount would throw on the dead context. The `/sessions` listing
 * await can still span a tree unload, so its continuation gates on the
 * fiber's unload flag before touching the context again.
 *
 * @module @dsh-blue/blue-interaction/commands-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge and
// the `'blue/request-*'` Events merges this plugin emits.
import type {} from '@dsh-blue/blue-app'
// Empty type import carries the `sessionPersistence` Context merge; the
// service itself is optional and resolved lazily.
import type {} from '@deepseek-ai/dsh-session-persistence'
import { aliasesOf, registerCommandAliases } from './command-meta.ts'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import type { HelpSection } from './help.ts'
import { HelpOverlay } from './help.ts'
import { registerModelCommands } from './model-commands.ts'
import { registerModeCommands, setupModeTracking } from './mode-commands.ts'
import { SessionList } from './select.ts'
import { registerThemeCommand } from './theme-switch.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-commands'
/** Services required before the commands can register. */
export const inject = ['commands']

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Format a session creation timestamp as a picker-row date (`YYYY-MM-DD HH:mm`, UTC). */
function formatDate(createdAt: number): string {
  return new Date(createdAt).toISOString().replace('T', ' ').slice(0, 16)
}

/**
 * Register the built-in commands on `ctx.commands`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  /**
   * Set when this fiber unloads: the `/sessions` listing can still be in
   * flight (a tree unload lands between `list()` and the overlay mount),
   * and the continuation must not reach for services through the dead
   * context.
   */
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })

  /**
   * The `/sessions` handler: list persisted sessions newest-first and offer
   * them in a picker overlay; picking another session emits
   * `blue/request-resume`, picking the live one only flashes a notice.
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns the command outcome.
   */
  async function listSessions(signal: AbortSignal): Promise<CommandResult> {
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) {
      return { kind: 'error', text: 'session persistence is unavailable' }
    }
    let headers: SessionHeader[]
    try {
      headers = await persistence.list(signal)
    } catch (error) {
      return { kind: 'error', text: `could not list sessions: ${describe(error)}` }
    }
    if (unloaded) return { kind: 'success' }
    if (headers.length === 0) return { kind: 'success', text: 'no sessions' }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'session picker is unavailable: the Blue screen is not mounted' }
    }
    const currentId = ctx.get('blueSession')?.current?.id
    const sorted = [...headers].sort((a, b) => b.createdAt - a.createdAt)
    const list = new SessionList({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      items: sorted.map(header => ({
        value: String(header.id),
        label: `${header.id} · ${formatDate(header.createdAt)} · ${header.cwd ?? ''}`,
        current: header.id === currentId,
      })),
      title: 'Sessions',
      titleHint: '· esc cancel · ↵ resume',
      onSelect: (item) => {
        restore()
        if (item.value === String(currentId)) {
          getSharedEditor()?.notice?.(display.colors.error('already the current session'))
          return
        }
        ctx.emit('blue/request-resume', item.value)
        getSharedEditor()?.notice?.(`resuming session ${item.value}`)
      },
      onCancel: () => {
        restore()
      },
    })
    // The kimi dialog mount (D30): the panel replaces the editor in its
    // dock slot, so below it only the footer remains — a floating overlay
    // would leave the editor's frame peeking around the panel.
    const restore = mountEditorReplacement(list)
    return { kind: 'success' }
  }

  /**
   * The `/help` handler: the framed, scrollable overlay listing the
   * registered commands and key bindings in two aligned columns; Escape,
   * Enter, or `q` closes it.
   * @param agent - the agent the command was dispatched to.
   * @returns the command outcome.
   */
  function showHelp(agent: Agent): CommandResult {
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'help is unavailable: the Blue screen is not mounted' }
    }
    const sections: HelpSection[] = [
      {
        heading: 'Commands',
        labelPaint: display.colors.primary,
        rows: ctx.commands.list(agent).map(command => {
          // The kimi help-panel label: aliases join the canonical label in
          // slashed parentheses (`/quit (/q, /exit)`), visible on every
          // listing — unlike the dropdown, which shows them only when the
          // query matched one.
          const aliases = aliasesOf(command.name)
          return {
            label: aliases.length === 0
              ? `/${command.name}`
              : `/${command.name} (${aliases.map(alias => `/${alias}`).join(', ')})`,
            description: command.description,
          }
        }),
      },
      {
        heading: 'Keys',
        labelPaint: display.colors.warning,
        rows: display.keymap.list().map(action => ({
          label: [action.keys].flat().join('/'),
          description: action.description ?? action.id,
        })),
      },
    ]
    const overlay = new HelpOverlay({
      theme: display.theme,
      components: display.components,
      keymap: display.keymap,
      sections,
      onClose: () => {
        restore()
      },
    })
    // The kimi dialog mount (D30): the panel replaces the editor in its
    // dock slot, so below it only the footer remains.
    const restore = mountEditorReplacement(overlay)
    return { kind: 'success' }
  }

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
    // The alias relation lives in the command-meta registry (kimi style):
    // `/q` and `/exit` are not separate registrations — the input layer
    // rewrites an alias line to `/quit` before `ctx.commands.execute`, so
    // the session log records the canonical command.
    const quitAliases = registerCommandAliases('quit', ['q', 'exit'])
    const fresh = ctx.commands.register({
      name: 'new',
      description: 'Start a new session',
      handler: () => {
        ctx.emit('blue/request-new')
        return { kind: 'success' as const, text: 'starting a new session' }
      },
    })
    const fork = ctx.commands.register({
      name: 'fork',
      description: 'Fork the current session into a new one',
      handler: () => {
        // The command target is the UI's current session, not necessarily
        // the dispatching agent; the app layer operates on the same value.
        const current = ctx.get('blueSession')?.current
        if (current !== undefined && current !== null && current.status !== 'idle') {
          return { kind: 'error' as const, text: 'cannot fork while the agent is running' }
        }
        ctx.emit('blue/request-fork')
        return { kind: 'success' as const, text: 'forking the current session' }
      },
    })
    const sessions = ctx.commands.register({
      name: 'sessions',
      description: 'List persisted sessions and switch to one (an id resumes directly)',
      input: { hint: '[<session-id>]' },
      handler: (invocation) => {
        // The direct channel the old /resume owned: an id argument skips
        // the picker and asks the app layer to resume that session.
        const sessionId = invocation.rawInput.trim()
        if (sessionId.length === 0) return listSessions(invocation.signal)
        ctx.emit('blue/request-resume', sessionId)
        return { kind: 'success' as const, text: `resuming session ${sessionId}` }
      },
    })
    // `/resume` is the sessions command's alias, not a registration — the
    // input layer rewrites it to `/sessions` (with the id argument intact)
    // before `ctx.commands.execute` (the S24a dogfood ruling: /resume and
    // /sessions were one command wearing two names).
    const sessionsAliases = registerCommandAliases('sessions', ['resume'])
    const help = ctx.commands.register({
      name: 'help',
      description: 'Show available commands and key bindings',
      handler: (invocation) => showHelp(invocation.agent),
    })
    const theme = registerThemeCommand(ctx)
    // The model-family commands (`/model`, `/effort`, later `/provider`)
    // live in their own module with the same lazy-service discipline.
    const models = registerModelCommands(ctx)
    // The mode-family command (`/yolo`) plus the session-switch restore and
    // the plan/yolo exclusivity watcher.
    const modes = registerModeCommands(ctx)
    const modeTracking = setupModeTracking(ctx)
    return () => {
      quit()
      quitAliases()
      fresh()
      fork()
      sessions()
      sessionsAliases()
      help()
      theme()
      models()
      modes()
      modeTracking()
    }
  })
}
