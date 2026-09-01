/** Direct status registry footer layout and containment coverage. */
import { Context } from '@deepseek-ai/cordis'
import { BlueStatusService, type BlueStatusEntry } from '@dsh-blue/blue-api'
import { describe, expect, it } from 'vitest'
import { StatusFooterComponent } from '../src/status-model.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS } from './status-fakes.ts'

function entry(id: string, content: string, options: Partial<BlueStatusEntry> = {}): BlueStatusEntry {
  return { id, node: { kind: 'text', content }, visible: true, ...options }
}

function registry(...entries: BlueStatusEntry[]): BlueStatusService {
  const service = new BlueStatusService(new Context())
  for (const value of entries) service.register(value)
  return service
}

describe('StatusFooterComponent', () => {
  it('lays out two bands, priorities, right alignment, cache, and overflow', () => {
    const components = fakeBlueComponents()
    const service = registry(
      entry('left', 'left', { priority: 0, node: { kind: 'text', content: 'left', tone: 'accent' } }),
      entry('hidden', 'hidden', { visible: false }),
      entry('right', 'right', { band: 'right', node: { kind: 'text', content: 'right', tone: 'success' } }),
      entry('second', 'second', { row: 2, node: { kind: 'text', content: 'second', tone: 'warning' } }),
      entry('wide', '0123456789', { row: 2, priority: 2, overflow: 'hide' }),
    )
    const footer = new StatusFooterComponent(service, components, COLORS)
    expect(footer.render(14)).toEqual(['left     right', 'second        '])
    expect(footer.render(14)).toBe(footer.render(14))
    footer.invalidate()
    expect(footer.render(4)).toEqual(['left', 's\x1b[0m...\x1b[0m'])
  })

  it('compiles status stacks, right-only rows, and invalid trees safely', () => {
    const service = registry({
      id: 'stack',
      visible: true,
      band: 'right',
      node: { kind: 'stack', direction: 'row', gap: 1, children: [
        { node: { kind: 'text', content: 'one' } },
        { node: { kind: 'text', content: 'two', tone: 'muted' } },
      ] },
    })
    const components = fakeBlueComponents()
    const footer = new StatusFooterComponent(service, components, COLORS)
    const row = footer.render(12)[0]!
    expect(row).toContain('one')
    expect(row).toContain('two')
    expect(components.visibleWidth(row)).toBe(12)

    const invalid = registry(entry('bad', '', { node: { kind: 'actions' } as never }))
    const error = new StatusFooterComponent(invalid, fakeBlueComponents(), COLORS)
    expect(error.render(12)[0]).toContain('Blue UI')
    expect(error.render(0)).toEqual([])
  })

  it('drops empty and overflowing compiled rows', () => {
    const service = registry(
      entry('empty', ''),
      {
        id: 'empty-stack',
        visible: true,
        node: { kind: 'stack', direction: 'column', children: [] },
      },
      {
        id: 'overflow',
        visible: true,
        overflow: 'hide',
        node: { kind: 'stack', direction: 'column', children: [
          { node: { kind: 'text', content: 'first' } },
          { node: { kind: 'text', content: 'second' } },
        ] },
      },
    )
    const footer = new StatusFooterComponent(service, fakeBlueComponents(), COLORS)
    expect(footer.render(20)).toEqual([])
  })

  it('separates multiple entries in one footer cluster', () => {
    const service = registry(entry('first', 'first'), entry('second', 'second'))
    const footer = new StatusFooterComponent(service, fakeBlueComponents(), COLORS)
    expect(footer.render(20)).toEqual(['first  second       '])
  })
})
