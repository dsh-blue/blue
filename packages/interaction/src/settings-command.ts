/**
 * The `/settings` command and its panel: an editor-slot (D30) framed
 * wrapper around `components.createSettingsList` editing the host's
 * settings document across the namespaces the bundle registers — Blue's
 * own (`blue.*`: update check, default theme, folding), the shell and
 * agent-loop limits, the default model's reasoning effort, web search, and
 * the permission preset for NEW sessions — plus an `open-file` row that
 * opens the prepared settings document in `$VISUAL`/`$EDITOR`. Rows are
 * preset cycles: Enter/Space steps the value (a current value outside the
 * presets is merged in as the selection), each accepted change writes
 * through `settings.update` (deep-merge) with the descriptor revision —
 * `agent-default-model.reasoningEffort: default` instead unsets the key
 * through `settings.mutate`, so the field re-inherits the schema's
 * omission semantics. A stale revision (`SettingsConflictError`) re-reads
 * and retries once; anything still failing flashes the editor notice.
 *
 * The core adapter is construct-only (pi-tui's `SettingsList` exposes
 * `updateValue` but no highlight getter, and the Blue adapter surfaces
 * neither), so refresh is a whole-panel rebuild: every accepted write and
 * every `settings/document-updated` emission (the host file watcher fires
 * it after an external edit) re-describes and remounts through one shared
 * `mount` closure. The generation counter keeps a write that already
 * announced itself through the event from rebuilding twice. The service
 * reads are lazy `ctx.get` — this fiber must never become a theme
 * dependent (the `/theme` swap disposes dependents).
 *
 * @module @dsh-blue/blue-interaction/settings-command
 */

