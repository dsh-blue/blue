/**
 * Public BlueView adapter tests: sanitization, every view variant, limits,
 * semantic paints, and contained dynamic failures.
 *
 * @module @dsh-blue/blue-core/tests/plugin-view
 */

import { describe, expect, it } from 'vitest'
import type { BlueView } from '../../api/src/contracts.ts'
import {
  BluePluginViewComponent,
  PLUGIN_VIEW_MAX_CHARS,
  PLUGIN_VIEW_MAX_DEPTH,
  paintPluginTone,
  renderPluginView,
  sanitizePluginText,
  summarizePluginView,
} from '../src/plugin-view.ts'
import type { BlueComponents, BlueSemanticColors } from '../src/types.ts'
import { DARK_COLORS } from '../src/theme-dark.ts'
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

describe('plugin BlueView adapter', () => {
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
    expect(renderPluginView({ kind: 'text', content: 'hello', tone: 'accent' }, 80, components, colors)).toEqual(['<primary>hello</primary>'])
    expect(renderPluginView({
      kind: 'fields',
      rows: [{ label: 'state', value: [
        { text: 'ready', tone: 'success', emphasis: 'strong' },
        { text: ' now' },
      ] }],
    }, 80, components, colors)[0]).toContain('<muted>state: </muted>')
    expect(renderPluginView({ kind: 'code', language: 'ts', code: 'const x = 1\nnext' }, 80, components, colors)).toEqual([
      '<muted>ts</muted>',
      '<mdCodeBlock>const x = 1</mdCodeBlock>',
      '<mdCodeBlock>next</mdCodeBlock>',
    ])
    expect(renderPluginView({ kind: 'code', code: 'plain' }, 80, components, colors)).toEqual(['<mdCodeBlock>plain</mdCodeBlock>'])
    expect(renderPluginView({ kind: 'diff', before: 'old', after: 'new' }, 80, components, colors)).toEqual([
      '<diffRemoved>- old</diffRemoved>',
      '<diffAdded>+ new</diffAdded>',
    ])
    expect(renderPluginView({
      kind: 'sections',
      sections: [
        { title: 'open', body: { kind: 'text', content: 'body' } },
        { title: 'closed', body: { kind: 'text', content: 'hidden' }, collapsed: true },
        { body: { kind: 'text', content: 'hidden' }, collapsed: true },
      ],
    }, 80, components, colors)).toEqual([
      '\x1b[1m<primary>open</primary>\x1b[22m',
      '<text>body</text>',
      '\x1b[1m<primary>closed</primary>\x1b[22m',
      '<muted>...</muted>',
    ])
  })

  it('rejects malformed and oversized view data without trusting casts', () => {
    expect(() => renderPluginView(null as never, 20, components, colors)).toThrow('view must be an object')
    expect(() => renderPluginView({ kind: 'unknown' } as never, 20, components, colors)).toThrow('unknown BlueView kind')
    expect(() => renderPluginView({ kind: 'text', content: 1 } as never, 20, components, colors)).toThrow('must be a string')
    expect(() => renderPluginView({ kind: 'text', content: 'x'.repeat(PLUGIN_VIEW_MAX_CHARS + 1) }, 20, components, colors)).toThrow('exceeds')
    expect(() => renderPluginView({ kind: 'fields', rows: null } as never, 20, components, colors)).toThrow('fields rows')
    expect(() => renderPluginView({ kind: 'fields', rows: [null] } as never, 20, components, colors)).toThrow('field row')
    expect(() => renderPluginView({ kind: 'fields', rows: [{ label: 'x', value: [null] }] } as never, 20, components, colors)).toThrow('field span')
    expect(() => renderPluginView({ kind: 'sections', sections: null } as never, 20, components, colors)).toThrow('sections must')
    expect(() => renderPluginView({ kind: 'sections', sections: [null] } as never, 20, components, colors)).toThrow('section is invalid')

    let nested: BlueView = { kind: 'text', content: 'deep' }
    for (let i = 0; i <= PLUGIN_VIEW_MAX_DEPTH; i += 1) nested = { kind: 'sections', sections: [{ body: nested }] }
    expect(() => renderPluginView(nested, 20, components, colors)).toThrow('view nesting exceeds')
  })

  it('caps rows, summarizes every view kind, and rejects invalid summaries', () => {
    const fields: BlueView = { kind: 'fields', rows: [{ label: 'a', value: [{ text: 'b' }] }] }
    const sections: BlueView = { kind: 'sections', sections: [
      { title: 'named', body: { kind: 'text', content: 'ignored' } },
      { body: fields },
    ] }
    expect(renderPluginView({ kind: 'text', content: 'a\nb\nc' }, 20, components, colors, 2)).toHaveLength(2)
    expect(renderPluginView({ kind: 'text', content: 'a' }, 20, components, colors, -1)).toEqual([])
    expect(summarizePluginView({ kind: 'text', content: ' a\n b ' })).toBe('a b')
    expect(summarizePluginView(fields)).toBe('a: b')
    expect(summarizePluginView({ kind: 'code', code: 'a\n b' })).toBe('a b')
    expect(summarizePluginView({ kind: 'diff', before: '', after: '' })).toBe('diff contribution')
    expect(summarizePluginView(sections)).toBe('named · a: b')
    expect(() => summarizePluginView(null as never)).toThrow('view must be an object')
    expect(() => summarizePluginView({ kind: 'unknown' } as never)).toThrow('unknown BlueView kind')
  })

  it('contains source failures and supports null dynamic views', () => {
    const empty = new BluePluginViewComponent(() => null, components, colors)
    expect(empty.render(20)).toEqual([])
    empty.invalidate()
    const broken = new BluePluginViewComponent(() => { throw new Error('boom') }, components, colors)
    expect(broken.render(80)[0]).toContain('plugin view rejected: boom')
    const nonError = new BluePluginViewComponent(() => { throw 'bad' }, components, colors)
    expect(nonError.render(80)[0]).toContain('unknown render failure')
    const staticView = new BluePluginViewComponent({ kind: 'text', content: 'ok' }, components, colors, 1)
    expect(staticView.render(80)).toEqual(['<text>ok</text>'])
  })

  for (const fixture of ADVERSARIAL) {
    it(`keeps dynamic ${fixture.name} rows inside every scanned width`, () => {
      const component = new BluePluginViewComponent({ kind: 'text', content: fixture.text, tone: 'accent' }, components, DARK_COLORS)
      for (const width of SCAN_WIDTHS) expectLinesFit(`BluePluginView/${fixture.name}`, component.render(width), width)
    })
  }
})
