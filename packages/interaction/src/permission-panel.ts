/**
 * The `/permission` preset picker (S24b, D33): a bare `/permission`
 * submission intercepted by the input layer opens this panel instead of
 * the upstream command's text listing; a `/permission <name>` line
 * passes through to the upstream command untouched. The panel reads the
 * preset table through `ctx.permissionPresets` (dsh-permission-presets,
 * composed by dsh-base) — the service read is the projection's
 * `currentValue` by construction (`selectFor` folds the same knob
 * events), so the panel keeps the repo's direct-service habit. Selecting
 * a row dispatches `/permission <name>` through the command runtime —
 * the same live write path as a typed command, with `command/run` +
 * `command/done` and the `permission/preset`/`sandbox/mode`/
 * `approval/policy` knob events logged for free. The `custom` preset is
 * a display-only derived state (upstream rejects it on write), and the
 * `danger-full-access` row demands a typed-y canonical form gate (the D33
 * ruling; kimi's picker has none) because it unbundles both the sandbox
 * and the approval policy.
 *
 * @module @dsh-blue/blue-interaction/permission-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-app'
// Empty type imports carry the `permissionPresets` Context merge
// (dsh-permission-presets) and the `commands` merge the dispatch uses.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-commands'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { CanonicalFormController, type FormField } from './form-panel.ts'
import { CanonicalSelectController, type SelectRow } from './select-list.ts'
import { CURRENT_MARK } from './symbols.ts'

/** The sandbox + approval bundle one preset resolves to. */
export interface PermissionPresetSpec {
  /** The sandbox mode the preset pins. */
  readonly sandbox: string
  /** The approval policy the preset pins. */
  readonly approval: string
  /** Optional display label (the dsh-base table carries none). */
  readonly name?: string
  /** Optional one-sentence description (the dsh-base table carries none). */
  readonly description?: string
}

/**
 * Structural interface for `ctx.permissionPresets` — the read surface the
 * picker consumes (the provider wizard's EditSettings precedent: a local
 * shape over the lazily probed service, never an injected dependency).
 */
export interface PermissionPresetsService {
  /** Switchable preset names in table order; `custom` is never listed. */
  readonly names: readonly string[]
  /** Domain projection used by the app boundary, retained in the structural service shape. */
  current(session: unknown): string
  /** The sandbox + approval bundle of a table preset; throws when unknown. */
  resolve(name: string): PermissionPresetSpec
  /** The display option of a table key or `custom`; throws when unknown. */
  optionOf(name: string): { readonly value: string, readonly name: string, readonly description?: string }
}

/** The derived one-line row description: the knob facts a bare table key hides. */
function presetDescription(spec: PermissionPresetSpec): string {
  return `sandbox ${spec.sandbox} · approval ${spec.approval}`
}

/** The derived-state row's refusal notice (upstream rejects writing `custom`). */
const CUSTOM_BLOCKED = 'custom is the derived state — pick a preset'

/**
 * Open the preset picker for the live agent (D30 editor-slot mount).
 * Fire-and-forget: the caller (`blue-input`'s bare-`/permission`
 * interception) never awaits the panel.
 * @param ctx - plugin context (`commands` via the calling plugin).
 */
export function openPermissionPanel(ctx: Context): void {
  const presets = ctx.get('permissionPresets') as PermissionPresetsService | undefined
  if (presets === undefined) return
  const display = displayServices(ctx)
  if (display === undefined) {
    getSharedEditor(ctx)?.notice?.('permission picker is unavailable: the Blue screen is not mounted')
    return
  }
  const current = ctx.blueSessionActions.permissionPreset()
  if (current === undefined) return
  const rows: SelectRow[] = presets.names.map(name => ({
    value: name,
    label: presets.optionOf(name).name,
    description: presetDescription(presets.resolve(name)),
    ...(name === current ? { badge: CURRENT_MARK } : {}),
  }))
  if (current === 'custom') {
    rows.push({ value: 'custom', label: presets.optionOf('custom').name, disabled: true })
  }

  const dispatch = (name: string): void => {
    void ctx.blueSessionActions.executeCommand(`/permission ${name}`, new AbortController().signal).then(
      execution => {
        if (execution === undefined) return
        const { result } = execution
        if (result.text === undefined) return
        const paint = result.kind === 'error' ? displayServices(ctx)?.colors.error : undefined
        getSharedEditor(ctx)?.notice?.(paint === undefined ? result.text : paint(result.text))
      },
      error => {
        // execute() rethrows handler failures and append failures alike;
        // the picker has no panel left to paint them on, so the loud path
        // is the logger.
        ctx.logger.warn(`permission dispatch failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
  }

  // The list stays mounted under the danger gate: cancelling the form
  // pops the stack back onto the picker instead of rebuilding it.
  /* v8 ignore next -- the placeholder only runs if the panel settles
     before its mount returns, which the building order forbids */
  let restoreList: () => void = () => {}
  const confirmDanger = (name: string): void => {
    const fields: FormField[] = [{
      id: 'yes',
      label: `Enable ${name}?`,
      required: true,
      validate: value => value.toLowerCase() === 'y'
        ? undefined
        : 'type y to confirm, or Esc to pick another preset',
    }]
    const form = new CanonicalFormController({
      keymap: display.keymap,
      theme: display.theme,
      components: display.components,
      title: 'Full access',
      subtitle: 'no sandbox, and no approval prompts — every tool call runs unchecked',
      fields,
      onSubmit: () => {
        // Leave both layers: the gate pops onto the picker, and a
        // confirmed switch closes the picker too.
        restoreForm()
        restoreList()
        dispatch(name)
      },
      onCancel: () => {
        restoreForm()
      },
    })
    const restoreForm = mountEditorReplacement(ctx, form)
  }

  const panel = new CanonicalSelectController({
    keymap: display.keymap,
    theme: display.theme,
    components: display.components,
    rows,
    title: 'Permissions',
    titleHint: '· esc cancel · ↵ switch',
    ...(current === 'custom' ? {} : { initialValue: current }),
    onSelect: row => {
      if (presets.resolve(row.value).sandbox === 'danger-full-access') {
        confirmDanger(row.value)
        return
      }
      restoreList()
      dispatch(row.value)
    },
    onBlockedSelect: () => {
      getSharedEditor(ctx)?.notice?.(display.colors.warning(CUSTOM_BLOCKED))
    },
    onCancel: () => {
      restoreList()
    },
  })
  restoreList = mountEditorReplacement(ctx, panel)
}
