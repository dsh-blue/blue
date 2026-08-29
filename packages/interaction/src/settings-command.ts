/**
 * The `/settings` command and its two-level panel: level one picks a
 * settings namespace, level two edits that namespace's keys through
 * `components.createSettingsList` — both mounted through the D30
 * editor-slot swap (`mountEditorReplacement`), so Escape on level two pops
 * back to level one and Escape there restores the editor. The inventory
 * covers Blue's own `blue.*` (update check, default theme, folding
 * defaults, transcript window/fold tunables, the external-editor command,
 * the paste backend), the shell and agent-loop limits, the default model's
 * reasoning effort, the DeepSeek adapter's thinking switch, web search,
 * the permission preset and the agent preset for NEW sessions; a trailing
 * level-one row opens the prepared settings document in the external
 * editor (the level-one notice controller renders that action's outcomes
 * while no level-two panel is mounted).
 *
 * Rows are preset cycles: Enter/Space steps the value (a current value
 * outside the presets is merged in as the selection, a row declaring an
 * `unsetValue` cycles into it and unsets the key so it re-inherits the
 * schema's omission semantics). Rows marked `editable` instead open a
 * single-field form on Enter for free-form text, an empty submission
 * unsetting the key. Every accepted change writes through
 * `settings.update` (deep-merge) — or `settings.mutate` for an unset —
 * with the descriptor revision; a stale revision (`SettingsConflictError`)
 * re-reads and retries once, and outcomes land on the panel's own feedback
 * row (the editor's hint line leaves the tree while a panel is open, D30).
 * A descriptor declaring `applies: 'restart'` surfaces as a description
 * suffix.
 *
 * The core adapter surfaces pi-tui's `updateValue` (one entry's displayed
 * value, in place), so refresh is diff-and-update instead of a whole-panel
 * rebuild: an accepted write updates the panel's `lastKnown` value map and
 * leaves the mounted list alone, a failed write rolls the row back through
 * `updateValue`, and a `settings/document-updated` emission (the host file
 * watcher fires it after an external edit) re-describes and pushes only
 * the changed rows' values into the live level-two list. A changed row set
 * (a namespace appeared or disappeared) remounts the open panels through
 * the shared mount closures. The service reads are lazy `ctx.get` — this
 * fiber must never become a theme dependent (the `/theme` swap disposes
 * dependents). A theme commit from the panel's own Theme row still
 * rebuilds the input fiber mid-swap, whose teardown unmounts the dock
 * slot: the panel re-homes the SAME instances (both levels, plus an open
 * form) on a deferred `'blue/input-editor-changed'` emission — the
 * `/theme` picker discipline, so the lists keep their highlight — and
 * reads its palette through a live getter.
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
import type { SettingsDescriptor, SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import { CanonicalPanelAdapter, type CanonicalNodeSource } from './canonical-panel.ts'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { resolveExternalEditorCommand, runExternalEditor } from './external-editor.ts'
import { currentBlueSettings } from './settings.ts'
import { CanonicalFormController } from './form-panel.ts'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_SUBMIT, ACTION_TOGGLE } from './keys.ts'
import type { PermissionPresetsService } from './permission-panel.ts'
import { CanonicalSelectController } from './select-list.ts'
import { interactionTranslator, observeInteractionLocale } from './locale.ts'

/** The level-one action row opening the settings document in an editor. */
const OPEN_FILE_ID = 'open-file'

/** One panel row's identity, display, and write semantics. */
interface SettingRow {
  /** Stable id reported by the list's change callback (`ns.key`). */
  readonly id: string
  /** The settings namespace the write targets. */
  readonly ns: string
  /** The section key the write patches. */
  readonly key: string
  /** The row label. */
  readonly label: string
  /** One-line description shown while the row is highlighted. Required: a
   *  row without one drops the list's description zone and makes the panel
   *  height jump as the highlight moves. */
  readonly description: string
  /** Value parsing for the write: cycled strings become booleans/numbers. */
  readonly kind: 'boolean' | 'number' | 'string'
  /** The preset cycle, in cycle order; empty on `editable` rows. */
  readonly values: readonly (boolean | number | string)[]
  /**
   * Display token cycling with the presets but meaning "unset the key"
   * (the write goes through `settings.mutate`, so the field re-inherits
   * the schema's omission semantics). Also the display when the resolved
   * section omits the key.
   */
  readonly unsetValue?: string
  /**
   * Enter opens a single-field free-form input instead of cycling; an
   * empty submission unsets the key.
   */
  readonly editable?: boolean
  /** What an editable row displays while unset (the raw value is blank). */
  readonly emptyDisplay?: string
  /** Optional raw value token to package-owned display-label mapping. */
  readonly valueLabels?: Readonly<Record<string, string>>
}

