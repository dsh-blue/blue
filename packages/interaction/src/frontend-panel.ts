/**
 * TUI consumer for a renderer-neutral frontend PanelModel. Domain plugins
 * publish readonly views and structured actions; this adapter owns terminal
 * framing, scrolling, key routing, and width enforcement.
 *
 * @module @dsh-blue/blue-interaction/frontend-panel
 */

import { renderFrontendView, type BlueComponents, type BlueFocusable, type BlueKeymap, type BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { Action, PanelModel } from '@dsh-blue/blue-frontend'
import { ACTION_CANCEL, ACTION_SUBMIT } from './keys.ts'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const PAGE_SCROLL = 10
const DEFAULT_MAX_VISIBLE = 20

/** Construction options for the generic frontend panel consumer. */
export interface FrontendPanelOptions {
  readonly keymap: BlueKeymap
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly model: () => PanelModel
  readonly onAction: (action: Action) => void | Promise<void>
  readonly onClose: () => void
  readonly maxVisible?: number
}

/** Framed, scrollable consumer for renderer-neutral info/loading/error panels. */
export class FrontendPanel implements BlueFocusable {
  focused = false
  private scrollTop = 0

  constructor(private readonly options: FrontendPanelOptions) {}

  handleInput(data: string): void {
    const { keymap } = this.options
    if (keymap.matches(data, ACTION_CANCEL) || data === 'q' || data === 'Q') {
      this.options.onClose()
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      const action = this.options.model().submit
      if (action === undefined) this.options.onClose()
      else void this.options.onAction(action)
      return
    }
    if (data === KEY_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - 1)
      return
    }
    if (data === KEY_DOWN) {
      this.scrollTop += 1
      return
    }
    if (data === KEY_PAGE_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - PAGE_SCROLL)
      return
    }
    if (data === KEY_PAGE_DOWN) this.scrollTop += PAGE_SCROLL
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { components, theme } = this.options
    const model = this.options.model()
    const budget = Math.max(1, Math.floor(width) - 4)
    const content = model.view === undefined ? [] : [...renderFrontendView(model.view, budget)].map(row => `  ${components.truncateToWidth(row, budget)}`)
    const maxVisible = Math.max(5, this.options.maxVisible ?? DEFAULT_MAX_VISIBLE)
    const body: string[] = []
    if (content.length > maxVisible) {
      this.scrollTop = Math.max(0, Math.min(this.scrollTop, content.length - maxVisible))
      const slice = content.slice(this.scrollTop, this.scrollTop + maxVisible)
      body.push(...slice)
      body.push(theme.colors.textMuted(components.truncateToWidth(
        ` showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + slice.length)} of ${String(content.length)}`,
        Math.max(1, width),
      )))
    } else {
      this.scrollTop = 0
      body.push(...content)
    }
    const submit = model.submit === undefined ? 'Esc / q to close' : 'Enter to refresh · Esc / q to close'
    return framePanel(body, width, {
      title: model.title.toLowerCase(),
      titlePaint: model.mode === 'error' ? theme.colors.error : theme.colors.primary,
      titleHint: `· ${submit} · ↑↓ scroll`,
      hintPaint: theme.colors.textMuted,
      rulePaint: model.mode === 'error' ? theme.colors.error : theme.colors.primary,
    })
  }
}
