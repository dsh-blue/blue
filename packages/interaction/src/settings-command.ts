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
 * and retries once; outcomes land on the panel's own feedback row (the
 * editor's hint line leaves the tree while a panel is open, D30).
 *
 * The core adapter surfaces pi-tui's `updateValue` (one entry's displayed
 * value, in place), so refresh is diff-and-update instead of a whole-panel
 * rebuild: an accepted write updates the panel's `lastKnown` value map and
 * leaves the mounted list alone (pi-tui's own cycle already displays the
 * value, and the commit's `settings/document-updated` emission diffs empty
 * against the just-updated map), a failed write rolls the row back through
 * `updateValue`, and a `settings/document-updated` emission (the host file
 * watcher fires it after an external edit) re-describes and pushes only
 * the changed rows' values into the live list. A changed row set (a
 * namespace appeared or disappeared) falls back to the full remount
 * through the shared `mount` closure. The service reads are lazy `ctx.get`
 * — this fiber must never become a theme dependent (the `/theme` swap
 * disposes dependents). A theme commit from the panel's own Theme row still
 * rebuilds the input fiber mid-swap, whose teardown unmounts the dock slot:
 * the panel re-homes the SAME instance on a deferred
 * `'blue/input-editor-changed'` emission (the `/theme` picker discipline, so
 * the list keeps its highlight) and reads its palette through a live getter.
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
import { mountEditorReplacement } from './editor-instance.ts'
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
  /** One-line description shown while the row is highlighted. Required: a
   *  row without one drops the list's description zone and makes the panel
   *  height jump as the highlight moves. */
  readonly description: string
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
    description: 'dist-tag the boot check follows', kind: 'string', values: ['rc'],
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
    description: 'default bash command timeout', kind: 'number', values: [30_000, 60_000, 120_000, 300_000, 600_000],
  },
  {
    id: 'shell.maxTimeoutMs', ns: 'shell', key: 'maxTimeoutMs', label: 'Shell max timeout (ms)',
    description: 'longest bash timeout a call may request', kind: 'number', values: [300_000, 600_000, 900_000, 1_800_000, 3_600_000],
  },
  {
    id: 'shell.maxOutputBytes', ns: 'shell', key: 'maxOutputBytes', label: 'Shell max output (bytes)',
    description: 'captured bash output budget', kind: 'number', values: [16_000, 32_000, 64_000, 128_000, 256_000],
  },
  {
    id: 'agent-loop.maxParallelToolCalls', ns: 'agent-loop', key: 'maxParallelToolCalls',
    label: 'Max parallel tool calls', description: 'concurrent tool call cap',
    kind: 'number', values: [1, 5, 10, 20, 50],
  },
  {
    id: EFFORT_ID, ns: 'agent-default-model', key: 'reasoningEffort', label: 'Default reasoning effort',
    description: 'default = omit effort', kind: 'string',
    values: ['default', 'off', 'low', 'high', 'max'],
  },
  {
    id: 'web-search-deepseek.maxUses', ns: 'web-search-deepseek', key: 'maxUses',
    label: 'Web search max uses', description: 'search invocations per request',
    kind: 'number', values: [1, 3, 5, 10, 25],
  },
  {
    id: 'web-search-deepseek.maxTokens', ns: 'web-search-deepseek', key: 'maxTokens',
    label: 'Web search max tokens', description: 'search answer token budget',
    kind: 'number', values: [2048, 4096, 8192, 16384],
  },
]

/** Row lookup for the change callback. */
const ROWS_BY_ID: ReadonlyMap<string, SettingRow> = new Map(ROWS.map(row => [row.id, row]))

/**
 * Write metadata for the dynamic permission row. Its value cycle comes from
 * the presets service at panel-build time, so it cannot live in `ROWS` —
 * but the write path only needs the namespace/key/kind triple.
 */
const PERMISSION_ROW: SettingRow = {
  id: 'permission.defaultPreset', ns: 'permission', key: 'defaultPreset',
  label: 'Default permission preset', description: 'fallback tool policy, per-call editable',
  kind: 'string', values: [],
}

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
    description: row.description,
    currentValue: current,
    values: presets.includes(current) ? presets : [current, ...presets],
  }
}

/** The built panel rows plus their id → display-string map. */
interface BuiltItems {
  /** The item list, in group order. */
  readonly items: BlueSettingItem[]
  /** Each row's display value by id — the panel's last-known baseline. */
  readonly values: Map<string, string>
}