/** The static rows, in panel order; the dynamic rows join per namespace. */
const ROWS: readonly SettingRow[] = [
  {
    id: 'locale.preference', ns: 'locale', key: 'preference', label: 'Language',
    description: 'Blue display language; system follows the operating system', kind: 'string',
    values: ['zh', 'en'], unsetValue: 'system',
    valueLabels: { system: 'Follow system', zh: '中文', en: 'English' },
  },
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
    id: 'blue.windowTurns', ns: 'blue', key: 'windowTurns', label: 'Transcript window (turns)',
    description: 'completed turns kept mounted', kind: 'number', values: [5, 10, 15, 30, 50],
  },
  {
    id: 'blue.recentStepsRetention', ns: 'blue', key: 'recentStepsRetention', label: 'Recent steps kept',
    description: 'steps of a turn keeping their cards', kind: 'number', values: [10, 20, 30, 50, 100],
  },
  {
    id: 'blue.expandTurns', ns: 'blue', key: 'expandTurns', label: 'Ctrl-O range (turns)',
    description: 'turns the expansion toggle reaches back', kind: 'number', values: [1, 2, 3, 5, 10],
  },
  {
    id: 'blue.userFoldLines', ns: 'blue', key: 'userFoldLines', label: 'User fold lines',
    description: 'lines of a user message before it folds', kind: 'number', values: [5, 10, 20, 50],
  },
  {
    id: 'blue.userFoldChars', ns: 'blue', key: 'userFoldChars', label: 'User fold chars',
    description: 'characters of a user message before it folds', kind: 'number', values: [500, 1000, 2000, 5000],
  },
  {
    id: 'blue.editorCommand', ns: 'blue', key: 'editorCommand', label: 'External editor',
    description: 'ctrl+g editor command; empty follows $VISUAL/$EDITOR', kind: 'string',
    values: [], editable: true, emptyDisplay: 'auto',
  },
  {
    id: 'blue.pasteImageBackend', ns: 'blue', key: 'pasteImageBackend', label: 'Paste backend',
    description: 'linux clipboard backend for image paste', kind: 'string', values: ['auto', 'wayland', 'x11'],
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
    id: 'shell.maxSpillBytes', ns: 'shell', key: 'maxSpillBytes', label: 'Shell spill budget (bytes)',
    description: 'on-disk spill cap for oversized output', kind: 'number',
    values: [16_777_216, 67_108_864, 268_435_456],
  },
  {
    id: 'shell.graceMs', ns: 'shell', key: 'graceMs', label: 'Shell grace (ms)',
    description: 'termination grace before SIGKILL', kind: 'number', values: [1_000, 3_000, 5_000, 10_000],
  },
  {
    id: 'agent-loop.maxParallelToolCalls', ns: 'agent-loop', key: 'maxParallelToolCalls',
    label: 'Max parallel tool calls', description: 'concurrent tool call cap',
    kind: 'number', values: [1, 5, 10, 20, 50],
  },
  {
    id: 'agent-default-model.reasoningEffort', ns: 'agent-default-model', key: 'reasoningEffort',
    label: 'Default reasoning effort', description: 'default = omit effort', kind: 'string',
    values: ['off', 'low', 'high', 'max'], unsetValue: 'default',
  },
  {
    id: 'llm-deepseek.thinking', ns: 'llm-deepseek', key: 'thinking', label: 'DeepSeek thinking',
    description: 'adapter thinking switch; default = adapter choice', kind: 'string',
    values: ['enabled', 'disabled'], unsetValue: 'default',
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

/** Row lookup for the change callback, dynamic rows included. */
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

/** The dynamic agent-preset row; its cycle comes from the roster's ids. */
const AGENT_PRESET_ROW: SettingRow = {
  id: 'agent-presets.default', ns: 'agent-presets', key: 'default',
  label: 'Default agent preset', description: 'applies to new sessions; none = composition default',
  kind: 'string', values: [], unsetValue: 'none',
}

/**
 * One-line level-one blurbs per known namespace. The host's
 * SettingsDescriptor carries no summary field, so the panel supplies its
 * own; a namespace without an entry (a row added without its blurb) falls
 * back to the bare count.
 */
const NS_BLURBS: Readonly<Record<string, string>> = {
  blue: 'Blue UI preferences',
  shell: 'bash tool limits',
  'agent-loop': 'agent loop parallelism',
  'agent-default-model': 'model request defaults',
  'llm-deepseek': 'DeepSeek adapter options',
  'web-search-deepseek': 'web search limits',
  permission: 'tool policy presets',
  'agent-presets': 'composition preset default',
}

/** All writable rows by id. */
function rowById(id: string): SettingRow | undefined {
  if (id === PERMISSION_ROW.id) return PERMISSION_ROW
  if (id === AGENT_PRESET_ROW.id) return AGENT_PRESET_ROW
  return ROWS_BY_ID.get(id)
}

/**
 * Render a row's current value for the right column: booleans and numbers
 * stringify, an omitted key with an `unsetValue` reads as that token, a
 * blank editable string reads as its `emptyDisplay`, anything else falls
 * back to the first cycle entry (blank when the cycle is empty — the
 * permission row on an empty presets table).
 * @param row - the row definition.
 * @param raw - the resolved section value for the row's key.
 * @param cycle - the row's effective cycle (dynamic rows pass theirs in;
 *   `row.values` is empty for them).
 * @returns the display string.
 */
function displayValue(
  row: SettingRow,
  raw: unknown,
  cycle: readonly (boolean | number | string)[] = row.values,
): string {
  if (raw === undefined && row.unsetValue !== undefined) return row.unsetValue
  if (typeof raw === 'boolean') return String(raw)
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') {
    return raw === '' && row.emptyDisplay !== undefined ? row.emptyDisplay : raw
  }
  return String(cycle[0] ?? '')
}

