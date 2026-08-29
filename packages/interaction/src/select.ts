/**
 * Canonical multi-select and panel adapters for editor-slot overlays.
 * Interaction state stays local while core compiles every public UI node.
 *
 * @module @dsh-blue/blue-interaction/select
 */

import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_SUBMIT, ACTION_TOGGLE } from './keys.ts'
import { MAX_LIST_VISIBLE, counterRow, cycle, oneLine, windowedRange } from './select-list.ts'

/** One selectable entry. */
export interface BlueSelectItem { readonly value: string, readonly label: string, readonly description?: string }

/** Construction options for {@link CanonicalMultiSelectController}. */
export interface BlueSelectOptions {
  readonly keymap: BlueKeymap
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly items: readonly BlueSelectItem[]
  readonly title?: string
  readonly onConfirm: (items: BlueSelectItem[]) => void
  readonly onCancel: () => void
}

/** Canonical multi-select controller with wraparound and fallback confirm. */
export class CanonicalMultiSelectController implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private cursor = 0
  private readonly toggled = new Set<string>()

  constructor(private readonly options: BlueSelectOptions) {
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
    const { keymap, items } = this.options
    if (keymap.matches(data, ACTION_MOVE_UP)) { this.move(-1); return }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) { this.move(1); return }
    if (keymap.matches(data, ACTION_TOGGLE)) {
      const value = items[this.cursor]?.value
      if (value !== undefined) this.onEvent({
        kind: 'selection-change', controlId: 'blue-select',
        value: this.toggled.has(value) ? [...this.toggled].filter(id => id !== value) : [...this.toggled, value],
      })
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) { this.options.onConfirm(this.confirmed()); return }
    if (keymap.matches(data, ACTION_CANCEL)) this.options.onCancel()
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current canonical overlay node. */
  currentNode(): BlueUiNode {
    const range = windowedRange(this.cursor, this.options.items.length, MAX_LIST_VISIBLE)
    const counter = counterRow(this.cursor, this.options.items.length, MAX_LIST_VISIBLE)
    return {
      kind: 'surface', chrome: 'overlay', title: this.options.title ?? 'Select',
      child: {
        kind: 'list', id: 'blue-select', mode: 'multiple', selectedIds: [...this.toggled],
        items: this.options.items.slice(range.start, range.end).map(item => ({
          id: item.value, label: item.label,
          ...(item.description === undefined ? {} : { detail: oneLine(item.description) }),
        })),
      },
      footer: { kind: 'text', content: [counter, this.footer()].filter(Boolean).join(' · '), tone: 'muted' },
    }
  }

  private move(delta: 1 | -1): void {
    this.cursor = cycle(this.cursor, this.options.items.length, delta)
    this.adapter.invalidate()
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind !== 'selection-change' || event.controlId !== 'blue-select' || !Array.isArray(event.value)) return
    this.toggled.clear()
    for (const value of event.value) if (typeof value === 'string') this.toggled.add(value)
    this.adapter.invalidate()
  }

  private confirmed(): BlueSelectItem[] {
    const chosen = this.options.items.filter(item => this.toggled.has(item.value))
    if (chosen.length > 0) return [...chosen]
    const focused = this.options.items[this.cursor]
    return focused === undefined ? [] : [focused]
  }

  private footer(): string {
    const key = (action: string): string => this.options.keymap.getKeys(action)[0] ?? action
    return `${key(ACTION_MOVE_UP)}/${key(ACTION_MOVE_DOWN)} move · ${key(ACTION_TOGGLE)} toggle · ${key(ACTION_SUBMIT)} confirm · ${key(ACTION_CANCEL)} cancel`
  }
}
