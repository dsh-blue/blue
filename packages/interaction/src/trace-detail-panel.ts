/** Full-screen, scrollable raw JSON window opened from the trace timeline. */

import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { TraceItem } from './trace-format.ts'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const DETAIL_VISIBLE_LINES = 14
const PAGE_SCROLL = DETAIL_VISIBLE_LINES

/** Dependencies and callbacks for {@link TraceDetailPanel}. */
export interface TraceDetailPanelOptions {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly keymap: BlueKeymap
  readonly item: TraceItem
  readonly text: string
  readonly onClose: () => void
}

/** A dedicated detail window for one trace item. */
export class TraceDetailPanel implements BlueFocusable {
  focused = false
  private scrollTop = 0

  constructor(private readonly options: TraceDetailPanelOptions) {}

  handleInput(data: string): void {
    if (this.options.keymap.matches(data, 'blue.interaction.cancel') || data === 'q' || data === 'Q') {
      this.options.onClose()
      return
    }
    const lines = this.lines()
    const maxScroll = Math.max(0, lines.length - DETAIL_VISIBLE_LINES)
    if (data === KEY_UP) this.scrollTop = Math.max(0, this.scrollTop - 1)
    else if (data === KEY_DOWN) this.scrollTop = Math.min(maxScroll, this.scrollTop + 1)
    else if (data === KEY_PAGE_UP) this.scrollTop = Math.max(0, this.scrollTop - PAGE_SCROLL)
    else if (data === KEY_PAGE_DOWN) this.scrollTop = Math.min(maxScroll, this.scrollTop + PAGE_SCROLL)
    else if (data === 'g') this.scrollTop = 0
    else if (data === 'G') this.scrollTop = maxScroll
    this.invalidate()
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { colors } = this.options.theme
    const { components, item } = this.options
    const lines = this.lines()
    const maxScroll = Math.max(0, lines.length - DETAIL_VISIBLE_LINES)
    this.scrollTop = Math.min(this.scrollTop, maxScroll)
    const visible = lines.slice(this.scrollTop, this.scrollTop + DETAIL_VISIBLE_LINES)
    const body: string[] = [
      '',
      colors.textMuted(`  ${item.type} · ${item.surface} · source #${String(item.seq)}`),
    ]
    for (const line of visible) body.push(this.paintJsonLine(line, width))
    for (let index = visible.length; index < DETAIL_VISIBLE_LINES - 1; index += 1) body.push('')
    const end = Math.min(lines.length, this.scrollTop + DETAIL_VISIBLE_LINES)
    body.push(colors.textMuted(components.truncateToWidth(
      `  lines ${String(this.scrollTop + 1)}-${String(end)} of ${String(lines.length)} · ↑↓ line · PgUp/PgDn page · g/G top/end`,
      Math.max(1, width),
    )))
    return framePanel(body, width, {
      title: `Trace detail ${item.lastSeq === item.seq ? `#${String(item.seq)}` : `#${String(item.seq)}-${String(item.lastSeq)}`}`,
      titleHint: '· Esc / q to close',
      hintPaint: colors.textMuted,
      titlePaint: colors.primary,
      rulePaint: colors.primary,
    })
  }

  private lines(): string[] {
    return this.options.text.split('\n')
  }

  private paintJsonLine(line: string, width: number): string {
    const { colors } = this.options.theme
    const trimmed = line.trimStart()
    const indent = line.slice(0, line.length - trimmed.length)
    const key = /^("[^"\n]+":)(.*)$/.exec(trimmed)
    if (key === null) return colors.textMuted(componentsTruncate(this.options.components, `  ${line}`, width))
    const prefixWidth = 2 + this.options.components.visibleWidth(indent) + key[1]!.length
    const value = componentsTruncate(this.options.components, key[2]!, Math.max(1, width - prefixWidth))
    return colors.textMuted(`  ${indent}`) + colors.accent(key[1]!) + colors.text(value)
  }
}

function componentsTruncate(components: BlueComponents, text: string, width: number): string {
  return components.truncateToWidth(text, Math.max(1, width))
}

