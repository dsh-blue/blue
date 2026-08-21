/**
 * The `/preset` command (S28, D33): list the host's agent-preset roster and
 * switch the live session onto one — the thin-host composition seam. A bare
 * invocation opens the shared single-select panel over
 * `ctx.agentPresets.list()` with the live composition badged; a selection
 * re-dispatches `/preset <id>` through the command runtime (the same write
 * path as a typed line, so the switch logs `command/run` + `command/done`),
 * and a named invocation switches directly.
 *
 * The switch itself is a self-built blank-session guard: `recompose` swaps
 * the agent's scope parentage mid-life, valid only before the session has
 * produced anything (`turn/start` absent — standalone events like the
 * command log never open a turn, so re-running `/preset` while blank stays
 * legal). The in-process call has no wire layer to enforce the lock, so
 * Blue owns the check; after a successful rebind the
 * `agent-preset/selected` event is appended (model-visible ⟺ logged — the
 * same pairing the upstream api-proxy performs), which is also what the
 * app driver folds on resume to rebuild the composition. Capability
 * probing stays structural — the roster's presence or absence, never
 * preset names — and broken presets list as disabled rows carrying their
 * reason.
 *
 * @module @dsh-blue/blue-interaction/preset-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Empty type imports carry the agent-presets Context merge (the `agentPresets`
// roster service) plus its SessionEventMap member — `agent-preset/selected`
// — that the post-switch append narrows on; the `commands` merge the
// registration and re-dispatch use; and the app-owned `blueSession` merge.
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { SelectListPanel, oneLine, type SelectRow } from './select-list.ts'
import { CURRENT_MARK } from './symbols.ts'

/** One roster entry, the display fields of the upstream `AgentPreset`. */
export interface PresetRow {
  /** The roster id: the switch target and the logged value. */
  readonly id: string
  /** Where the preset was discovered; display-only here. */
  readonly trust: 'system' | 'user'
  /** Display name; the id stands in when the metadata carries none. */
  readonly name?: string
  /** One-sentence description from the preset's metadata. */
  readonly description?: string
  /** List order; unordered presets sort after ordered ones, then by id. */
  readonly order?: number
  /** The composition failed its audit: the row disables and shows this reason. */
  readonly broken?: string
}

/**
 * The roster surface `/preset` and `/tools` consume — a local shape over the
 * lazily probed service (the permission picker's precedent: never an
 * injected dependency, so a host composing without the roster still boots
 * Blue).
 */
export interface AgentPresetsRoster {
  /** Re-read the roots; every visible preset, broken ones included. */
  list(): Promise<readonly PresetRow[]>
  /** Rebind the agent's scope parentage onto the preset's standing mount. */
  recompose(agentCtx: Context, id: string): Promise<{ readonly id: string }>
  /** The preset the agent's scope is parented to, if any. */
  composedPreset(agentCtx: Context): string | undefined
  /** The standing mount's registry-view scope key ("for a host reader with no agent"). */
  standingKeyFor(id?: string): Promise<object>
}

/** Render one failure reason for an error result. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the picker rows: roster order (`order ?? ∞`, then id), the live
 * composition badged, broken presets disabled with their reason as the
 * description.
 * @param presets - the roster entries, any order.
 * @param current - the agent's live composition, if any.
 * @returns the panel rows, display order.
 */
export function buildPresetRows(presets: readonly PresetRow[], current: string | undefined): SelectRow[] {
  return [...presets]
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY)
      || a.id.localeCompare(b.id))
    .map(preset => ({
      value: preset.id,
      label: preset.name ?? preset.id,
      ...(preset.broken !== undefined
        ? { description: preset.broken, disabled: true }
        : preset.description !== undefined
          ? { description: preset.description }
          : {}),
      ...(preset.id === current ? { badge: CURRENT_MARK } : {}),
    }))
}

/**
 * Register the `/preset` command.
 * @param ctx - plugin context (`commands` via the calling plugin).
 * @returns the disposer removing the registration.
 */
