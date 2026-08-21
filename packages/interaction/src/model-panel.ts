/**
 * The model-family panels: `ModelPanel` — the `/model` picker over the
 * llm catalog (kimi's model selector port: name/provider columns, context
 * metadata, the `← current` badge, and the footer thinking-segment control
 * that adjusts the highlighted model's effort draft with ←/→) — and
 * `EffortPanel`, the horizontal `/effort` selector sharing the same segment
 * chrome. Both mount through the D30 editor-slot replacement and resolve
 * their keys through `ctx.blueKeymap`.
 *
 * ModelPanel keeps its own list geometry: the tab strip and type-to-search
 * interleave chrome the S24b shared `SelectListPanel` (select-list.ts)
 * cannot carry. Revisit only if a second tabbed panel appears.
 *
 * @module @dsh-blue/blue-interaction/model-panel
 */

import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import {
  ACTION_CANCEL,
  ACTION_MOVE_DOWN,
  ACTION_MOVE_UP,
  ACTION_SEGMENT_LEFT,
  ACTION_SEGMENT_RIGHT,
  ACTION_SESSION_ONLY,
  ACTION_SUBMIT,
} from './keys.ts'
import {
  SEGMENT_CAPTION,
  SEGMENT_UNSUPPORTED,
  cycleSegment,
  renderSegments,
  type ThinkingSegment,
} from './thinking-segments.ts'
import { CURRENT_MARK, SELECT_POINTER } from './symbols.ts'

/** Rows of models rendered at once; longer lists scroll. */
const MAX_VISIBLE = 8

/**
 * Format a token count as a 1024-base context size (`128k`, `1m`).
 * @param tokens - the context window in tokens.
 * @returns the compact size string.
 */
export function formatContextWindow(tokens: number): string {
  if (tokens < 1024) return `${tokens}`
  const units = ['k', 'm', 'g']
  let value = tokens
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = Number.isInteger(value) || value >= 10 ? `${Math.round(value)}` : value.toFixed(1)
  return `${text}${units[unit]}`
}

/** One selectable model row. */
export interface ModelPanelItem {
  /** The provider route the model belongs to. */
  readonly provider: string
  /** The provider's display name for the `Provider/model` row label. */
  readonly providerLabel: string
  /** The provider-owned model id. */
  readonly id: string
  /** The display name (the model's `name`, falling back to its id). */
  readonly name: string
  /** The resolved context window, when `resolveModelInfo` answered. */
  readonly contextWindow?: number
  /** The resolved reasoning efforts, when the model exposes any. */
  readonly efforts?: readonly string[]
  /** The model's default effort, when the metadata carries one. */
  readonly defaultEffort?: string
  /** Renders the `← current` badge on the row. */
  readonly current?: boolean
}

/** Construction options for {@link ModelPanel}. */
export interface ModelPanelOptions {
  /** Keybinding registry used to resolve the panel keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the row, metadata, and badge colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width measurement/truncation helpers. */
  readonly components: BlueComponents
  /** Models to choose from, in catalog order; must not be empty. */
  readonly items: readonly ModelPanelItem[]
  /** The live session's effective effort; seeds the current row's draft. */
  readonly currentEffort?: string
  /** Cautionary line rendered as the first body row (the cache warning). */
  readonly warning?: string
  /** Dialog title; defaults to `Select a model`. */
  readonly title?: string
  /**
   * Called with the highlighted model and its effort draft when the switch
   * key is pressed; the draft is `undefined` for models without efforts.
   * @param item - the highlighted model row.
   * @param effort - the segment draft's effort id.
   */
  readonly onSelect: (item: ModelPanelItem, effort: string | undefined) => void
  /** Same payload as {@link ModelPanelOptions.onSelect} but session-only (no persisted default). */
  readonly onSessionOnlySelect: (item: ModelPanelItem, effort: string | undefined) => void
  /** Called when the cancel key is pressed. */
  readonly onCancel: () => void
}

/**
 * The `/model` picker: Up/Down wrap the cursor, ←/→ adjust the highlighted
 * model's thinking-effort draft, Enter switches (persisting the default),
 * Alt+S switches session-only, Escape cancels.
 */
