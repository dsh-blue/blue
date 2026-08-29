/**
 * Canonical BlueView leaf tests: sanitization, every view variant, limits,
 * semantic paints, and width containment.
 *
 * @module @dsh-blue/blue-core/tests/plugin-view
 */

import { describe, expect, it } from 'vitest'
import type { BlueView } from '../../api/src/contracts.ts'
import {
  PLUGIN_VIEW_MAX_CHARS,
  PLUGIN_VIEW_MAX_DEPTH,
  paintPluginTone,
  renderCanonicalView,
  sanitizePluginText,
  summarizePluginView,
} from '../src/plugin-view.ts'
import type { BlueComponents, BlueSemanticColors } from '../src/types.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'
import { ADVERSARIAL, SCAN_WIDTHS, expectLinesFit } from './width-scan.ts'

const colors = new Proxy({}, {
  get: (_target, role: string) => (text: string) => `<${role}>${text}</${role}>`,
}) as BlueSemanticColors

const components = {
  visibleWidth,
  wrapText: wrapTextWithAnsi,
  truncateToWidth,
} as BlueComponents

function renderView(view: BlueView, width: number, maxRows = 20): string[] {
  return renderCanonicalView(view, width, components, colors, maxRows)
}

describe('canonical BlueView leaf renderer', () => {
  it('strips ANSI, OSC, and unsafe controls while retaining layout whitespace', () => {
    expect(sanitizePluginText('\x1b[31mred\x1b[0m\x1b]0;bad\x07\x00\nnext\t')).toBe('red\nnext\t')
  })

  it('maps every public tone to the owner palette', () => {
    expect(paintPluginTone(colors, undefined)('x')).toBe('<text>x</text>')
    expect(paintPluginTone(colors, 'default')('x')).toBe('<text>x</text>')
    expect(paintPluginTone(colors, 'muted')('x')).toBe('<muted>x</muted>')
    expect(paintPluginTone(colors, 'accent')('x')).toBe('<primary>x</primary>')
    expect(paintPluginTone(colors, 'success')('x')).toBe('<success>x</success>')
    expect(paintPluginTone(colors, 'warning')('x')).toBe('<warning>x</warning>')
    expect(paintPluginTone(colors, 'danger')('x')).toBe('<error>x</error>')
  })

  it('renders text, fields, code, diff, and nested sections through width helpers', () => {
    expect(renderView({ kind: 'text', content: 'hello', tone: 'accent' }, 80)).toEqual(['<primary>hello</primary>'])
    expect(renderView({
      kind: 'fields',
      rows: [{ label: 'state', value: [
        { text: 'ready', tone: 'success', emphasis: 'strong' },
        { text: ' now' },
      ] }],
    }, 80)[0]).toContain('<muted>state: </muted>')
    expect(renderView({ kind: 'code', language: 'ts', code: 'const x = 1\nnext' }, 80)).toEqual([
      '<muted>ts</muted>',
      '<mdCodeBlock>const x = 1</mdCodeBlock>',
      '<mdCodeBlock>next</mdCodeBlock>',
    ])
    expect(renderView({ kind: 'code', code: 'plain' }, 80)).toEqual(['<mdCodeBlock>plain</mdCodeBlock>'])
    expect(renderView({ kind: 'diff', before: 'old', after: 'new' }, 80)).toEqual([
      '<diffRemoved>- old</diffRemoved>',
      '<diffAdded>+ new</diffAdded>',
    ])
    // The shared alignment renders context once between removal and addition.
    expect(renderView({ kind: 'diff', before: 'a\nb', after: 'a\nc' }, 80)).toEqual([
      '  a',
      '<diffRemoved>- b</diffRemoved>',
      '<diffAdded>+ c</diffAdded>',
    ])
    expect(renderView({
      kind: 'sections',
      sections: [
        { title: 'open', body: { kind: 'text', content: 'body' } },
        { title: 'closed', body: { kind: 'text', content: 'hidden' }, collapsed: true },
        { body: { kind: 'text', content: 'hidden' }, collapsed: true },
      ],
    }, 80)).toEqual([
      '\x1b[1m<primary>open</primary>\x1b[22m',
      '<text>body</text>',
      '\x1b[1m<primary>closed</primary>\x1b[22m',
      '<muted>...</muted>',
    ])
  })

  it('rejects malformed and oversized view data without trusting casts', () => {
    expect(() => renderView(null as never, 20)).toThrow('view must be an object')
    expect(() => renderView({ kind: 'unknown' } as never, 20)).toThrow('unknown BlueView kind')
    expect(() => renderView({ kind: 'text', content: 1 } as never, 20)).toThrow('must be a string')
    expect(() => renderView({ kind: 'text', content: 'x'.repeat(PLUGIN_VIEW_MAX_CHARS + 1) }, 20)).toThrow('exceeds')
    expect(() => renderView({ kind: 'fields', rows: null } as never, 20)).toThrow('fields rows')
    expect(() => renderView({ kind: 'fields', rows: [null] } as never, 20)).toThrow('field row')
    expect(() => renderView({ kind: 'fields', rows: [{ label: 'x', value: [null] }] } as never, 20)).toThrow('field span')
    expect(() => renderView({ kind: 'sections', sections: null } as never, 20)).toThrow('sections must')
    expect(() => renderView({ kind: 'sections', sections: [null] } as never, 20)).toThrow('section is invalid')

    let nested: BlueView = { kind: 'text', content: 'deep' }
    for (let i = 0; i <= PLUGIN_VIEW_MAX_DEPTH; i += 1) nested = { kind: 'sections', sections: [{ body: nested }] }
    expect(() => renderView(nested, 20)).toThrow('view nesting exceeds')
  })

  it('caps rows, summarizes every view kind, and rejects invalid summaries', () => {
    const fields: BlueView = { kind: 'fields', rows: [{ label: 'a', value: [{ text: 'b' }] }] }
    const sections: BlueView = { kind: 'sections', sections: [
      { title: 'named', body: { kind: 'text', content: 'ignored' } },
      { body: fields },
    ] }
    expect(renderView({ kind: 'text', content: 'a\nb\nc' }, 20, 2)).toHaveLength(2)
    expect(renderView({ kind: 'text', content: 'a' }, 20, -1)).toEqual([])
    expect(summarizePluginView({ kind: 'text', content: ' a\n b ' })).toBe('a b')
    expect(summarizePluginView(fields)).toBe('a: b')
    expect(summarizePluginView({ kind: 'code', code: 'a\n b' })).toBe('a b')
    expect(summarizePluginView({ kind: 'diff', before: '', after: '' })).toBe('diff contribution')
    expect(summarizePluginView(sections)).toBe('named · a: b')
    expect(() => summarizePluginView(null as never)).toThrow('view must be an object')
    expect(() => summarizePluginView({ kind: 'unknown' } as never)).toThrow('unknown BlueView kind')
  })

  for (const fixture of ADVERSARIAL) {
    it(`keeps canonical ${fixture.name} rows inside every scanned width`, () => {
      for (const width of SCAN_WIDTHS) {
        const rows = renderView({ kind: 'text', content: fixture.text, tone: 'accent' }, width)
        expectLinesFit(`BlueView/${fixture.name}`, rows, width)
      }
    })
  }
})
