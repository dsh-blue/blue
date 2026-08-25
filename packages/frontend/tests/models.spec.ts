import { describe, expect, it } from 'vitest'
import { freezeModel, type View } from '../src/models.ts'

describe('renderer-neutral model fixture', () => {
  it('leaves primitive and null values unchanged', () => {
    expect(freezeModel(null)).toBeNull()
    expect(freezeModel('plain')).toBe('plain')
  })

  it('snapshots every view shape without renderer objects', () => {
    const views: View[] = [
      { kind: 'text', text: 'hello' },
      { kind: 'rich-text', spans: [{ text: 'strong', strong: true }] },
      { kind: 'fields', fields: [{ label: 'mode', value: 'normal' }] },
      { kind: 'sections', sections: [{ title: 'details', body: { kind: 'text', text: 'body' } }] },
      { kind: 'list', items: [{ id: 'one', label: 'One' }], selectedId: 'one' },
      { kind: 'code', code: 'const x = 1', language: 'ts' },
      { kind: 'diff', before: 'a', after: 'b', language: 'txt' },
    ]
    const snapshot = freezeModel({ views })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.views)).toBe(true)
    expect(Object.isFrozen(snapshot.views[0])).toBe(true)
    expect(snapshot).toMatchSnapshot()
  })
})
