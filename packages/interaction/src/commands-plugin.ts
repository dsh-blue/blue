/**
 * `blue-commands` plugin: the built-in slash commands. `/quit` requests
 * process exit through the launcher-owned `ctx.appExit`; `/sessions`
 * lists this directory's persisted sessions in a type-to-filter picker
 * — rows carry the session title (the S30① all-prompts naming, resolved
 * through the optional `sessionQuery` batch title read) with the
 * `← current` badge on the live one, and an id argument emits
 * `blue/request-resume` directly (`/resume` is its alias — the S24a
 * dogfood ruling: one command, both surfaces); `/new` emits
 * `blue/request-new`, and `/fork` emits `blue/request-fork` for the app
 * layer to perform the switch (`/clear` is `/new`'s alias — the kimi
 * naming, one command wearing both names); `/help` lists
 * the registered commands and key bindings in an overlay; `/theme` swaps
 * the live theme provider (see `./theme-switch.ts`); `/yolo` and the
 * plan/yolo exclusivity wiring live in `./mode-commands.ts`; the
 * session-info family (`/status` `/usage` `/version`) lives in
 * `./session-commands.ts`; `/init` (the canned AGENTS.md prompt) lives in
 * `./session-init.ts`; the config family (`/tools` over the live tool
 * catalog, `/preset` over the agent-preset roster) lives in
 * `./tools-commands.ts` and `./preset-commands.ts`; and `/skills` (the
 * `#` pipeline's read-only listing) lives in `./skills-command.ts`; and
 * the safe in-app upgrade (`/update`, D52) lives in
 * `./update-command.ts`.
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

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge and
// the `'blue/request-*'` Events merges this plugin emits.
import type {} from '@dsh-blue/blue-app'
// Empty type import carries the `sessionPersistence` Context merge; the
// service itself is optional and resolved lazily.
import type {} from '@deepseek-ai/dsh-session-persistence'
// Empty type import carries the `sessionQuery` Context merge (the dsh-base
// `session-query-sqlite` row with `openAt: never` keeps batch title reads
// available); optional and resolved lazily like persistence.
import type {} from '@deepseek-ai/dsh-session-query'
import { aliasesOf, registerCommandAliases } from './command-meta.ts'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import type { HelpSection } from './help.ts'
import { HelpOverlay } from './help.ts'
import { registerMcpCommands } from './mcp-commands.ts'
import { registerModelCommands } from './model-commands.ts'
import { registerModeCommands, setupModeTracking } from './mode-commands.ts'
import { registerPresetCommands } from './preset-commands.ts'
import { registerSessionCommands } from './session-commands.ts'
import { registerExportCommands } from './session-export.ts'
import { registerInitCommand } from './session-init.ts'
import { registerSkillsCommand } from './skills-command.ts'
import { SelectListPanel } from './select-list.ts'
import { flattenSessionTree } from './session-tree.ts'
import { CURRENT_MARK } from './symbols.ts'
import { registerThemeCommand } from './theme-switch.ts'
import { registerToolsCommands } from './tools-commands.ts'
import { registerUpdateCommand } from './update-command.ts'
import { registerTraceCommand } from './trace-command.ts'
import { rewindCandidates } from './rewind.ts'

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
 * Default count of newest sessions whose titles resolve when the picker
 * opens. Each persisted title is one full event-log parse behind the
 * batch read (4-way concurrent), so the cap bounds the open cost for a
 * directory with a long session history; older rows keep the id form.
 */
export const DEFAULT_SESSION_TITLE_LIMIT = 100

let sessionTitleLimit = DEFAULT_SESSION_TITLE_LIMIT

/**
 * Replace the title-resolution cap (tests inject small bounds here).
 * @param n - the replacement, or `undefined` to restore the default.
 */
export function setSessionTitleLimit(n: number | undefined): void {
  sessionTitleLimit = n ?? DEFAULT_SESSION_TITLE_LIMIT
}

