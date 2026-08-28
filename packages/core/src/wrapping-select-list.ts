/**
 * Thin pi-tui state adapter for the slash-command autocomplete list. The
 * private pattern painter owns rows; this subclass retains pi-tui filtering,
 * selection, and key handling required by Editor's private factory seam.
 *
 * The single cast is pinned against pi-tui 0.84.2 by the companion spec.
 *
 * @module @dsh-blue/blue-core/wrapping-select-list
 */

import type { BlueListNode } from '@dsh-blue/blue-api'
import { SelectList, type SelectItem, type SelectListLayoutOptions, type SelectListTheme } from '@earendil-works/pi-tui'
import { renderAutocompleteList } from './ui-patterns.ts'

/** The private pi-tui row state the render override reads (see module doc). */
interface SelectListInternals {
  readonly filteredItems: SelectItem[]
  readonly selectedIndex: number
  readonly maxVisible: number
  readonly theme: SelectListTheme
  readonly layout: SelectListLayoutOptions
}

/** A select list whose canonical item descriptions wrap to at most two lines. */
export class WrappingSelectList extends SelectList {
  override render(width: number): string[] {
    const { filteredItems, selectedIndex, maxVisible, theme, layout } = this.internals()
    const node: BlueListNode = {
      kind: 'list',
      id: 'slash-autocomplete',
      selectedIds: filteredItems[selectedIndex] === undefined ? [] : [String(selectedIndex)],
      items: filteredItems.map((item, index) => ({
        id: String(index),
        label: item.label || item.value,
        ...(item.description === undefined ? {} : { detail: item.description }),
      })),
    }
    return renderAutocompleteList(node, width, maxVisible, {
      description: theme.description,
      noMatch: theme.noMatch,
      scrollInfo: theme.scrollInfo,
      selectedText: theme.selectedText,
      ...(layout.minPrimaryColumnWidth === undefined ? {} : { minPrimaryColumnWidth: layout.minPrimaryColumnWidth }),
      ...(layout.maxPrimaryColumnWidth === undefined ? {} : { maxPrimaryColumnWidth: layout.maxPrimaryColumnWidth }),
      ...(layout.truncatePrimary === undefined ? {} : {
        truncatePrimary: (context): string => {
          const item = filteredItems[Number(context.id)]
          /* v8 ignore next -- the canonical items come from this same indexed array */
          if (item === undefined) return context.text
          return layout.truncatePrimary!({ ...context, item })
        },
      }),
    })
  }

  /** Read pi-tui's private row state through the single sanctioned cast. */
  private internals(): SelectListInternals {
    return this as unknown as SelectListInternals
  }
}
