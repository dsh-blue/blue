/**
 * The width-scan contract for core's own rendering surfaces (D48): the
 * gutter wrapper, the shared `framePanel` framer, `WrappingSelectList`
 * (the slash-command dropdown), and the `clampRowsToWidth` backstop
 * itself — each must honor the `BlueComponent` contract at every scan
 * width against every adversarial fixture.
 */

import { describe, expect, it } from 'vitest'
import type { SelectItem, SelectListTheme } from '@earendil-works/pi-tui'
import { clampRowsToWidth, framePanel } from '../src/chrome.ts'
import { renderFrontendView } from '../src/frontend-renderer.ts'
import { GutterComponent } from '../src/gutter.ts'
import { compileBlueStatusNode } from '../src/ui-compiler.ts'
import { WrappingSelectList } from '../src/wrapping-select-list.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'
import { ADVERSARIAL, SCAN_WIDTHS, expectLinesFit } from './width-scan.ts'

/** Identity paints: the scan measures true columns, not bracket markers. */
const selectTheme: SelectListTheme = {
  selectedPrefix: text => text,
  selectedText: text => text,
  description: text => text,
  scrollInfo: text => text,
  noMatch: text => text,
}

/** W4a migration sweep: every integer width in the supported fixture range. */
const MIGRATION_WIDTHS = Array.from({ length: 119 }, (_, index) => index + 2)
const identity = (text: string): string => text
const statusColors = new Proxy({ logoGradient: [identity] }, { get: (target, key) => key === 'logoGradient' ? target.logoGradient : identity })

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
      for (const width of MIGRATION_WIDTHS) {
        expectLinesFit(`WrappingSelectList/${name}`, list.render(width), width)
      }
    })

    it(`canonical frontend view mapping survives ${name}`, () => {
      const shared = Array.from({ length: 14 }, (_, index) => `ctx ${String(index)}`).join('\n')
      const views = [
        { kind: 'text' as const, text },
        { kind: 'rich-text' as const, spans: [{ text, strong: true }] },
        { kind: 'fields' as const, fields: [{ label: text, value: text }] },
        { kind: 'sections' as const, sections: [{ title: text, body: { kind: 'text' as const, text } }] },
        { kind: 'list' as const, selectedId: 'selected', items: [
          { id: 'selected', label: text, detail: text },
          { id: 'disabled', label: text, disabled: true },
        ] },
        { kind: 'code' as const, code: `${text}\n${text}`, language: 'fixture' },
        { kind: 'diff' as const, before: `${shared}\n${text}`, after: `${shared}\n+ ${text}\nextra` },
        { kind: 'diff' as const, before: '', after: `${text}\n${text}` },
      ]
      for (const view of views) {
        for (const width of MIGRATION_WIDTHS) {
          expectLinesFit(`frontend/${view.kind}/${name}`, renderFrontendView(view, width), width)
        }
      }
    })

    it(`canonical status compiler survives ${name}`, () => {
      const result = compileBlueStatusNode({
        kind: 'stack',
        direction: 'row',
        gap: 1,
        children: [
          { node: { kind: 'rich-text', spans: [{ text, tone: 'accent', emphasis: 'strong' }] }, grow: 1, shrink: 1 },
          { node: { kind: 'progress', label: text, value: 1, max: 3 }, basis: 12, shrink: 1 },
        ],
      }, {
        components: { visibleWidth, wrapText: wrapTextWithAnsi, truncateToWidth } as never,
        colors: statusColors as never,
        getViewport: () => ({ columns: 80, rows: 3 }),
        screenMode: 'main',
        maxRows: 3,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      for (const width of SCAN_WIDTHS) {
        const rendered = result.value.component.renderStatus(width)
        expect(rendered.rows.length).toBeLessThanOrEqual(3)
        expectLinesFit(`status/${name}`, rendered.rows, width)
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