import { readFile, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Empty type import carries the `settings` Context merge and the
// 'settings/document-updated' Events merge this module subscribes to.
import type {} from '@deepseek-ai/dsh-settings'
import { SettingsConflictError, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { BlueFocusable, BlueSettingItem, BlueSettingsList, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { resolveExternalEditorCommand, runExternalEditor } from './external-editor.ts'
import type { PermissionPresetsService } from './permission-panel.ts'

/** The select-action row id opening the settings document in an editor. */
const OPEN_FILE_ID = 'open-file'

/** The reasoning-effort row id; its `default` value unsets the key. */
const EFFORT_ID = 'agent-default-model.reasoningEffort'

/** One panel row's identity, display, and write semantics. */
interface SettingRow {
  /** Stable id reported by the list's change callback (`ns.key`). */
  readonly id: string
  /** The settings namespace the write targets. */
  readonly ns: string
  /** The section key the write patches. */
  readonly key: string
  /** Display label (left side). */
  readonly label: string
  /** One-line description shown while the row is highlighted. */
  readonly description?: string
  /** Value parsing for the write: cycled strings become booleans/numbers. */
  readonly kind: 'boolean' | 'number' | 'string'
  /** The preset cycle, in cycle order. */
  readonly values: readonly (boolean | number | string)[]
}

/** The static rows, in panel order; the permission row joins dynamically. */
const ROWS: readonly SettingRow[] = [
  {
    id: 'blue.updateCheck', ns: 'blue', key: 'updateCheck', label: 'Update check',
    description: 'boot update check on/off', kind: 'boolean', values: [true, false],
  },
  {
    id: 'blue.updateChannel', ns: 'blue', key: 'updateChannel', label: 'Update channel',
    kind: 'string', values: ['rc'],
  },
  {
    id: 'blue.theme', ns: 'blue', key: 'theme', label: 'Theme',
    description: 'default theme, applied at startup', kind: 'string',
    values: ['dark', 'light', 'ocean', 'paper', 'auto'],
  },
  {
    id: 'blue.collapseThinking', ns: 'blue', key: 'collapseThinking', label: 'Collapse thinking',
    description: 'thinking blocks start collapsed', kind: 'boolean', values: [true, false],
  },
  {
    id: 'blue.collapseToolCalls', ns: 'blue', key: 'collapseToolCalls', label: 'Collapse tool calls',
    description: 'tool output starts collapsed (ctrl+o toggles)', kind: 'boolean', values: [true, false],
  },
  {
    id: 'shell.timeoutMs', ns: 'shell', key: 'timeoutMs', label: 'Shell timeout (ms)',
    kind: 'number', values: [30_000, 60_000, 120_000, 300_000, 600_000],
  },
  {
    id: 'shell.maxTimeoutMs', ns: 'shell', key: 'maxTimeoutMs', label: 'Shell max timeout (ms)',
    kind: 'number', values: [300_000, 600_000, 900_000, 1_800_000, 3_600_000],
  },
  {
    id: 'shell.maxOutputBytes', ns: 'shell', key: 'maxOutputBytes', label: 'Shell max output (bytes)',
    kind: 'number', values: [16_000, 32_000, 64_000, 128_000, 256_000],
  },
  {
    id: 'agent-loop.maxParallelToolCalls', ns: 'agent-loop', key: 'maxParallelToolCalls',
    label: 'Max parallel tool calls', kind: 'number', values: [1, 5, 10, 20, 50],
  },
  {
    id: EFFORT_ID, ns: 'agent-default-model', key: 'reasoningEffort', label: 'Default reasoning effort',
    description: 'default = omit effort', kind: 'string',
    values: ['default', 'off', 'low', 'high', 'max'],
  },
  {
    id: 'web-search-deepseek.maxUses', ns: 'web-search-deepseek', key: 'maxUses',
    label: 'Web search max uses', kind: 'number', values: [1, 3, 5, 10, 25],
  },
  {
    id: 'web-search-deepseek.maxTokens', ns: 'web-search-deepseek', key: 'maxTokens',
    label: 'Web search max tokens', kind: 'number', values: [2048, 4096, 8192, 16384],
  },
]

/** Row lookup for the change callback. */
const ROWS_BY_ID: ReadonlyMap<string, SettingRow> = new Map(ROWS.map(row => [row.id, row]))

/**
 * Render a row's current value for the right column: booleans and numbers
 * stringify, an absent reasoning effort reads as its `default` preset (the
 * key is omitted from the section), anything else falls back to the first
 * preset.
 * @param row - the row definition.
 * @param raw - the resolved section value for the row's key.
 * @returns the display string.
 */
function displayValue(row: SettingRow, raw: unknown): string {
  if (row.id === EFFORT_ID && raw === undefined) return 'default'
  if (typeof raw === 'boolean') return String(raw)
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return raw
  return String(row.values[0])
}

/**
 * Build one list entry for a row: the preset cycle as strings, with a
 * current value outside the presets merged in as the selection.
 * @param row - the row definition.
 * @param raw - the resolved section value for the row's key.
 * @returns the settings-list item.
 */
function settingItem(row: SettingRow, raw: unknown): BlueSettingItem {
  const current = displayValue(row, raw)
  const presets = row.values.map(String)
  return {
    id: row.id,
    label: row.label,
    ...row.description === undefined ? {} : { description: row.description },
    currentValue: current,
    values: presets.includes(current) ? presets : [current, ...presets],
  }
}

/**
 * Build the panel's items from a fresh `describe()`: every static row
 * whose namespace the host registered (absent namespaces drop their rows),
 * then the permission preset row when both the namespace and the presets
 * service exist, then the open-file action.
 * @param settings - the host settings service.
 * @param presets - the permission presets table, when the host has one.
 * @returns the item list, in group order.
 */
function buildItems(settings: SettingsProvider, presets: PermissionPresetsService | undefined): BlueSettingItem[] {
  const described = new Map(settings.describe().map(descriptor => [String(descriptor.ns), descriptor]))
  const items: BlueSettingItem[] = []
  for (const row of ROWS) {
    const descriptor = described.get(row.ns)
    if (descriptor === undefined) continue
    items.push(settingItem(row, (descriptor.value as Record<string, unknown>)[row.key]))
  }
  const permission = described.get('permission')
  if (permission !== undefined && presets !== undefined) {
    const raw = (permission.value as Record<string, unknown>).defaultPreset
    const current = typeof raw === 'string' ? raw : String(presets.names[0] ?? '')
    items.push({
      id: 'permission.defaultPreset',
      label: 'Default permission preset',
      description: 'applies to new sessions',
      currentValue: current,
      values: presets.names.includes(current) ? [...presets.names] : [current, ...presets.names],
    })
  }
  items.push({ id: OPEN_FILE_ID, label: 'Open settings.yaml in $EDITOR', currentValue: '', values: [''] })
  return items
}

/** Parse a cycled string back into the row's value type. */
function parseValue(row: SettingRow, newValue: string): boolean | number | string {
  if (row.kind === 'boolean') return newValue === 'true'
  if (row.kind === 'number') return Number(newValue)
  return newValue
}

/** Constructor options for {@link SettingsPanel}. */
export interface SettingsPanelOptions {
  /** Theme supplying the frame's rule/title/hint colors. */
  readonly theme: BlueTheme
  /** The settings list this panel frames. */
  readonly list: BlueSettingsList
}

/**
 * The framed `/settings` surface: the pi-tui settings list wrapped in the
 * S12 dialog chrome (`settings` title, muted key-hint footer, full-width
 * rules). Input delegates to the list — its keybindings own Up/Down,
 * Enter/Space, and Escape.
 */
export class SettingsPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  /**
   * @param options - see {@link SettingsPanelOptions}.
   */
  constructor(private readonly options: SettingsPanelOptions) {}

  /**
   * Delegate one input sequence to the settings list.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    this.options.list.handleInput?.(data)
  }

  /** No cached render state of its own; the list keeps its own. */
  invalidate(): void {
    this.options.list.invalidate()
  }

  /**
   * Render the framed dialog: the list's body rows between full-width
   * rules with the title and the muted key-hint footer. `framePanel` owns
   * the width discipline for the chrome and the degenerate-width cut; the
   * list budgets its own rows at every normal width.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const colors = this.options.theme.colors
    return framePanel(this.options.list.render(width), width, {
      title: 'settings',
      titlePaint: colors.primary,
      footer: ['↑↓ select', '↵ change', 'esc close'],
      footerPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }
}

/**
 * Register the `/settings` command on `ctx.commands`.
 * @param ctx - plugin context carrying the command registry.
 * @returns the registration disposer; also flags every async continuation
 *   of an open panel as unloaded.
 */
export function registerSettingsCommand(ctx: Context): () => void {
  let unloaded = false

  const dispose = ctx.commands.register({
    name: 'settings',
    description: 'Edit user settings (update, theme, folding, shell, agent, search, permission)',
    handler: (): CommandResult => {
      const settings = ctx.get('settings')
      if (settings === undefined) {
        return { kind: 'error', text: 'settings service unavailable on this host' }
      }
      const display = displayServices(ctx)
      if (display === undefined) {
        return { kind: 'error', text: 'settings panel is unavailable: the Blue screen is not mounted' }
      }

      let closed = false
      const inactive = (): boolean => unloaded || closed
      /** Bumped per remount; a write whose commit already rebuilt skips its own. */
      let generation = 0
      /* v8 ignore next -- the placeholder runs only if the panel settles
         before its mount returns, which the building order forbids */
      let restore: () => void = () => {}

      const notice = (text: string): void => {
        getSharedEditor()?.notice?.(text)
      }

      /** Rebuild the whole panel from a fresh describe() and remount it. */
      const rebuild = (): void => {
        if (inactive()) return
        generation += 1
        restore()
        mount()
      }

      /**
       * Write one cycled value: fresh revision, one conflict retry, then
       * the outcome notice. Never rejects — every failure lands on the
       * notice channel.
       * @param id - the row id (`ns.key`, or the open-file action).
       * @param newValue - the cycled display string.
       */
      const write = async (id: string, newValue: string): Promise<void> => {
        if (id === OPEN_FILE_ID) {
          await openSettingsFile()
          return
        }
        const row = ROWS_BY_ID.get(id)
        if (row === undefined) return
        const ns = settingsNamespace(row.ns)
        const startedAt = generation
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const descriptor = settings.describe().find(entry => String(entry.ns) === row.ns)
          if (descriptor === undefined) return
          try {
            if (id === EFFORT_ID && newValue === 'default') {
              await settings.mutate(ns, [{ op: 'unset', path: ['reasoningEffort'] }], descriptor.revision)
            } else {
              await settings.update(ns, { [row.key]: parseValue(row, newValue) }, descriptor.revision)
            }
          } catch (error) {
            if (error instanceof SettingsConflictError && attempt === 0) continue
            if (!inactive()) {
              const message = error instanceof Error ? error.message : String(error)
              notice(display.colors.error(`could not update ${row.label.toLowerCase()}: ${message}`))
            }
            return
          }
          if (inactive()) return
          notice(`${row.label.toLowerCase()} set to ${newValue}`)
          // The commit's document-updated emission already rebuilt; only a
          // commit that changed nothing raw leaves the panel to refresh.
          if (generation === startedAt) rebuild()
          return
        }
      }

      /**
       * The open-file row: materialize the document, hand it to the
       * external editor behind a screen suspend (the Ctrl-G discipline),
       * and write the edited text back — the host file watcher's
       * document-updated emission rebuilds the panel.
       */
      const openSettingsFile = async (): Promise<void> => {
        const path = await settings.prepareDocument().catch(() => undefined)
        if (inactive()) return
        if (path === undefined) {
          notice('settings file unavailable')
          return
        }
        const command = resolveExternalEditorCommand()
        if (command === undefined) {
          notice('no editor configured ($VISUAL/$EDITOR)')
          return
        }
        let text: string
        try {
          text = await readFile(path, 'utf-8')
        } catch (error) {
          /* v8 ignore next 1 -- node fs rejections are always Error instances */
          notice(`could not read settings file: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        const edited = await display.screen.suspend(() => runExternalEditor(text, command))
        if (inactive()) return
        if (edited === undefined || edited === text) return
        try {
          await writeFile(path, edited, 'utf-8')
        } catch (error) {
          /* v8 ignore next 1 -- node fs rejections are always Error instances */
          notice(`could not write settings file: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      /** Mount a fresh panel built from the current describe(). */
      const mount = (): void => {
        const presets = ctx.get('permissionPresets') as PermissionPresetsService | undefined
        const list = display.components.createSettingsList({
          items: buildItems(settings, presets),
          onChange: (id, newValue) => {
            void write(id, newValue)
          },
          onCancel: () => {
            close()
          },
        })
        const panel = new SettingsPanel({ theme: display.theme, list })
        restore = mountEditorReplacement(panel)
      }

      /** Tear the panel down: unsubscribe, pop the dock slot. */
      const close = (): void => {
        /* v8 ignore next -- the list fires exactly one cancel per mount */
        if (closed) return
        closed = true
        offDocument()
        restore()
      }

      // Live while the panel is open: the host file watcher announces
      // external edits (and our own commits) here.
      const offDocument = ctx.on('settings/document-updated', () => {
        rebuild()
      })
      mount()
      return { kind: 'success' }
    },
  })
  return () => {
    unloaded = true
    dispose()
  }
}