/** The active title-resolution cap. */
export function currentSessionTitleLimit(): number {
  return sessionTitleLimit
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
   * The `/sessions` handler: list this directory's persisted sessions
   * newest-first with their titles (the optional batch title read) and
   * offer them in a type-to-filter picker; picking another session emits
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
    // The cwd scope (D46): only this directory's sessions — a global list
    // mixes every project the harness ever ran in. Exact match after
    // normalization, no subtree spread; headerless-cwd rows stay hidden.
    const here = resolve(process.cwd())
    const sorted = headers
      .filter(header => header.cwd !== undefined && resolve(header.cwd) === here)
      .sort((a, b) => b.createdAt - a.createdAt)
    if (sorted.length === 0) return { kind: 'success', text: 'no sessions in this directory' }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'session picker is unavailable: the Blue screen is not mounted' }
    }
    const currentId = ctx.get('blueSession')?.current?.id
    const titles = await resolveTitles(sorted, signal)
    // The title await can span a tree unload exactly like the listing
    // above; the continuation must not mount a panel on the dead tree.
    if (unloaded) return { kind: 'success' }
    const tree = flattenSessionTree(sorted, titles, currentId === undefined ? undefined : String(currentId), formatDate)
    const list = new SelectListPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows: tree.map(row => ({
        value: row.value,
        label: row.label,
        ...(row.description === undefined ? {} : { description: row.description }),
        filterText: row.filterText,
        ...(row.current === true ? { badge: CURRENT_MARK } : {}),
      })),
      title: 'Sessions',
      titleHint: '· esc cancel · ↵ resume',
      ...(currentId === undefined ? {} : { initialValue: String(currentId) }),
      filter: true,
      onSelect: (row) => {
        restore()
        if (row.value === String(currentId)) {
          getSharedEditor()?.notice?.(display.colors.error('already the current session'))
          return
        }
        ctx.emit('blue/request-resume', row.value)
        getSharedEditor()?.notice?.(`resuming session ${row.value}`)
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
   * Open the single-level rewind picker for the live session. Selecting a
   * row emits an additive Blue request; the app creates the child session and
   * leaves the parent untouched.
   * @returns the command outcome.
   */
  function rewindSession(): CommandResult {
    const active = ctx.get('blueSession')?.current
    if (active === undefined || active === null) return { kind: 'error', text: 'no active session' }
    if (active.status !== 'idle') return { kind: 'error', text: 'cannot rewind while the agent is running' }
    const candidates = rewindCandidates(active.session.events)
    if (candidates.length === 0) return { kind: 'success', text: 'no user turns to rewind' }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'rewind is unavailable: the Blue screen is not mounted' }
    }
    const rows = candidates.map(candidate => ({
      value: String(candidate.boundarySeq),
      label: `Turn ${String(candidate.turn)} · ${candidate.prompt}`,
      ...(candidate.response === undefined ? {} : { description: `↳ ${candidate.response}` }),
      filterText: `${candidate.prompt} ${candidate.response ?? ''} ${String(candidate.turn)}`,
    }))
    const first = candidates[0]
    /* v8 ignore next -- candidates.length was checked above. */
    if (first === undefined) return { kind: 'success', text: 'no user turns to rewind' }
    const list = new SelectListPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows,
      title: 'Rewind current session',
      titleHint: '· esc cancel · ↵ create branch',
      footer: 'The original session stays available in /sessions.',
      initialValue: String(first.boundarySeq),
      filter: true,
      onSelect: (row) => {
        restore()
        ctx.emit('blue/request-rewind', String(active.id), Number(row.value))
        getSharedEditor()?.notice?.('creating rewind branch...')
      },
      onCancel: () => {
        restore()
      },
    })
    const restore = mountEditorReplacement(list)
    return { kind: 'success' }
  }

  /**
   * Resolve titles for the newest sessions through the optional
   * `sessionQuery` batch read (D46): each persisted title is one full
   * event-log parse, so only the first {@link sessionTitleLimit} ids are
   * requested. An absent service, a failed batch, and per-session
   * rejections all degrade those rows to the id form — never the panel.
   * @param sorted - the cwd-scoped sessions, newest-first.
   * @param signal - the dispatching UI request's cancellation signal.
   * @returns session id to title for every resolved snapshot.
   */
  async function resolveTitles(
    sorted: readonly SessionHeader[],
    signal: AbortSignal,
  ): Promise<Map<string, string>> {
    const titles = new Map<string, string>()
    const query = ctx.get('sessionQuery')
    // The caller returns before the empty listing reaches here, so an
    // absent query service is the only early exit.
    if (query === undefined) return titles
    const ids: SessionId[] = sorted.slice(0, sessionTitleLimit).map(header => header.id)
    let results
    try {
      results = await query.readTitleSnapshots(ids, signal)
    } catch {
      // A whole-batch failure leaves every row untitled; per-session
      // failures are isolated below by the allSettled result shape.
      return titles
    }
    for (const result of results) {
      const title = result.status === 'fulfilled' ? result.value.title : undefined
      if (title !== undefined) titles.set(String(result.sessionId), title.title)
    }
    return titles
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
    // `/clear` is the new-session command's alias (the S27 kimi naming:
    // CC/Codex users reach for /clear to wipe the conversation), not a
    // registration — the input layer rewrites the line to `/new` before
    // dispatch, exactly like `/q` → `/quit`.
    const freshAliases = registerCommandAliases('new', ['clear'])
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
    const rewind = ctx.commands.register({
      name: 'rewind',
      description: 'Create a branch from an earlier user turn',
      handler: () => rewindSession(),
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
    // The session-info family (`/status` `/usage` `/version`).
    const sessionInfo = registerSessionCommands(ctx)
    // The session-export family (`/export` `/copy`).
    const sessionExport = registerExportCommands(ctx)
    // The canned-prompt command (`/init`).
    const init = registerInitCommand(ctx)
    // The config-family commands (S28): `/tools` over the live tool
    // catalog, `/preset` over the agent-preset roster.
    const toolCatalog = registerToolsCommands(ctx)
    const agentPresets = registerPresetCommands(ctx)
    // The skills listing (`/skills`, the `#` pipeline's read side).
    const skillsCommand = registerSkillsCommand(ctx)
    // The MCP server browser (`/mcp`, S34): read-only over loader entries.
    const mcpBrowser = registerMcpCommands(ctx)
    // `/trace` is a read-only timeline over the official session-query API.
    const trace = registerTraceCommand(ctx)
    // The safe in-app upgrade (`/update`, D52).
    const update = registerUpdateCommand(ctx)
    return () => {
      quit()
      quitAliases()
      fresh()
      freshAliases()
      fork()
      rewind()
      sessions()
      sessionsAliases()
      help()
      theme()
      models()
      modes()
      modeTracking()
      sessionInfo()
      sessionExport()
      init()
      toolCatalog()
      agentPresets()
      skillsCommand()
      mcpBrowser()
      trace()
      update()
    }
  })
}