export function registerPresetCommands(ctx: Context): () => void {
  // The fiber-unload flag: an await spanning a tree unload must never touch
  // the dead context's services or screen.
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })

  /**
   * The shared switch core both paths funnel into: idle + blank guards,
   * then the rebind, then the logged selection event. The guards precede
   * `recompose` because the rebind is mid-life surgery the caller owns the
   * timing of — an unbound agent would take its first bind on a started
   * session, which the harness leaves unchecked in-process.
   * @param roster - the probed roster service.
   * @param agent - the live agent whose session switches.
   * @param id - the target preset id.
   * @returns the command outcome.
   */
  async function switchPreset(roster: AgentPresetsRoster, agent: Agent, id: string): Promise<CommandResult> {
    if (agent.status !== 'idle') {
      return { kind: 'error', text: 'cannot switch presets while the agent is running' }
    }
    if (agent.session.events.some(event => event.type === 'turn/start')) {
      return { kind: 'error', text: 'cannot switch presets: this session has already started (blank sessions only)' }
    }
    try {
      const preset = await roster.recompose(agent.ctx, id)
      agent.session.append('agent-preset/selected', { agentPreset: preset.id })
      return { kind: 'success', text: `preset ${preset.id}` }
    } catch (error) {
      // UnknownPresetError's message already carries the available ids;
      // a broken composition reports its audit failure the same way.
      return { kind: 'error', text: describe(error) }
    }
  }

  /**
   * The bare `/preset` handler: list the roster and open the picker. The
   * panel deliberately opens on started sessions too — the rows stay
   * inspectable, and the switch attempt reports the blank-only refusal.
   * @param roster - the probed roster service.
   * @param agent - the live agent the picker would switch.
   * @returns the command outcome.
   */
  async function openPresetPicker(roster: AgentPresetsRoster, agent: Agent): Promise<CommandResult> {
    let presets: readonly PresetRow[]
    try {
      presets = await roster.list()
    } catch (error) {
      return { kind: 'error', text: `could not list presets: ${describe(error)}` }
    }
    if (unloaded) return { kind: 'success' }
    if (presets.length === 0) {
      return { kind: 'success', text: 'no presets composed' }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'preset picker is unavailable: the Blue screen is not mounted' }
    }
    const current = roster.composedPreset(agent.ctx)

    const dispatch = (id: string): void => {
      void ctx.commands.execute(agent, `/preset ${id}`, [], new AbortController().signal).then(
        execution => {
          /* v8 ignore next -- undefined answers only against an unknown
             command and the unloaded clause only past a mid-execute fiber
             disposal; the dispatch targets this plugin's own registration,
             whose fiber also owns the picker's unmount */
          if (unloaded || execution === undefined) return
          const { result } = execution
          /* v8 ignore next -- the switch core always returns a notice text */
          if (result.text === undefined) return
          const paint = result.kind === 'error' ? displayServices(ctx)?.colors.error : undefined
          getSharedEditor()?.notice?.(paint === undefined ? result.text : paint(result.text))
        },
        /* v8 ignore next 4 -- execute() rejects only past its own runtime;
           the switch core catches its own failures and returns them */
        error => {
          ctx.logger.warn(`preset dispatch failed: ${describe(error)}`)
        },
      )
    }

    // The list stays mounted while the picker is open; both exits pop it.
    /* v8 ignore next -- the placeholder only runs if the panel settles
       before its mount returns, which the building order forbids */
    let restoreList: () => void = () => {}
    const panel = new SelectListPanel({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      rows: buildPresetRows(presets, current),
      title: 'Presets',
      titleHint: '· esc cancel · ↵ switch',
      ...(current === undefined ? {} : { initialValue: current }),
      onSelect: row => {
        restoreList()
        dispatch(row.value)
      },
      onBlockedSelect: row => {
        // buildPresetRows disables only broken rows and always sets their
        // description to the audit reason, so a blocked press has text.
        getSharedEditor()?.notice?.(display.colors.warning(oneLine(row.description!)))
      },
      onCancel: () => {
        restoreList()
      },
    })
    restoreList = mountEditorReplacement(panel)
    return { kind: 'success' }
  }

  const preset = ctx.commands.register({
    name: 'preset',
    description: 'List agent presets or switch (blank sessions only)',
    input: { hint: '[name]' },
    handler: invocation => {
      const roster = ctx.get('agentPresets') as AgentPresetsRoster | undefined
      if (roster === undefined) {
        return { kind: 'error', text: 'agent presets are unavailable: the host composes no roster' }
      }
      const agent = ctx.get('blueSession')?.current
      if (agent === undefined || agent === null) {
        return { kind: 'error', text: 'no session is live yet' }
      }
      const id = invocation.rawInput.trim()
      return id.length === 0 ? openPresetPicker(roster, agent) : switchPreset(roster, agent, id)
    },
  })
  return () => {
    preset()
  }
}