/**
 * Build one list entry for a row: the preset cycle as strings (an
 * `unsetValue` cycling first), with a current value outside the cycle
 * merged in as the selection. Editable rows carry a single-entry cycle —
 * their own current value — so activation reports without changing the
 * display; the change callback opens the form instead.
 * @param row - the row definition.
 * @param raw - the resolved section value for the row's key.
 * @param cycle - the row's value cycle (dynamic rows fill theirs here).
 * @param applies - the descriptor's effect timing; `'restart'` surfaces as
 *   a description suffix.
 * @param t - active interaction translator.
 * @returns the settings-list item.
 */
function settingItem(
  row: SettingRow,
  raw: unknown,
  cycle: readonly (boolean | number | string)[] = row.values,
  applies: SettingsDescriptor['applies'] | undefined,
  t: BlueTranslate,
): SettingsItem {
  const current = displayValue(row, raw, cycle)
  const presets = [...(row.unsetValue === undefined ? [] : [row.unsetValue]), ...cycle.map(String)]
  return {
    id: row.id,
    label: t(row.label),
    description: applies === 'restart' ? `${t(row.description)} · ${t('restart to apply')}` : t(row.description),
    currentValue: current,
    values: row.editable === true ? [current] : presets.includes(current) ? presets : [current, ...presets],
    ...(row.valueLabels === undefined
      ? {}
      : { valueLabels: Object.fromEntries(Object.entries(row.valueLabels).map(([value, label]) => [value, t(label)])) }),
  }
}

/** One namespace's built rows. */
interface SettingGroup {
  /** The namespace, also the level-one row's label. */
  readonly ns: string
  /** The level-two items, in row order. */
  readonly items: readonly SettingsItem[]
}

/** Canonical settings row with its preset cycle. */
export interface SettingsItem {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly currentValue: string
  readonly values: readonly string[]
  /** Raw value token to localized display label. */
  readonly valueLabels?: Readonly<Record<string, string>>
}

/** The built groups plus their id → display-string and raw-value maps. */
interface BuiltGroups {
  /** The groups, in panel order (only namespaces the host registered). */
  readonly groups: readonly SettingGroup[]
  /** Each row's display value by id — the panel's last-known baseline. */
  readonly values: Map<string, string>
  /** Each editable row's current raw text by id (the form's prefill). */
  readonly raws: Map<string, string>
}

/** The services dynamic rows draw their value cycles from. */
interface RowDynamics {
  /** The permission presets table, when the host has one. */
  readonly presets?: PermissionPresetsService | undefined
  /** The agent-preset ids from the roster, when the host has one. */
  readonly agentPresetIds?: readonly string[] | undefined
}

/**
 * Build the namespace groups from a fresh `describe()`: every static row
 * whose namespace the host registered (absent namespaces drop their rows,
 * groups form in first-appearance order), then the dynamic permission and
 * agent-preset rows when both their namespace and their value source
 * exist.
 * @param settings - the host settings service.
 * @param dynamics - the dynamic rows' value sources.
 * @param t - active interaction translator.
 * @returns the groups, plus the id → display and id → raw maps.
 */
