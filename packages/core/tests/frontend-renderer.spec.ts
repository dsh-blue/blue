import { describe, expect, it } from 'vitest'
import { FrontendModelComponent, renderFrontendModel, renderFrontendView, type FrontendRenderOptions } from '../src/frontend-renderer.ts'
import { visibleWidth } from '../src/width.ts'

/** Tagged diff palette: assertions see structure, not escape codes. */
const COLORS = {
  diffAdded: (text: string): string => `<A>${text}</A>`,
  diffRemoved: (text: string): string => `<R>${text}</R>`,
  diffMeta: (text: string): string => `<M>${text}</M>`,
} as const
const OPTS: FrontendRenderOptions = { colors: COLORS as unknown as FrontendRenderOptions['colors'] }

describe('frontend renderer adapter', () => {
  it('renders every renderer-neutral view shape and clamps adversarial content', () => {
    const views = [
      { kind: 'text' as const, text: '重构 runtime', tone: 'accent' as const },
      { kind: 'rich-text' as const, spans: [{ text: 'alpha', tone: 'muted' as const }, { text: ' beta', strong: true }] },
      { kind: 'fields' as const, fields: [{ label: 'cwd', value: '/very/long/path' }] },
      { kind: 'sections' as const, sections: [
        { title: 'open', body: { kind: 'text' as const, text: 'body' } },
        { title: 'closed', collapsed: true, body: { kind: 'text' as const, text: 'hidden' } },
      ] },
      { kind: 'list' as const, selectedId: 'b', items: [{ id: 'a', label: 'first', group: 'group', disabled: true }, { id: 'b', label: 'second', detail: 'detail' }] },
      { kind: 'code' as const, code: 'one\ntwo', language: 'ts' },
      { kind: 'diff' as const, before: 'old', after: 'new', language: 'ts' },
    ]
    for (const view of views) {
      const rows = renderFrontendView(view, 8)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every(row => visibleWidth(row) <= 8)).toBe(true)
    }
  })

  it('normalizes degenerate widths and renders provider models', () => {
    expect(renderFrontendView({ kind: 'text', text: 'hello' }, 0)).toEqual(['h', 'e', 'l', 'l', 'o'])
    expect(renderFrontendView({ kind: 'text', text: 'hello' }, 2.8)).toEqual(['he', 'll', 'o'])
    expect(renderFrontendView({ kind: 'text', text: 'safe\x1b[31mred' }, Number.NaN)).toEqual(['s', 'a', 'f', 'e', 'r', 'e', 'd'])
    const rows = renderFrontendModel({ providerId: 'fixture', capabilities: [], views: [{ kind: 'text', text: 'a' }, { kind: 'list', items: [{ id: 'a', label: 'b' }] }] }, 20)
    // The compatibility model now adopts the canonical list pattern.
    expect(rows).toEqual(['a', '   b'])
    const component = new FrontendModelComponent({ providerId: 'component', capabilities: [], views: [{ kind: 'text', text: 'old' }] })
    expect(component.render(20)).toEqual(['old'])
    component.setModel({ providerId: 'component', capabilities: [], views: [{ kind: 'text', text: 'new' }] })
    expect(component.render(20)).toEqual(['new'])
    component.invalidate()
  })

  it('renders aligned diff rows, colored only when colors are supplied', () => {
    const view = { kind: 'diff' as const, before: 'a\nb', after: 'a\nc' }
    expect(renderFrontendView(view, 20)).toEqual(['  a', '- b', '+ c'])
    expect(renderFrontendView(view, 20, OPTS)).toEqual(['  a', '<R>- b</R>', '<A>+ c</A>'])
    // The same canonical conversion renders identically across frames and
    // wraps over-wide diff rows like any other content.
    const wide = { kind: 'diff' as const, before: `${'x'.repeat(30)}\nq`, after: `${'y'.repeat(30)}\nq` }
    const once = renderFrontendView(wide, 12, OPTS)
    const twice = renderFrontendView(wide, 12, OPTS)
    expect(once).toEqual(twice)
    expect(once.every(row => visibleWidth(row) <= 12)).toBe(true)
  })

  it('elides long unchanged runs inside a rendered diff', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`)
    const before = [...lines.slice(0, 10), 'old', ...lines.slice(10)].join('\n')
    const after = [...lines.slice(0, 10), 'new', ...lines.slice(10)].join('\n')
    const rows = renderFrontendView({ kind: 'diff', before, after }, 40, OPTS)
    expect(rows).toContain('<R>- old</R>')
    expect(rows).toContain('<A>+ new</A>')
    expect(rows.some(row => row.includes('unchanged lines'))).toBe(true)
    expect(rows.length).toBeLessThan(lines.length)
  })

  it('contains canonical admission failures in a width-safe error component', () => {
    const rows = renderFrontendView({
      kind: 'list',
      items: [{ id: 'duplicate', label: 'one' }, { id: 'duplicate', label: 'two' }],
    }, 12)
    expect(rows.join('')).toContain('Blue UI reje')
    expect(rows.every(row => visibleWidth(row) <= 12)).toBe(true)
  })
})
