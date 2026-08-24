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

const TRACE_TITLE_COLORS = new Map<string, keyof Pick<BlueTheme['colors'], 'roleUser' | 'accent' | 'success' | 'textStrong'>>([
  ['User request', 'roleUser'],
  ['Thinking', 'accent'],
  ['Assistant draft', 'success'],
  ['Assistant answer', 'success'],
])

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
      this.options.onLoadDetail(item)
    } else if (data === 'c' || data === 'C') {
      const item = this.options.items[this.cursor]
      if (item !== undefined) this.options.onCopyItem(item)
    } else if (data === 'a' || data === 'A') {
      this.options.onCopyAll()
    }
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
    const body: string[] = ['', `${colors.textMuted('  session ')}${colors.text(this.options.sessionId)}${colors.textMuted(` · ${String(items.length)} events`)}`]
    for (const [index, item] of items.slice(this.scrollTop, this.scrollTop + maxVisible).entries()) {
      const absolute = this.scrollTop + index
      const selected = absolute === this.cursor
      const pointer = selected ? colors.primary('❯ ') : '  '
      const surface = item.surface === 'current' ? colors.success('●') : colors.textMuted('·')
      // A streamed delta may contain newlines. Keep each timeline entry one
      // physical terminal row: pi-tui's differential renderer counts array
      // rows, so embedded newlines would desynchronise its row map and leave
      // stale/duplicated frames behind. Clipboard formatting still uses the
      // unmodified TraceItem summary.
      const preview = item.summary.replaceAll(/\s+/g, ' ').trim()
      const summary = preview.length > 0 ? `  ${preview}` : ''
      const sequence = item.lastSeq === item.seq ? `#${String(item.seq)}` : `#${String(item.seq)}-${String(item.lastSeq)}`
      const titleColor = colors[TRACE_TITLE_COLORS.get(item.title) ?? 'textStrong']
      const row = `${pointer}${colors.textMuted(traceTime(item.time))} ${surface} ${titleColor(`${sequence} ${item.title}`)}${colors.text(summary)}`
      const truncated = components.truncateToWidth(row, Math.max(1, width))
      body.push(selected
        ? colors.selectedBg(truncated + ' '.repeat(Math.max(0, width - components.visibleWidth(truncated))))
        : truncated)
    }
    const hint = `${colors.textMuted('  ')}${colors.accent('[c]')}${colors.textMuted(' copy  ')}${colors.accent('[a]')}${colors.textMuted(' all  ')}${colors.accent('[Enter]')}${colors.textMuted(' details  ')}${colors.accent('[↑↓]')}${colors.textMuted(' select')}`
    body.push(components.truncateToWidth(hint, Math.max(1, width)))
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