/**
 * Build the panel's items from a fresh `describe()`: every static row
 * whose namespace the host registered (absent namespaces drop their rows),
 * then the permission preset row when both the namespace and the presets
 * service exist, then the open-file action.
 * @param settings - the host settings service.
 * @param presets - the permission presets table, when the host has one.
 * @returns the item list, in group order, plus the id → display map.
 */
function buildItems(settings: SettingsProvider, presets: PermissionPresetsService | undefined): BuiltItems {
  const described = new Map(settings.describe().map(descriptor => [String(descriptor.ns), descriptor]))
  const items: BlueSettingItem[] = []
  const values = new Map<string, string>()
  const push = (item: BlueSettingItem): void => {
    items.push(item)
    values.set(item.id, item.currentValue)
  }
  for (const row of ROWS) {
    const descriptor = described.get(row.ns)
    if (descriptor === undefined) continue
    push(settingItem(row, (descriptor.value as Record<string, unknown>)[row.key]))
  }
  const permission = described.get('permission')
  if (permission !== undefined && presets !== undefined) {
    const raw = (permission.value as Record<string, unknown>).defaultPreset
    const current = typeof raw === 'string' ? raw : String(presets.names[0] ?? '')
    push({
      id: PERMISSION_ROW.id,
      label: PERMISSION_ROW.label,
      description: 'applies to new sessions',
      currentValue: current,
      values: presets.names.includes(current) ? [...presets.names] : [current, ...presets.names],
    })
  }
  push({
    id: OPEN_FILE_ID, label: 'Open settings.yaml in $EDITOR',
    description: 'edit the raw document; changes hot-reload',
    currentValue: '', values: [''],
  })
  return { items, values }
}

/** Parse a cycled string back into the row's value type. */
function parseValue(row: SettingRow, newValue: string): boolean | number | string {
  if (row.kind === 'boolean') return newValue === 'true'
  if (row.kind === 'number') return Number(newValue)
  return newValue
}

/** The panel's feedback row state; shared with the handler across remounts. */
export interface SettingsPanelNotice {
  /** The latest outcome; `undefined` renders a blank (height-holding) row. */
  current?: { readonly text: string; readonly error: boolean } | undefined
}

/** Constructor options for {@link SettingsPanel}. */
export interface SettingsPanelOptions {
  /** Theme supplying the frame's rule/title/hint colors. */
  readonly theme: BlueTheme
  /** The settings list this panel frames. */
  readonly list: BlueSettingsList
  /** The shared feedback-row state (write outcomes; the editor's hint line is unmounted while a panel is open). */
  readonly notice: SettingsPanelNotice
  /** ANSI-safe width truncation for the feedback row (the components service's truncateToWidth). */
  readonly truncate: (text: string, width: number) => string
}

/**
 * The framed `/settings` surface: the pi-tui settings list wrapped in the
 * S12 dialog chrome (`settings` title, muted key-hint footer, full-width
 * rules). Input delegates to the list — its keybindings own Up/Down,
 * Enter/Space, and Escape. The body's last row is the feedback line (write
 * outcomes — the editor hint line leaves the tree with the editor, so panel
 * feedback must live in the frame), and the body is ratchet-padded to the
 * tallest height seen: the description zone's wrap count varies per row,
 * and an unpadded frame would grow and shrink on every cursor move.
 */