function buildGroups(settings: SettingsProvider, dynamics: RowDynamics, t: BlueTranslate): BuiltGroups {
  const described = new Map(settings.describe().map(descriptor => [String(descriptor.ns), descriptor]))
  const groups: SettingGroup[] = []
  const values = new Map<string, string>()
  const raws = new Map<string, string>()
  const push = (ns: string, item: SettingsItem): void => {
    let group = groups.find(entry => entry.ns === ns)
    if (group === undefined) {
      group = { ns, items: [] as SettingsItem[] }
      groups.push(group)
    }
    ;(group.items as SettingsItem[]).push(item)
    values.set(item.id, item.currentValue)
  }
  for (const row of ROWS) {
    const descriptor = described.get(row.ns)
    if (descriptor === undefined) continue
    const raw = (descriptor.value as Record<string, unknown>)[row.key]
    push(row.ns, settingItem(row, raw, row.values, descriptor.applies, t))
    if (row.editable === true) raws.set(row.id, typeof raw === 'string' ? raw : '')
  }
  const permission = described.get('permission')
  if (permission !== undefined && dynamics.presets !== undefined) {
    const raw = (permission.value as Record<string, unknown>).defaultPreset
    push('permission', settingItem(PERMISSION_ROW, raw, [...dynamics.presets.names], permission.applies, t))
  }
  const agentPresets = described.get('agent-presets')
  if (agentPresets !== undefined && dynamics.agentPresetIds !== undefined) {
    const raw = (agentPresets.value as Record<string, unknown>).default
    push('agent-presets', settingItem(AGENT_PRESET_ROW, raw, [...dynamics.agentPresetIds], agentPresets.applies, t))
  }
  return { groups, values, raws }
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

/** Constructor options for {@link CanonicalSettingsController}. */
export interface SettingsPanelOptions {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly keymap: BlueKeymap
  readonly items: readonly SettingsItem[]
  readonly title: string
  readonly footer: readonly string[]
  readonly notice: SettingsPanelNotice
  readonly onChange: (id: string, value: string) => void
  readonly onCancel: () => void
}

/**
 * The framed level-two `/settings` surface: the pi-tui settings list
 * wrapped in the S12 dialog chrome (namespace title, muted key-hint
 * footer, full-width rules). Input delegates to the list — its keybindings
 * own Up/Down, Enter/Space, and Escape. The body's last row is the
 * feedback line (write outcomes — the editor hint line leaves the tree
 * with the editor, so panel feedback must live in the frame), and the body
 * is ratchet-padded to the tallest height seen: the description zone's
 * wrap count varies per row, and an unpadded frame would grow and shrink
 * on every cursor move.
 */
export class CanonicalSettingsController implements BlueFocusable, CanonicalNodeSource {
  /** Controlled value replacements applied after commits or refreshes. */
  readonly updates: Array<readonly [string, string]> = []
  private readonly adapter: CanonicalPanelAdapter
  private readonly values = new Map<string, string>()
  private items: readonly SettingsItem[]
  private title: string
  private footer: readonly string[]
  private cursor = 0

  constructor(readonly options: SettingsPanelOptions) {
    this.items = options.items
    this.title = options.title
    this.footer = options.footer
    for (const item of options.items) this.values.set(item.id, item.currentValue)
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onUnhandledEscape: options.onCancel,
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  handleInput(data: string): void {
    if (this.options.keymap.matches(data, ACTION_MOVE_UP)) { this.move(-1); return }
    if (this.options.keymap.matches(data, ACTION_MOVE_DOWN)) { this.move(1); return }
    if (this.options.keymap.matches(data, ACTION_CANCEL)) { this.options.onCancel(); return }
    if (this.options.keymap.matches(data, ACTION_SUBMIT) || this.options.keymap.matches(data, ACTION_TOGGLE)) this.activate()
  }

  /** Replace one row's controlled display value. */
  updateValue(id: string, value: string): void {
    if (!this.values.has(id)) return
    this.values.set(id, value)
    this.updates.push([id, value])
    this.adapter.invalidate()
  }

  /** Replace localized copy in place while retaining raw values and cursor id. */
  updatePresentation(items: readonly SettingsItem[], title: string, footer: readonly string[]): void {
    const selectedId = this.items[this.cursor]?.id
    const ids = new Set(items.map(item => item.id))
    for (const id of this.values.keys()) if (!ids.has(id)) this.values.delete(id)
    for (const item of items) if (!this.values.has(item.id)) this.values.set(item.id, item.currentValue)
    this.items = items
    this.title = title
    this.footer = footer
    const selected = selectedId === undefined ? -1 : items.findIndex(item => item.id === selectedId)
    this.cursor = selected >= 0 ? selected : Math.min(this.cursor, Math.max(0, items.length - 1))
    this.adapter.invalidate()
  }

  /** Readonly item/value snapshot for interaction state consumers and tests. */
  snapshotItems(): readonly SettingsItem[] {
    return this.items.map(item => ({ ...item, currentValue: this.values.get(item.id)! }))
  }

  /** Apply a structured value choice without bypassing the UI-event mapper. */
  changeValue(id: string, value: string): void {
    if (!this.values.has(id)) return
    this.onEvent({ kind: 'selection-change', controlId: 'settings-list', value: `${id}\u0000${value}` })
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  currentNode(): BlueUiNode {
    const current = this.options.notice.current
    return {
      kind: 'surface', chrome: 'overlay', title: this.title,
      child: {
        kind: 'list', id: 'settings-list', selectedIds: this.items[this.cursor] === undefined ? [] : [this.items[this.cursor]!.id],
        items: this.items.map(item => ({
          id: item.id,
          label: `${item.label}: ${item.valueLabels?.[this.values.get(item.id)!] ?? this.values.get(item.id)!}`,
          detail: item.description,
        })),
      },
      footer: {
        kind: 'stack', direction: 'column', children: [
          { node: { kind: 'text', content: this.footer.join(' · '), tone: 'muted' } },
          ...(current === undefined ? [] : [{ node: { kind: 'text', content: current.text, tone: current.error ? 'danger' : 'muted' } as const }]),
        ],
      },
    }
  }

  private move(delta: 1 | -1): void {
    if (this.items.length === 0) return
    this.cursor = (this.cursor + this.items.length + delta) % this.items.length
    this.adapter.invalidate()
  }

  private activate(): void {
    const item = this.items[this.cursor]
    if (item === undefined) return
    const current = this.values.get(item.id)!
    const index = Math.max(0, item.values.indexOf(current))
    const value = item.values.length === 0 ? current : item.values[(index + 1) % item.values.length]!
    this.onEvent({ kind: 'selection-change', controlId: 'settings-list', value: `${item.id}\u0000${value}` })
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind !== 'selection-change' || event.controlId !== 'settings-list' || typeof event.value !== 'string') return
    const separator = event.value.indexOf('\u0000')
    if (separator < 0) return
    const id = event.value.slice(0, separator)
    const value = event.value.slice(separator + 1)
    this.values.set(id, value)
    this.adapter.invalidate()
    this.options.onChange(id, value)
  }
}

/** Constructor options for {@link SettingsNoticeController}. */
export interface NoticeTailOptions {
  readonly inner: CanonicalNodeSource
  readonly components: BlueComponents
  readonly theme: BlueTheme
  readonly notice: SettingsPanelNotice
}

/**
 * The level-one `/settings` surface: the namespace selector with the
 * shared feedback row tailed under its frame. Level two owns the write
 * feedback, but the open-file action lives on level one — its outcomes (no
 * editor configured, an unreadable document) land while no level-two panel
 * is mounted, so level one renders the same notice state (always exactly
 * one row: the blank holds the frame geometry).
 */
export class SettingsNoticeController implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter

  constructor(private readonly options: NoticeTailOptions) {
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: () => {},
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value; this.options.inner.focused = value }

  /**
   * Delegate one input sequence to the wrapped list panel.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    this.options.inner.handleInput(data)
    this.adapter.invalidate()
  }

  /** No cached render state of its own; the inner panel keeps its own. */
  invalidate(): void {
    this.options.inner.invalidate()
    this.adapter.invalidate()
  }

  /**
   * Render the inner panel's frame, then the feedback row below it.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] { return this.adapter.render(width) }

  currentNode(): BlueUiNode {
    const current = this.options.notice.current
    return {
      kind: 'stack', direction: 'column',
      children: [
        { node: this.options.inner.currentNode() },
        ...(current === undefined ? [] : [{ node: { kind: 'text', content: current.text, tone: current.error ? 'danger' : 'muted' } as const }]),
      ],
    }
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
    description: 'Edit user settings by namespace (update, theme, folding, transcript, shell, agent, search, permission)',
    handler: async (): Promise<CommandResult> => {
      const t = interactionTranslator(ctx)
      const settings = ctx.get('settings')
      if (settings === undefined) {
        return { kind: 'error', text: t('settings service unavailable on this host') }
      }
      const display = displayServices(ctx)
      if (display === undefined) {
        return { kind: 'error', text: t('settings panel is unavailable: the Blue screen is not mounted') }
      }

      let closed = false
      const inactive = (): boolean => unloaded || closed
      /* v8 ignore next -- the placeholder runs only if the panel settles
         before its mount returns, which the building order forbids */
      let restoreGroups: () => void = () => {}
      let restoreList: (() => void) | undefined
      let restoreForm: (() => void) | undefined
      /** The level-one panel and its notice-tail wrapper; `mountGroups`
       *  assigns both before any reader. */
      let groupsPanel: CanonicalSelectController
      let groupsTail: SettingsNoticeController
      /** The level-two list and panel; assigned while a namespace is open. */
      let listPanel: CanonicalSettingsController | undefined
      /** The open free-form form, if any. */
      let formPanel: CanonicalFormController | undefined
      let offLocale: () => void
      let chain: Promise<void> = Promise.resolve()
      /** The namespace open on level two, if any. */
      let openNs: string | undefined
      /** The id → display-string map of what the mounted lists show. */
      let lastKnown: Map<string, string> = new Map()
      /** The latest build; `refreshGroups` reassigns before any rebuild. */
      let built: BuiltGroups = { groups: [], values: new Map(), raws: new Map() }

      /** The feedback-row state shared with every mounted panel instance. */
      const panelNotice: SettingsPanelNotice = {}
      /**
       * Flash an outcome in the panel's feedback row. The editor's hint
       * line leaves the tree with the editor while a panel is open (D30),
       * so `getSharedEditor(ctx)?.notice` is invisible here — panel feedback
       * must render inside the frame.
       */
      const notice = (text: string, error = false): void => {
        panelNotice.current = { text, error }
        groupsTail?.invalidate()
        listPanel?.invalidate()
        display.screen.requestRender()
      }

      /**
       * Live palette read (the /theme picker discipline): a swap rebuilds
       * the input fiber mid-commit, and the snapshot at open would freeze
       * the frame in the opening theme.
       */
      const liveTheme: BlueTheme = {
        get colors() {
          /* v8 ignore next -- the fallback arm only renders inside the
             provider gap of an in-flight swap, never in a settled state */
          return ctx.get('blueTheme')?.colors ?? display.colors
        },
      }

      /** Build the groups, fetching the dynamic rows' value sources. */
      const fetchGroups = async (): Promise<BuiltGroups> => {
        const presets = ctx.get('permissionPresets') as PermissionPresetsService | undefined
        // Discovery failures degrade to omitting the row, like a host
        // without the roster.
        const listed = await ctx.blueSessionActions.presets()
        const agentPresetIds = listed.ok ? listed.value.map(row => row.id) : undefined
        return buildGroups(settings, { presets, agentPresetIds }, t)
      }

      /** Current localized level-one rows; raw namespace ids stay stable. */
      const groupRows = () => [
        ...built.groups.map(group => ({
          value: group.ns,
          label: group.ns,
          description: NS_BLURBS[group.ns] === undefined
            ? t('{count} settings', { count: group.items.length })
            : t('{description} · {count} settings', {
                description: t(NS_BLURBS[group.ns]!),
                count: group.items.length,
              }),
        })),
        {
          value: OPEN_FILE_ID,
          label: t('Open settings.yaml in $EDITOR'),
          description: t('edit the raw document; changes hot-reload'),
        },
      ]

      /** Mount level two for one namespace on top of the level-one panel. */
      const openList = (ns: string): void => {
        const group = built.groups.find(entry => entry.ns === ns)
        /* v8 ignore next -- both callers (the level-one select, the rebuild)
           only pass namespaces the current build carries */
        if (group === undefined) return
        openNs = ns
        listPanel = new CanonicalSettingsController({
          theme: liveTheme,
          components: display.components,
          keymap: display.keymap,
          title: t('settings › {namespace}', { namespace: ns }),
          footer: [t('↑↓ select'), t('↵ change'), t('esc back')],
          items: group.items,
          notice: panelNotice,
          onChange: (id, newValue) => {
            void activate(id, newValue)
          },
          onCancel: () => {
            backToGroups()
          },
        })
        restoreList = mountEditorReplacement(ctx, listPanel)
      }

      /**
       * Mount level one: one row per namespace plus the open-file action.
       * @param seed - the namespace row to seed the cursor on (the rebuild
       *   re-seats the cursor on the namespace the user had open).
       */
      const mountGroups = (seed?: string): void => {
        groupsPanel = new CanonicalSelectController({
          keymap: display.keymap,
          theme: liveTheme,
          components: display.components,
          rows: groupRows(),
          title: 'settings',
          titleHint: '· esc close · ↵ open',
          t,
          ...(seed === undefined ? {} : { initialValue: seed }),
          onSelect: (row) => {
            if (row.value === OPEN_FILE_ID) {
              void openSettingsFile()
              return
            }
            openList(row.value)
          },
          onCancel: () => {
            close()
          },
        })
        groupsTail = new SettingsNoticeController({
          inner: groupsPanel,
          components: display.components,
          theme: liveTheme,
          notice: panelNotice,
        })
        restoreGroups = mountEditorReplacement(ctx, groupsTail)
      }

      /** Pop the free-form form, if one is open. */
      const popForm = (): void => {
        restoreForm?.()
        restoreForm = undefined
        formPanel = undefined
      }

      /** Pop level two (and any form above it), back to the namespace list. */
      const backToGroups = (): void => {
        popForm()
        restoreList?.()
        restoreList = undefined
        listPanel = undefined
        openNs = undefined
      }

      /**
       * Re-claim the editor's dock slot: a theme swap rebuilds the input
       * fiber (unmounting the panels with the old one), so the SAME panel
       * instances mount fresh in stack order — the lists keep their
       * highlight and the swap lands under the open panel.
       */
      const rehome = (): void => {
        if (inactive()) return
        restoreForm?.()
        restoreList?.()
        restoreGroups()
        restoreGroups = mountEditorReplacement(ctx, groupsTail)
        if (listPanel !== undefined) restoreList = mountEditorReplacement(ctx, listPanel)
        if (formPanel !== undefined) restoreForm = mountEditorReplacement(ctx, formPanel)
      }

      // The input fiber's mount emits before its slot-swap machinery
      // installs; one microtask later the panels re-home against the fresh
      // swap (the /theme picker's deferral).
      const offEditorChanged = ctx.on('blue/input-editor-changed', () => {
        void Promise.resolve().then(rehome)
      })

      /** Tear every level down: unsubscribe, pop the dock slots. */
      const close = (): void => {
        if (closed) return
        closed = true
        offLocale()
        offDocument()
        offEditorChanged()
        restoreForm?.()
        restoreList?.()
        restoreGroups()
      }

      /**
       * Commit one row's next value: fresh revision, one conflict retry,
       * then the outcome notice. Never rejects — every failure lands on
       * the notice channel.
       * @param row - the row being written.
       * @param unset - true unsets the key (re-inheriting the schema's
       *   omission semantics) instead of patching a value.
       * @param value - the parsed value to patch when not unsetting.
       * @param display - the committed display string for `lastKnown`.
       * @param pushToList - true pushes the display into the live list
       *   (the form path, where pi-tui's own cycle never moved it).
       */
      const commitRow = async (
        row: SettingRow,
        unset: boolean,
        value: unknown,
        display: string,
        pushToList: boolean,
      ): Promise<void> => {
        const ns = settingsNamespace(row.ns)
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const descriptor = settings.describe().find(entry => String(entry.ns) === row.ns)
          if (descriptor === undefined) return
          try {
            if (unset) {
              await settings.mutate(ns, [{ op: 'unset', path: [row.key] }], descriptor.revision)
            } else {
              await settings.update(ns, { [row.key]: value } as object, descriptor.revision)
            }
          } catch (error) {
            if (error instanceof SettingsConflictError && attempt === 0) continue
            if (!inactive()) {
              // The list already displays the rejected cycle: roll the row
              // back to the last committed display string.
              const known = lastKnown.get(row.id)
              /* v8 ignore next -- lastKnown covers every mounted row; the
                 guard only fires when a mid-write rebuild already dropped it */
              if (known !== undefined) listPanel?.updateValue(row.id, known)
              const message = error instanceof Error ? error.message : String(error)
              notice(t('could not update {label}: {message}', {
                label: t(row.label).toLocaleLowerCase('en'),
                message,
              }), true)
            }
            return
          }
          if (inactive()) return
          // No rebuild: the commit's document-updated emission diffs empty
          // against this lastKnown update.
          lastKnown.set(row.id, display)
          built.raws.set(row.id, unset ? '' : String(value))
          if (pushToList) listPanel?.updateValue(row.id, display)
          notice(t('{label} set to {value}', {
            label: t(row.label).toLocaleLowerCase('en'),
            value: row.valueLabels?.[display] === undefined ? display : t(row.valueLabels[display]!),
          }))
          return
        }
      }

      /**
       * The list's change callback: cycle rows write the cycled value (an
       * `unsetValue` unsets); editable rows open the free-form form — their
       * single-entry cycle leaves the display untouched.
       */
      const activate = async (id: string, newValue: string): Promise<void> => {
        const row = rowById(id)
        if (row === undefined) return
        if (row.editable === true) {
          openForm(row)
          return
        }
        const unset = row.unsetValue !== undefined && newValue === row.unsetValue
        await commitRow(row, unset, unset ? undefined : parseValue(row, newValue), newValue, false)
      }

      /** Open the single-field form for an editable row, stacked above level two. */
      const openForm = (row: SettingRow): void => {
        const form = new CanonicalFormController({
          keymap: display.keymap,
          theme: liveTheme,
          components: display.components,
          title: row.label,
          subtitle: row.description,
          fields: [{
            id: 'value',
            label: row.label,
            /* v8 ignore next -- buildGroups records a raw for every
               editable row it pushes, and only editable rows open a form */
            initial: built.raws.get(row.id) ?? '',
          }],
          onSubmit: (values) => {
            popForm()
            /* v8 ignore next -- canonical form submit reports every field id */
            const text = (values['value'] ?? '').trim()
            /* v8 ignore next -- every editable row declares an emptyDisplay */
            void commitRow(row, text === '', text, text === '' ? row.emptyDisplay ?? 'default' : text, true)
          },
          onCancel: () => {
            popForm()
          },
          t,
        })
        formPanel = form
        restoreForm = mountEditorReplacement(ctx, form)
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
          notice(t('settings file unavailable'))
          return
        }
        const command = resolveExternalEditorCommand(process.env, currentBlueSettings(ctx).editorCommand)
        if (command === undefined) {
          notice(t('no editor configured ($VISUAL/$EDITOR)'))
          return
        }
        let text: string
        try {
          text = await readFile(path, 'utf-8')
        } catch (error) {
          /* v8 ignore next 1 -- node fs rejections are always Error instances */
          notice(t('could not read settings file: {message}', { message: error instanceof Error ? error.message : String(error) }))
          return
        }
        const edited = await display.screen.suspend(() => runExternalEditor(text, command))
        if (inactive()) return
        if (edited === undefined || edited === text) return
        try {
          await writeFile(path, edited, 'utf-8')
        } catch (error) {
          /* v8 ignore next 1 -- node fs rejections are always Error instances */
          notice(t('could not write settings file: {message}', { message: error instanceof Error ? error.message : String(error) }))
        }
      }

      /**
       * Remount the open panels after the row set changed (a namespace
       * appeared or disappeared): level one always, level two when its
       * namespace still exists.
       */
      const rebuildPanels = (): void => {
        const ns = openNs
        backToGroups()
        restoreGroups()
        mountGroups(ns)
        if (ns !== undefined && built.groups.some(group => group.ns === ns)) openList(ns)
      }

      /**
       * One document-updated pass: rebuild on a row-set change, otherwise
       * push changed values into the live level-two list. Self-commits land
       * after lastKnown moved, so they repaint nothing.
       */
      const refresh = async (): Promise<void> => {
        if (inactive()) return
        const next = await fetchGroups()
        if (inactive()) return
        // buildGroups' order is deterministic, so the joined keys compare
        // the row set (same membership lands in the same order).
        const sameRows = [...next.values.keys()].join('')
          === [...lastKnown.keys()].join('')
        built = next
        if (!sameRows) {
          lastKnown = next.values
          rebuildPanels()
          return
        }
        let changed = false
        if (listPanel !== undefined && openNs !== undefined) {
          const group = next.groups.find(entry => entry.ns === openNs)
          /* v8 ignore next -- the row-set compare above rebuilds (and returns)
             when the open namespace left the build, so its group is present */
          for (const item of group?.items ?? []) {
            if (lastKnown.get(item.id) !== item.currentValue) {
              listPanel.updateValue(item.id, item.currentValue)
              changed = true
            }
          }
        }
        lastKnown = next.values
        if (changed) display.screen.requestRender()
      }

      /** Reproject localized copy without replacing any mounted controller. */
      const refreshLocale = async (): Promise<void> => {
        if (inactive()) return
        const next = await fetchGroups()
        if (inactive()) return
        built = next
        lastKnown = next.values
        panelNotice.current = undefined
        groupsPanel.setRows(groupRows())
        if (listPanel !== undefined && openNs !== undefined) {
          const group = next.groups.find(entry => entry.ns === openNs)
          if (group !== undefined) {
            listPanel.updatePresentation(
              group.items,
              t('settings › {namespace}', { namespace: openNs }),
              [t('↑↓ select'), t('↵ change'), t('esc back')],
            )
          }
        }
        formPanel?.invalidate()
        groupsTail.invalidate()
        display.screen.requestRender()
      }

      // Live while the panel is open: the host file watcher announces
      // external edits (and our own commits) here. Refreshes serialize
      // behind the in-flight one, so rapid emissions never interleave a
      // rebuild with a diff.
      const offDocument = ctx.on('settings/document-updated', () => {
        chain = chain.then(refresh)
      })

      built = await fetchGroups()
      if (inactive()) return { kind: 'success' }
      lastKnown = built.values
      mountGroups()
      offLocale = observeInteractionLocale(ctx, () => {
        chain = chain.then(refreshLocale)
      })
      return { kind: 'success' }
    },
  })
  return () => {
    unloaded = true
    dispose()
  }
}