export class ModelPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0
  /** The live fuzzy query (kimi's type-to-search). */
  private query = ''
  /** The active provider tab: 0 = All, then the distinct provider labels. */
  private tab = 0
  /** Per-row effort-draft indexes into each item's `efforts`; rows without efforts stay `-1`. */
  private readonly drafts: number[]

  /**
   * @param options - see {@link ModelPanelOptions}.
   */
  constructor(private readonly options: ModelPanelOptions) {
    const currentEffort = options.currentEffort
    this.drafts = options.items.map(item => {
      const efforts = item.efforts
      if (efforts === undefined || efforts.length === 0) return -1
      // The current row's draft starts at the live effort when the current
      // model still lists it; every other row starts at the model default
      // (or the first effort when the metadata carries no default).
      const seed = item.current === true && currentEffort !== undefined
        ? efforts.indexOf(currentEffort)
        : -1
      const fallback = item.defaultEffort !== undefined ? efforts.indexOf(item.defaultEffort) : -1
      return seed >= 0 ? seed : Math.max(0, fallback)
    })
    const currentRow = options.items.findIndex(item => item.current === true)
    this.cursor = currentRow >= 0 ? currentRow : 0
  }

  /**
   * Dispatch one input sequence against the panel keybindings.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap } = this.options
    const view = this.filtered()
    if (keymap.matches(data, ACTION_MOVE_UP)) {
      this.cursor = this.cursor === 0 ? view.length - 1 : this.cursor - 1
      return
    }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) {
      this.cursor = this.cursor === view.length - 1 ? 0 : this.cursor + 1
      return
    }
    if (keymap.matches(data, ACTION_SEGMENT_LEFT) || keymap.matches(data, ACTION_SEGMENT_RIGHT)) {
      const direction = keymap.matches(data, ACTION_SEGMENT_LEFT) ? -1 : 1
      /* v8 ignore next -- the cursor always indexes the filtered view */
      const viewIndex = view[this.cursor] === undefined
        ? this.cursor
        : this.options.items.indexOf(view[this.cursor]!)
      const item = this.options.items[viewIndex]
      /* v8 ignore next -- drafts and items stay index-aligned */
      const draft = this.drafts[viewIndex] ?? -1
      const efforts = item?.efforts
      if (item !== undefined && efforts !== undefined && efforts.length > 0) {
        this.drafts[viewIndex] = cycleSegment(draft, efforts.length, direction)
      }
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT) || keymap.matches(data, ACTION_SESSION_ONLY)) {
      const item = view[this.cursor]
      if (item === undefined) return
      const effort = this.effortOf(item)
      if (keymap.matches(data, ACTION_SESSION_ONLY)) this.options.onSessionOnlySelect(item, effort)
      else this.options.onSelect(item, effort)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) {
      // The kimi rule: Escape clears a live query before it cancels.
      if (this.query.length > 0) {
        this.query = ''
        this.reseedCursor()
        return
      }
      this.options.onCancel()
      return
    }
    // Tab / Shift-Tab toggle the provider tab (kimi's tabbed selector).
    if (data === '\t' || data === '\x1b[Z') {
      this.tab = (this.tab + 1) % this.tabs().length
      this.reseedCursor()
      return
    }
    // Type-to-search: printable characters grow the query, Backspace
    // shrinks it.
    if (data === '\x7f') {
      this.query = this.query.slice(0, -1)
      this.reseedCursor()
      return
    }
    if (data.length === 1 && data >= ' ') {
      this.query += data
      this.reseedCursor()
    }
  }

  /** The distinct provider labels: `['All', …]` in item order — a single
   * provider catalog keeps the bare `['All']` and renders no strip. */
  private tabs(): string[] {
    const labels: string[] = []
    for (const item of this.options.items) {
      if (!labels.includes(item.providerLabel)) labels.push(item.providerLabel)
    }
    return labels.length > 1 ? ['All', ...labels] : ['All']
  }

  /** The items under the active tab and the live query. */
  private filtered(): readonly ModelPanelItem[] {
    const tabs = this.tabs()
    const byTab = this.tab === 0
      ? this.options.items
      : this.options.items.filter(item => item.providerLabel === tabs[this.tab])
    if (this.query.length === 0) return byTab
    return byTab.filter(item =>
      this.options.components.fuzzyMatch(this.query, `${item.providerLabel}/${item.name}`).matches)
  }

  /** Re-anchor the cursor after a tab or query change: the current row,
   * else the head of the filtered view. */
  private reseedCursor(): void {
    const view = this.filtered()
    const current = view.findIndex(item => item.current === true)
    this.cursor = current >= 0 ? current : 0
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the kimi-model-selector layout: the full-width rules, the
   * title with its `(type to search)` suffix, the key-hint row under it,
   * the provider tab strip, the live search row, the visible window of
   * model rows (`Provider Name/model` labels with metadata and the
   * current badge), and the thinking-segment footer control.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { components, theme } = this.options
    const colors = theme.colors
    const view = this.filtered()
    const boldOpen = '\x1b[1m'
    const boldClose = '\x1b[22m'
    const title = this.options.title ?? 'Select a model'
    const lines: string[] = [
      colors.primary('─'.repeat(Math.max(1, width))),
      components.truncateToWidth(
        this.query.length === 0
          ? `${boldOpen}${colors.primary(`  ${title}`)}${boldClose}${colors.textMuted('  (type to search)')}`
          : `${boldOpen}${colors.primary(`  ${title}`)}${boldClose}`,
        width,
      ),
      components.truncateToWidth(`  ${colors.textMuted(this.hintRow())}`, width),
      '',
    ]
    const warning = this.options.warning
    if (warning !== undefined) {
      lines.push(colors.warning(components.truncateToWidth(`  ${warning}`, width)), '')
    }
    const tabs = this.tabs()
    if (tabs.length > 1) {
      const cells = tabs.map((label, index) => index === this.tab
        ? `${boldOpen}${colors.primary(label)}${boldClose}`
        : colors.textMuted(label))
      lines.push(components.truncateToWidth(`  ${cells.join('   ')}`, width), '')
    }
    if (this.query.length > 0) {
      lines.push(`${colors.primary(' Search: ')}${colors.text(this.query)}`, '')
    }
    const start = Math.max(0, Math.min(
      this.cursor - Math.floor(MAX_VISIBLE / 2),
      view.length - MAX_VISIBLE,
    ))
    const end = Math.min(start + MAX_VISIBLE, view.length)
    const nameCap = Math.max(8, Math.floor(width / 2))
    for (let index = start; index < end; index += 1) {
      const item = view[index]
      /* v8 ignore next -- start/end are clamped to view.length */
      if (item === undefined) continue
      lines.push(this.renderRow(item, index === this.cursor, nameCap, width))
    }
    if (view.length > MAX_VISIBLE) {
      lines.push(colors.textMuted(`  (${this.cursor + 1}/${view.length})`))
    }
    const highlighted = view[this.cursor]
    const viewIndex = highlighted === undefined
      ? this.cursor
      : this.options.items.indexOf(highlighted)
    const efforts = highlighted?.efforts
    const draft = this.drafts[viewIndex] ?? -1
    lines.push(
      '',
      colors.textMuted(`  ${SEGMENT_CAPTION}`),
      efforts === undefined || efforts.length === 0 || highlighted === undefined
        ? colors.textMuted(`  ${SEGMENT_UNSUPPORTED}`)
        : components.truncateToWidth(`  ${renderSegments(
            efforts.map(id => ({ id, label: effortLabel(id) })),
            draft,
            theme,
          )}`, width),
      colors.primary('─'.repeat(Math.max(1, width))),
    )
    return lines
  }

  /** The key-hint fragments under the title (the kimi hint row). */
  private hintRow(): string {
    const { keymap } = this.options
    /* v8 ignore next -- the panel keys are always registered */
    const key = (action: string): string => keymap.getKeys(action)[0] ?? action
    const parts = [
      ...(this.tabs().length > 1 ? ['tab toggle provider'] : []),
      `${key(ACTION_MOVE_UP)}/${key(ACTION_MOVE_DOWN)} navigate`,
      `${key(ACTION_SEGMENT_LEFT)}/${key(ACTION_SEGMENT_RIGHT)} thinking`,
      `${key(ACTION_SUBMIT)} select`,
      `${key(ACTION_SESSION_ONLY)} session-only`,
      `${key(ACTION_CANCEL)} cancel`,
    ]
    return parts.join(' · ')
  }

  /** The highlighted row's effort draft, or `undefined` when it has no efforts. */
  private effortOf(item: ModelPanelItem): string | undefined {
    const efforts = item.efforts
    if (efforts === undefined || efforts.length === 0) return undefined
    /* v8 ignore next -- drafts and items stay index-aligned */
    const draft = this.drafts[this.options.items.indexOf(item)] ?? -1
    /* v8 ignore next -- the draft always indexes a listed effort */
    return efforts[draft] ?? efforts[0]
  }

  /**
   * Render one model row: the pointer lead, the `Provider Name/model`
   * label (the dogfood ruling — `deepseek official/deepseek-v4-flash`),
   * then the context metadata and current badge appended while the
   * remaining width allows (dropped left-to-right trailing cells first
   * under width pressure).
   */
  private renderRow(item: ModelPanelItem, isCursor: boolean, nameCap: number, width: number): string {
    const { components, theme } = this.options
    const colors = theme.colors
    const label = `${item.providerLabel}/${item.name}`
    const rawName = components.visibleWidth(label) > nameCap
      ? `${components.truncateToWidth(label, nameCap - 1)}…`
      : label
    const nameCell = rawName.padEnd(nameCap, ' ')
    const leadWidth = 4
    let used = components.visibleWidth(nameCell)
    const budget = Math.max(leadWidth + used, width) - leadWidth
    /** Append a two-space-gapped cell when it fits, truncated when it partly fits, else nothing. */
    const append = (cell: string): string => {
      if (used + 2 + components.visibleWidth(cell) <= budget) {
        used += 2 + components.visibleWidth(cell)
        return cell
      }
      const remaining = budget - used - 2
      if (remaining > 4) {
        const cut = components.truncateToWidth(cell, remaining)
        used += 2 + components.visibleWidth(cut)
        return cut
      }
      return ''
    }
    const contextCell = item.contextWindow === undefined
      ? ''
      : append(`· ctx ${formatContextWindow(item.contextWindow)}`)
    const badgeCell = item.current === true ? append(CURRENT_MARK) : ''
    const boldOpen = '\x1b[1m'
    const boldClose = '\x1b[22m'
    const pointer = isCursor ? colors.primary(SELECT_POINTER) : ' '
    const name = isCursor
      ? `${boldOpen}${colors.primary(nameCell)}${boldClose}`
      : colors.text(nameCell)
    let row = `  ${pointer} ${name}`
    if (contextCell !== '') row += ` ${colors.textMuted(contextCell)}`
    if (badgeCell !== '') row += `  ${colors.success(badgeCell)}`
    return row
  }


}

