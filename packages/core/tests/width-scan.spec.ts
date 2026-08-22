/**
 * The width-scan contract for core's own rendering surfaces (D45): the
 * gutter wrapper, the shared `framePanel` framer, `WrappingSelectList`
 * (the slash-command dropdown), and the `clampRowsToWidth` backstop
 * itself — each must honor the `BlueComponent` contract at every scan
 * width against every adversarial fixture.
 */

import { describe, expect, it } from 'vitest'
import type { SelectItem, SelectListTheme } from '@earendil-works/pi-tui'
import { clampRowsToWidth, framePanel } from '../src/chrome.ts'
import { GutterComponent } from '../src/gutter.ts'
import { WrappingSelectList } from '../src/wrapping-select-list.ts'
import { truncateToWidth, wrapTextWithAnsi } from '../src/width.ts'
import { ADVERSARIAL, SCAN_WIDTHS, expectLinesFit } from './width-scan.ts'

/** Identity paints: the scan measures true columns, not bracket markers. */
const selectTheme: SelectListTheme = {
  selectedPrefix: text => text,
  selectedText: text => text,
  description: text => text,
  scrollInfo: text => text,
  noMatch: text => text,
}

describe('core width-scan', () => {
  for (const { name, text } of ADVERSARIAL) {
    it(`GutterComponent over an honest child survives ${name}`, () => {
      const child = {
        // An honest child honors the width it is given, floor included.
        render: (width: number): string[] => wrapTextWithAnsi(text, Math.max(1, width)),
        invalidate: (): void => {},
      }
      const gutter = new GutterComponent(child)
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`Gutter/${name}`, gutter.render(width), width)
      }
    })

    it(`framePanel survives ${name}`, () => {
      // framePanel's body rows arrive pre-budgeted by their callers (the
      // HelpOverlay/InfoPanel pattern); the scan feeds them the same way.
      const budget = (row: string, width: number): string => truncateToWidth(row, Math.max(1, width))
      for (const width of SCAN_WIDTHS) {
        const body = [budget(`  ${text}`, width), budget(text, width)]
        expectLinesFit(`framePanel/${name}`, framePanel(body, width, {
          title: text.slice(0, 20),
          titleHint: '· hint',
        }), width)
      }
    })

    it(`WrappingSelectList survives ${name}`, () => {
      const items: SelectItem[] = [
        { value: text, label: `/${text.slice(0, 30)}`, description: text },
        { value: 'short', label: '/short', description: 'fits' },
      ]
      const list = new WrappingSelectList(items, 5, selectTheme, {
        minPrimaryColumnWidth: 12,
        maxPrimaryColumnWidth: 32,
      })
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`WrappingSelectList/${name}`, list.render(width), width)
      }
    })
  }

  it('clampRowsToWidth passes fits through untouched and cuts the rest', () => {
    const truncate = (t: string, w: number): string => (t.length <= w ? t : `${t.slice(0, Math.max(0, w - 3))}...`)
    const rows = ['fits', 'an over-wide row that must be cut']
    expect(clampRowsToWidth(['fits'], 10, truncate)).toEqual(['fits'])
    expect(clampRowsToWidth(rows, 12, truncate)).toEqual(['fits', 'an over-w...'])
  })
})
