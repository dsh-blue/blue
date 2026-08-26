/**
 * The `/preset` command (S28, D33): list the host's agent-preset roster and
 * switch the live session onto one — the thin-host composition seam. A bare
 * invocation opens the shared single-select panel over
 * the app-owned preset projection with the live composition badged; a
 * selection re-dispatches `/preset <id>` through the app command boundary
 * (the same write
 * path as a typed line, so the switch logs `command/run` + `command/done`),
 * and a named invocation switches directly.
 *
 * The app owns the blank/idle/stale-session guards, scope recomposition, and
 * `agent-preset/selected` append. Interaction receives only immutable rows
 * and structured results. Capability probing stays structural — the roster's
 * presence or absence, never preset names — and broken presets list as
 * disabled rows carrying their reason.
 *
 * @module @dsh-blue/blue-interaction/preset-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { BlueSessionPreset } from '@dsh-blue/blue-app'
// Empty type imports carry the commands registration and the app-owned
// renderer-neutral session services.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { SelectListPanel, oneLine, type SelectRow } from './select-list.ts'
import { CURRENT_MARK } from './symbols.ts'

/** One renderer-neutral preset row exposed by the app boundary. */
export type PresetRow = BlueSessionPreset

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
  const reader = ctx.blueSessionReader
  const actions = ctx.blueSessionActions
  // The fiber-unload flag: an await spanning a tree unload must never touch
  // the dead context's services or screen.
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })

  /**
   * The bare `/preset` handler: list the roster and open the picker. The
   * panel deliberately opens on started sessions too — the rows stay
   * inspectable, and the switch attempt reports the blank-only refusal.
   * @returns the command outcome.
   */
  async function openPresetPicker(): Promise<CommandResult> {
    const listed = await actions.presets()
    if (!listed.ok) return { kind: 'error', text: listed.message }
    const presets = listed.value
    if (unloaded) return { kind: 'success' }
    if (presets.length === 0) {
      return { kind: 'success', text: 'no presets composed' }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: 'preset picker is unavailable: the Blue screen is not mounted' }
    }
    const current = actions.currentPreset()

    const dispatch = (id: string): void => {
      void actions.executeCommand(`/preset ${id}`, new AbortController().signal).then(
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
          getSharedEditor(ctx)?.notice?.(paint === undefined ? result.text : paint(result.text))
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
        getSharedEditor(ctx)?.notice?.(display.colors.warning(oneLine(row.description!)))
      },
      onCancel: () => {
        restoreList()
      },
    })
    restoreList = mountEditorReplacement(ctx, panel)
    return { kind: 'success' }
  }

  const preset = ctx.commands.register({
    name: 'preset',
    description: 'List agent presets or switch (blank sessions only)',
    input: { hint: '[name]' },
    handler: invocation => {
      if (reader.current() === null) {
        return { kind: 'error', text: 'no session is live yet' }
      }
      const id = invocation.rawInput.trim()
      if (id.length === 0) return openPresetPicker()
      return actions.selectPreset(id).then(result => result.ok
        ? { kind: 'success', text: result.value }
        : { kind: 'error', text: result.message })
    },
  })
  return () => {
    preset()
  }
}