/** Capitalize an effort id for its segment label (`low` → `Low`). */
function effortLabel(id: string): string {
  /* v8 ignore next -- effort ids are never empty */
  return id.length === 0 ? id : id[0]!.toUpperCase() + id.slice(1)
}

/** Construction options for {@link EffortPanel}. */
export interface EffortPanelOptions {
  /** Keybinding registry used to resolve the panel keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the segment colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width truncation helper. */
  readonly components: BlueComponents
  /** The selectable segments, in order (the `default` segment first). */
  readonly segments: readonly ThinkingSegment[]
  /** The initially active segment's index. */
  readonly activeIndex: number
  /**
   * Called with the highlighted segment's id when the set key is pressed.
   * @param id - the segment id (`default` maps to clearing the effort).
   */
  readonly onSelect: (id: string) => void
  /** Same payload as {@link EffortPanelOptions.onSelect} but session-only. */
  readonly onSessionOnlySelect: (id: string) => void
  /** Called when the cancel key is pressed. */
  readonly onCancel: () => void
}

/**
 * The `/effort` selector: the shared horizontal segments with ←/→
 * wraparound, Enter applies (persisting the default), Alt+S applies
 * session-only, Escape cancels.
 */
export class EffortPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private cursor: number

  /**
   * @param options - see {@link EffortPanelOptions}.
   */
  constructor(private readonly options: EffortPanelOptions) {
    this.cursor = options.activeIndex
  }

  /**
   * Dispatch one input sequence against the panel keybindings.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap, segments } = this.options
    if (keymap.matches(data, ACTION_SEGMENT_LEFT) || keymap.matches(data, ACTION_SEGMENT_RIGHT)) {
      const direction = keymap.matches(data, ACTION_SEGMENT_LEFT) ? -1 : 1
      this.cursor = cycleSegment(this.cursor, segments.length, direction)
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT) || keymap.matches(data, ACTION_SESSION_ONLY)) {
      const segment = segments[this.cursor]
      if (segment === undefined) return
      if (keymap.matches(data, ACTION_SESSION_ONLY)) this.options.onSessionOnlySelect(segment.id)
      else this.options.onSelect(segment.id)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) this.options.onCancel()
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed selector: the segment row under the panel title.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { theme, segments } = this.options
    /* v8 ignore next -- the panel keys are always registered */
    const key = (action: string): string => this.options.keymap.getKeys(action)[0] ?? action
    const { components } = this.options
    return framePanel(
      // Clip the segment row like the /model footer control does.
      ['', components.truncateToWidth(`  ${renderSegments(segments, this.cursor, theme)}`, Math.max(width, 1))],
      Math.max(width, 1),
      {
        title: 'Thinking effort',
        titlePaint: theme.colors.primary,
        rulePaint: theme.colors.primary,
        footer: [
          `${key(ACTION_SEGMENT_LEFT)}/${key(ACTION_SEGMENT_RIGHT)} switch`,
          `${key(ACTION_SUBMIT)} set`,
          `${key(ACTION_SESSION_ONLY)} session`,
          `${key(ACTION_CANCEL)} cancel`,
        ],
        footerPaint: theme.colors.textMuted,
      },
    )
  }
}

export { effortLabel }
