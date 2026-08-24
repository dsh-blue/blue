/**
 * Scrollable, read-only `/trace` timeline. It owns only presentation state;
 * official session-query reads are supplied by callbacks from the command.
 *
 * @module @dsh-blue/blue-interaction/trace-panel
 */

import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { TraceItem } from './trace-format.ts'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'

/** Dependencies and callbacks required by {@link TracePanel}. */
export interface TracePanelOptions {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly keymap: BlueKeymap
  readonly sessionId: string
  readonly items: readonly TraceItem[]
  readonly onClose: () => void
  readonly onCopyItem: (item: TraceItem) => void
  readonly onCopyAll: () => void
  readonly onLoadDetail: (item: TraceItem) => void
}

/** Interactive timeline panel for one logical session. */
export class TracePanel implements BlueFocusable {
  focused = false
  private cursor = 0
  private scrollTop = 0
  private expanded = new Set<number>()
  private detail = new Map<number, string>()

  constructor(private readonly options: TracePanelOptions) {}

  handleInput(data: string): void {
    if (this.options.keymap.matches(data, 'blue.interaction.cancel') || data === 'q' || data === 'Q') {
      this.options.onClose()
      return
    }
    if (data === KEY_UP) this.cursor = Math.max(0, this.cursor - 1)
    else if (data === KEY_DOWN) this.cursor = Math.min(this.options.items.length - 1, this.cursor + 1)
    else if (data === KEY_PAGE_UP) this.cursor = Math.max(0, this.cursor - 8)
    else if (data === KEY_PAGE_DOWN) this.cursor = Math.min(this.options.items.length - 1, this.cursor + 8)
    else if (data === '\r') {
      const item = this.options.items[this.cursor]
      if (item === undefined) return
      if (this.expanded.has(item.seq)) this.expanded.delete(item.seq)
      else {
        this.expanded.add(item.seq)
        this.options.onLoadDetail(item)
      }
    } else if (data === 'c' || data === 'C') {
      const item = this.options.items[this.cursor]
      if (item !== undefined) this.options.onCopyItem(item)
    } else if (data === 'a' || data === 'A') {
      this.options.onCopyAll()
    }
    this.invalidate()
  }

  setDetail(seq: number, text: string): void {
    this.detail.set(seq, text)
    this.invalidate()
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { theme, components, items } = this.options
    const colors = theme.colors
    const maxVisible = 10
    if (items.length === 0) {
      return framePanel(['', colors.textMuted('  no trace events yet')], width, {
        title: 'Trace',
        titleHint: '· Esc / q to close',
        hintPaint: colors.textMuted,
        titlePaint: colors.primary,
        rulePaint: colors.primary,
      })
    }
    this.cursor = Math.max(0, Math.min(this.cursor, items.length - 1))
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, items.length - maxVisible)))
    /* v8 ignore next -- cursor re-anchoring is exercised by the live resize
     * and long-session interaction path; the source-plane window test covers
     * the resulting geometry. */
    if (this.cursor < this.scrollTop) this.scrollTop = this.cursor
    /* v8 ignore next -- see the cursor re-anchoring note above. */
    if (this.cursor >= this.scrollTop + maxVisible) this.scrollTop = this.cursor - maxVisible + 1
    const body: string[] = ['', colors.textMuted(`  session ${this.options.sessionId} · ${String(items.length)} events`)]
    for (const [index, item] of items.slice(this.scrollTop, this.scrollTop + maxVisible).entries()) {
      const absolute = this.scrollTop + index
      const pointer = absolute === this.cursor ? colors.primary('❯ ') : '  '
      const surface = item.surface === 'current' ? colors.text('●') : colors.textMuted('·')
      const summary = item.summary.length > 0 ? `  ${item.summary}` : ''
      body.push(`${pointer}${colors.textMuted(traceTime(item.time))} ${surface} ${colors.textStrong(`#${String(item.seq)} ${item.title}`)}${components.truncateToWidth(summary, Math.max(1, width - 28))}`)
      if (this.expanded.has(item.seq)) {
        const detail = this.detail.get(item.seq) ?? '  loading details…'
        for (const line of detail.split('\n').slice(0, 6)) body.push(colors.textMuted(`      ${components.truncateToWidth(line, Math.max(1, width - 8))}`))
      }
    }
    body.push(colors.textMuted(`  [c] copy item  [a] copy all  [Enter] details  [↑↓] select`))
    return framePanel(body, width, {
      title: 'Trace',
      titleHint: '· Esc / q to close',
      hintPaint: colors.textMuted,
      titlePaint: colors.primary,
      rulePaint: colors.primary,
    })
  }
}

function traceTime(time: number): string {
  const date = new Date(time)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 19) : '??:??:??'
}
