import { describe, expect, it } from 'vitest'
import type { BlueUiNode } from '@dsh-blue/blue-api'
import { freezeModel } from '../src/models.ts'

describe('renderer-neutral model fixture', () => {
  it('leaves primitive and null values unchanged', () => {
    expect(freezeModel(null)).toBeNull()
    expect(freezeModel('plain')).toBe('plain')
  })

  it('snapshots canonical nodes without renderer objects', () => {
    const nodes: BlueUiNode[] = [
      { kind: 'text', content: 'hello' },
      { kind: 'rich-text', spans: [{ text: 'strong', emphasis: 'strong' }] },
      { kind: 'fields', rows: [{ label: 'mode', value: [{ text: 'normal' }] }] },
      { kind: 'sections', sections: [{ title: 'details', body: { kind: 'text', content: 'body' } }] },
      { kind: 'list', id: 'fixture', items: [{ id: 'one', label: 'One' }], selectedIds: ['one'] },
      { kind: 'code', code: 'const x = 1', language: 'ts' },
      { kind: 'diff', before: 'a', after: 'b' },
    ]
    const snapshot = freezeModel({ nodes })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.nodes)).toBe(true)
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true)
    expect(snapshot).toMatchSnapshot()
  })
})
