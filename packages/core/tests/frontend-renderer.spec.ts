import { describe, expect, it } from 'vitest'
import { FrontendModelComponent, renderFrontendModel, renderFrontendView } from '../src/frontend-renderer.ts'
import { visibleWidth } from '../src/width.ts'

describe('frontend renderer adapter', () => {
  it('renders every renderer-neutral view shape and clamps adversarial content', () => {
    const views = [
      { kind: 'text' as const, text: '重构 runtime' },
      { kind: 'rich-text' as const, spans: [{ text: 'alpha' }, { text: ' beta', strong: true }] },
      { kind: 'fields' as const, fields: [{ label: 'cwd', value: '/very/long/path' }] },
      { kind: 'sections' as const, sections: [
        { title: 'open', body: { kind: 'text' as const, text: 'body' } },
        { title: 'closed', collapsed: true, body: { kind: 'text' as const, text: 'hidden' } },
      ] },
      { kind: 'list' as const, selectedId: 'b', items: [{ id: 'a', label: 'first' }, { id: 'b', label: 'second', detail: 'detail' }] },
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
    const rows = renderFrontendModel({ providerId: 'fixture', capabilities: [], views: [{ kind: 'text', text: 'a' }, { kind: 'list', items: [{ id: 'a', label: 'b' }] }] }, 20)
    expect(rows).toEqual(['a', '  b'])
    const component = new FrontendModelComponent({ providerId: 'component', capabilities: [], views: [{ kind: 'text', text: 'old' }] })
    expect(component.render(20)).toEqual(['old'])
    component.setModel({ providerId: 'component', capabilities: [], views: [{ kind: 'text', text: 'new' }] })
    expect(component.render(20)).toEqual(['new'])
    component.invalidate()
  })
})