export class SettingsPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  /** The tallest body rendered so far; the panel never shrinks below it. */
  private maxBodyRows = 0

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
   * Render the framed dialog: the list's body rows, then the feedback row
   * (always exactly one — blank when no outcome is pending), ratchet-padded
   * to the running max height, between full-width rules with the title and
   * the muted key-hint footer. `framePanel` owns the width discipline for
   * the chrome and the degenerate-width cut; the list budgets its own rows
   * at every normal width.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const colors = this.options.theme.colors
    const notice = this.options.notice.current
    const noticeRow = notice === undefined
      ? ''
      : this.options.truncate((notice.error ? colors.error : colors.textMuted)(`  ${notice.text}`), width)
    const body = [...this.options.list.render(width), noticeRow]
    this.maxBodyRows = Math.max(this.maxBodyRows, body.length)
    while (body.length < this.maxBodyRows) body.push('')
    return framePanel(body, width, {
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
      /* v8 ignore next -- the placeholder runs only if the panel settles
         before its mount returns, which the building order forbids */
      let restore: () => void = () => {}
      /** The mounted list; `mount` assigns it before any reader can run. */
      let list: BlueSettingsList
      /** The mounted panel; `mount` assigns it before any reader can run. */
      let panel: SettingsPanel
      /** The id → display-string map of what the mounted list shows. */
      let lastKnown: Map<string, string> = new Map()

      /** The feedback-row state shared with every mounted panel instance. */
      const panelNotice: SettingsPanelNotice = {}
      /**
       * Flash an outcome in the panel's feedback row. The editor's hint
       * line leaves the tree with the editor while a panel is open (D30),
       * so `getSharedEditor()?.notice` is invisible here — panel feedback
       * must render inside the frame.
       */
      const notice = (text: string, error = false): void => {
        panelNotice.current = { text, error }
        display.screen.requestRender()
      }

      /** Rebuild the whole panel from a fresh describe() and remount it. */
      const rebuild = (): void => {
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
        const row = ROWS_BY_ID.get(id) ?? (id === PERMISSION_ROW.id ? PERMISSION_ROW : undefined)
        if (row === undefined) return
        const ns = settingsNamespace(row.ns)
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
              // The list already displays the rejected cycle: roll the row
              // back to the last committed display string.
              const known = lastKnown.get(id)
              if (known !== undefined) list.updateValue(id, known)
              const message = error instanceof Error ? error.message : String(error)
              notice(`could not update ${row.label.toLowerCase()}: ${message}`, true)
            }
            return
          }
          if (inactive()) return
          // No rebuild: the list's own cycle already displays the value,
          // and the commit's document-updated emission diffs empty against
          // this lastKnown update.
          lastKnown.set(id, newValue)
          notice(`${row.label.toLowerCase()} set to ${newValue}`)
          return
        }
      }

      /**
       * The open-file row: materialize the document, hand it to the
       * external editor behind a screen suspend (the Ctrl-G discipline),
       * and write the edited text back — the host file watcher's
       * document-updated emission refreshes the panel.
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
        const built = buildItems(settings, presets)
        lastKnown = built.values
        list = display.components.createSettingsList({
          items: built.items,
          onChange: (id, newValue) => {
            void write(id, newValue)
          },
          onCancel: () => {
            close()
          },
        })
        panel = new SettingsPanel({
          // Live palette read (the /theme picker discipline): a swap
          // rebuilds the input fiber mid-commit, and the snapshot at open
          // would freeze the frame in the opening theme.
          theme: {
            get colors() {
              /* v8 ignore next -- the fallback arm only renders inside the
                 provider gap of an in-flight swap, never in a settled state */
              return ctx.get('blueTheme')?.colors ?? display.colors
            },
          },
          list,
          notice: panelNotice,
          truncate: (text, width) => display.components.truncateToWidth(text, width),
        })
        restore = mountEditorReplacement(panel)
      }

      /**
       * Re-claim the editor's dock slot: a theme swap rebuilds the input
       * fiber (unmounting the panel with the old one), so the SAME panel
       * instance mounts fresh — the list keeps its highlight and the swap
       * lands under the open panel.
       */
      const rehome = (): void => {
        if (inactive()) return
        restore()
        restore = mountEditorReplacement(panel)
      }

      // The input fiber's mount emits before its slot-swap machinery
      // installs; one microtask later the panel re-homes against the fresh
      // swap (the /theme picker's deferral).
      const offEditorChanged = ctx.on('blue/input-editor-changed', () => {
        void Promise.resolve().then(rehome)
      })

      /** Tear the panel down: unsubscribe, pop the dock slot. */
      const close = (): void => {
        /* v8 ignore next -- the list fires exactly one cancel per mount */
        if (closed) return
        closed = true
        offDocument()
        offEditorChanged()
        restore()
      }

      // Live while the panel is open: the host file watcher announces
      // external edits (and our own commits) here. Refresh diffs the fresh
      // describe() against lastKnown and pushes only the changed rows'
      // values into the live list — self-commits land after lastKnown
      // moved, so they repaint nothing; a changed row set (a namespace
      // appeared or disappeared) is the only remount.
      const offDocument = ctx.on('settings/document-updated', () => {
        if (inactive()) return
        const presets = ctx.get('permissionPresets') as PermissionPresetsService | undefined
        const built = buildItems(settings, presets)
        // buildItems' order is deterministic, so the joined keys compare
        // the row set (same membership lands in the same order).
        if ([...built.values.keys()].join('') !== [...lastKnown.keys()].join('')) {
          rebuild()
          return
        }
        let changed = false
        for (const [id, value] of built.values) {
          if (lastKnown.get(id) !== value) {
            list.updateValue(id, value)
            changed = true
          }
        }
        lastKnown = built.values
        if (changed) display.screen.requestRender()
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
