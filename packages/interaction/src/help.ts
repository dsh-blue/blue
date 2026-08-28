/**
 * Canonical `/help` overlay controller. The controller owns only close-key
 * interpretation and immutable help content; core owns chrome, wrapping,
 * semantic paint, post-wrap row accounting, and width containment.
 *
 * @module @dsh-blue/blue-interaction/help
 */

import type { BlueInlineSpan, BlueTone, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
import { ACTION_CANCEL, ACTION_SUBMIT } from './keys.ts'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const DEFAULT_MAX_VISIBLE = 16
const HELP_LEAF_PATH = '$.child'
const PASSIVE_EVENT_SINK = Function.prototype as () => void

/** One help entry. */
export interface HelpRow {
  readonly label: string
  readonly description: string
}

/** One headed group of help entries. */
export interface HelpSection {
  readonly heading: string
  readonly rows: readonly HelpRow[]
  /** Semantic label tone; renderer paint callbacks never cross this boundary. */
  readonly labelTone?: BlueTone
}

/** Construction options for {@link HelpOverlay}. */
export interface HelpOverlayOptions {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly keymap: BlueKeymap
  readonly sections: readonly HelpSection[]
  readonly onClose: () => void
  /** Maximum post-wrap content rows visible in the editor slot. */
  readonly maxVisible?: number
}

/** Canonical read-only help overlay. */
export class HelpOverlay implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private scrollTop = 0
  private contentRows: number
  private contentLimit: number

  constructor(private readonly options: HelpOverlayOptions) {
    this.contentRows = options.sections.reduce((total, section) => total + section.rows.length + 2, 0)
    this.contentLimit = Math.max(5, options.maxVisible ?? DEFAULT_MAX_VISIBLE)
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: PASSIVE_EVENT_SINK,
      onUnhandledEscape: options.onClose,
      maxLeafRows: this.contentLimit,
      leafRowWindowPath: HELP_LEAF_PATH,
      leafRowOffset: () => this.scrollTop,
      onLeafRowOffset: (offset, totalRows, limit) => {
        const changed = offset !== this.scrollTop || totalRows !== this.contentRows || limit !== this.contentLimit
        this.scrollTop = offset
        this.contentRows = totalRows
        this.contentLimit = limit
        if (changed) this.adapter.invalidate()
      },
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  /** Interpret only product close keys; canonical controls own rendering input. */
  handleInput(data: string): void {
    const { keymap } = this.options
    if (keymap.matches(data, ACTION_CANCEL) || keymap.matches(data, ACTION_SUBMIT) || data === 'q' || data === 'Q') {
      this.options.onClose()
      return
    }
    if (data === KEY_UP) { this.scrollTop = Math.max(0, this.scrollTop - 1); this.adapter.invalidate(); return }
    if (data === KEY_DOWN) { this.scrollTop += 1; this.adapter.invalidate(); return }
    if (data === KEY_PAGE_UP) { this.scrollTop = Math.max(0, this.scrollTop - this.contentLimit); this.adapter.invalidate(); return }
    if (data === KEY_PAGE_DOWN) { this.scrollTop += this.contentLimit; this.adapter.invalidate(); return }
    this.adapter.handleInput(data)
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current renderer-neutral help tree. */
  currentNode(): BlueUiNode {
    const spans: BlueInlineSpan[] = []
    for (const [sectionIndex, section] of this.options.sections.entries()) {
      spans.push({ text: `${sectionIndex === 0 ? '' : '\n\n'}${section.heading}`, tone: 'accent', emphasis: 'strong' })
      for (const row of section.rows) {
        spans.push(
          { text: `\n${row.label}`, tone: section.labelTone ?? 'default', emphasis: 'strong' },
          { text: `  ${row.description}`, tone: 'muted' },
        )
      }
    }
    const showing = this.contentRows > this.contentLimit
      ? `showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + Math.min(this.contentLimit, this.contentRows - this.scrollTop))} of ${String(this.contentRows)} · `
      : ''
    return {
      kind: 'surface',
      chrome: 'overlay',
      title: 'help',
      child: {
        kind: 'rich-text',
        spans,
      },
      footer: { kind: 'divider', label: `${showing}Esc / Enter / q to cancel` },
    }
  }
}
