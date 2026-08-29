/**
 * Canonical read-only information panel used by `/status`, `/usage`, MCP,
 * tools, skills, and session detail commands. Product callers provide only
 * semantic spans; core owns layout, paint, focus, and width containment.
 *
 * @module @dsh-blue/blue-interaction/info-panel
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
const INFO_LEAF_PATH = '$.child'
const PASSIVE_EVENT_SINK = Function.prototype as () => void

/** Legacy internal spelling mapped directly to canonical semantic tones. */
export type InfoStyle = 'text' | 'muted' | 'textMuted' | 'primary' | 'accent' | 'success' | 'warning' | 'error'

/** One semantic run in an info value. */
export interface InfoSegment {
  readonly text: string
  readonly style?: InfoStyle
}

/** One label/value row. */
export interface InfoRow {
  readonly label: string
  readonly segments: readonly InfoSegment[]
}

/** One headed group of info rows. */
export interface InfoSection {
  readonly heading: string
  readonly rows: readonly InfoRow[]
}

/** Construction options for {@link InfoPanel}. */
export interface InfoPanelOptions {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly keymap: BlueKeymap
  readonly title: string
  readonly sections: readonly InfoSection[]
  readonly onClose: () => void
  /** Maximum post-wrap content rows visible in the editor slot. */
  readonly maxVisible?: number
}

function tone(style: InfoStyle | undefined): BlueTone {
  switch (style) {
    case 'muted':
    case 'textMuted': return 'muted'
    case 'primary':
    case 'accent': return 'accent'
    case 'success': return 'success'
    case 'warning': return 'warning'
    case 'error': return 'danger'
    default: return 'default'
  }
}

function appendSpan(spans: BlueInlineSpan[], span: BlueInlineSpan): void {
  if (span.text.length === 0) return
  const previous = spans.at(-1)
  if (previous !== undefined && previous.tone === span.tone && previous.emphasis === span.emphasis) {
    spans[spans.length - 1] = { ...previous, text: `${previous.text}${span.text}` }
    return
  }
  spans.push(span)
}

/** Canonical information overlay. */
export class InfoPanel implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private scrollTop = 0
  private contentRows: number
  private contentLimit: number

  constructor(private readonly options: InfoPanelOptions) {
    this.contentRows = options.sections.reduce((total, section) => total + section.rows.length + 2, 0)
    this.contentLimit = Math.max(5, options.maxVisible ?? DEFAULT_MAX_VISIBLE)
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: PASSIVE_EVENT_SINK,
      onUnhandledEscape: options.onClose,
      maxLeafRows: this.contentLimit,
      leafRowWindowPath: INFO_LEAF_PATH,
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

  /** Interpret only close keys; the canonical compiler owns presentation input. */
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

  /** Current renderer-neutral information tree. */
  currentNode(): BlueUiNode {
    const spans: BlueInlineSpan[] = []
    for (const [sectionIndex, section] of this.options.sections.entries()) {
      appendSpan(spans, {
        text: `${sectionIndex === 0 ? '' : '\n\n'}${section.heading}`,
        tone: 'accent',
        emphasis: 'strong',
      })
      for (const row of section.rows) {
        const segments = row.segments.map(segment => ({ text: segment.text, tone: tone(segment.style) }))
        if (row.label.length > 0) {
          appendSpan(spans, { text: `\n${row.label}`, tone: 'muted' })
          appendSpan(spans, { text: '  ' })
          for (const segment of segments) appendSpan(spans, segment)
        } else if (segments.length > 0) {
          const [first, ...rest] = segments
          appendSpan(spans, { ...first!, text: `\n${first!.text}` })
          for (const segment of rest) appendSpan(spans, segment)
        } else {
          appendSpan(spans, { text: '\n' })
        }
      }
    }
    const showing = this.contentRows > this.contentLimit
      ? `showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + Math.min(this.contentLimit, this.contentRows - this.scrollTop))} of ${String(this.contentRows)} · `
      : ''
    return {
      kind: 'surface',
      chrome: 'overlay',
      title: this.options.title,
      child: { kind: 'rich-text', spans },
      footer: { kind: 'divider', label: `${showing}Esc / Enter / q to cancel` },
    }
  }
}
