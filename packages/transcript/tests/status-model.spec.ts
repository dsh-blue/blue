/** Canonical status registry, compiler, layout, and containment coverage. */
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent } from '@dsh-blue/blue-core'
import { describe, expect, it, vi } from 'vitest'
import { BlueStatusEntryService, StatusFooterComponent, type BlueStatusEntry } from '../src/status-model.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS, StatusFakeScreen } from './status-fakes.ts'

function entry(id: string, content: string, options: Partial<BlueStatusEntry> = {}): BlueStatusEntry {
  return { id, node: { kind: 'text', content }, visible: true, ...options }
}

describe('BlueStatusEntryService', () => {
  it('registers live nodes, orders them, refreshes, and disposes idempotently', () => {
    const screen = new StatusFakeScreen()
    const service = new BlueStatusEntryService(new Context(), screen)
    const invalidate = vi.fn()
    service.attachFooter({ render: () => [], invalidate } satisfies BlueComponent)
    let current: BlueStatusEntry | null = entry('dynamic', 'first', { priority: 2 })
    const dispose = service.register(() => current)
    service.register(entry('same-z', 'z', { priority: 1 }))
    service.register(entry('same-a', 'a', { priority: 1 }))
    expect(service.list().map(model => model.id)).toEqual(['same-a', 'same-z', 'dynamic'])
    expect(() => service.register(entry('dynamic', 'duplicate'))).toThrow(/already registered/)
    current = entry('dynamic', 'second')
    service.refresh('dynamic')
    service.refresh('missing')
    expect(invalidate).toHaveBeenCalledTimes(4)
    current = null
    expect(service.list().map(model => model.id)).toEqual(['same-a', 'same-z'])
    dispose()
    dispose()
    const absent = service.register(() => null)
    absent()
    service.dispose()
    expect(service.list()).toEqual([])
  })

  it('attaches late and contains a throwing source in place', () => {
    const service = new BlueStatusEntryService(new Context())
    let broken = false
    service.register(() => {
      if (broken) throw new Error('failed')
      return entry('source', 'ok', { priority: 4, band: 'right', row: 2, overflow: 'hide' })
    })
    broken = true
    expect(service.list()[0]).toMatchObject({
      id: 'source',
      priority: 4,
      band: 'right',
      row: 2,
      overflow: 'hide',
      visible: true,
    })
    expect(service.list()[0]!.node).toMatchObject({ kind: 'text', tone: 'danger' })
    const screen = new StatusFakeScreen()
    service.attach(screen)
    expect(screen.renderRequests).toHaveLength(1)
  })

})

describe('StatusFooterComponent', () => {
  it('lays out two bands, priorities, right alignment, tones, cache, and overflow', () => {
    const components = fakeBlueComponents()
    const service = new BlueStatusEntryService(new Context())
    service.register(entry('left', 'left', { priority: 0, node: { kind: 'text', content: 'left', tone: 'accent' } }))
    service.register(entry('hidden', 'hidden', { visible: false }))
    service.register(entry('right', 'right', { band: 'right', node: { kind: 'text', content: 'right', tone: 'success' } }))
    service.register(entry('second', 'second', { row: 2, node: { kind: 'text', content: 'second', tone: 'warning' } }))
    service.register(entry('wide', '0123456789', { row: 2, priority: 2, overflow: 'hide' }))
    const footer = new StatusFooterComponent(service, components, COLORS)
    expect(footer.render(14)).toEqual(['left     right', 'second        '])
    expect(footer.render(14)).toBe(footer.render(14))
    footer.invalidate()
    expect(footer.render(4)).toEqual(['left', 's\x1b[0m...\x1b[0m'])
  })

  it('compiles status stacks, right-only rows, and invalid trees safely', () => {
    const service = new BlueStatusEntryService(new Context())
    service.register({
      id: 'stack',
      visible: true,
      band: 'right',
      node: { kind: 'stack', direction: 'row', gap: 1, children: [
        { node: { kind: 'text', content: 'one' } },
        { node: { kind: 'text', content: 'two', tone: 'muted' } },
      ] },
    })
    const footer = new StatusFooterComponent(service, fakeBlueComponents(), COLORS)
    const row = footer.render(12)[0]!
    expect(row).toContain('one')
    expect(row).toContain('two')
    expect(fakeBlueComponents().visibleWidth(row)).toBe(12)

    const invalid = new BlueStatusEntryService(new Context())
    invalid.register(entry('bad', '', { node: { kind: 'actions' } as never }))
    const error = new StatusFooterComponent(invalid, fakeBlueComponents(), COLORS)
    expect(error.render(12)[0]).toContain('Blue UI')
    expect(error.render(0)).toEqual([])
  })

  it('drops empty compiled rows and hides multi-row overflow', () => {
    const service = new BlueStatusEntryService(new Context())
    service.register(entry('empty', ''))
    service.register({
      id: 'empty-stack',
      visible: true,
      node: { kind: 'stack', direction: 'column', children: [] },
    })
    service.register({
      id: 'overflow',
      visible: true,
      overflow: 'hide',
      node: { kind: 'stack', direction: 'column', children: [
        { node: { kind: 'text', content: 'first' } },
        { node: { kind: 'text', content: 'second' } },
      ] },
    })
    const footer = new StatusFooterComponent(service, fakeBlueComponents(), COLORS)
    expect(footer.render(20)).toEqual([])
  })
})
