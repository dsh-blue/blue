/** Canonical dock registry, compiler, adapter, and lifecycle coverage. */
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueDockOptions, BlueScreen } from '@dsh-blue/blue-core'
import { describe, expect, it } from 'vitest'
import { BlueBottomPaneService, type BlueBottomPaneNode } from '../src/dock-model.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS } from './status-fakes.ts'

function screenFixture() {
  const children: BlueComponent[] = []
  const bottom: BlueComponent[] = []
  const dockOptions: BlueDockOptions[] = []
  const renders: (boolean | undefined)[] = []
  const mountBottom = (component: BlueComponent, options: BlueDockOptions = {}) => {
    bottom.push(component)
    dockOptions.push(options)
    return () => {
      const index = bottom.indexOf(component)
      if (index !== -1) {
        bottom.splice(index, 1)
        dockOptions.splice(index, 1)
      }
    }
  }
  const screen = {
    columns: 80,
    rows: 24,
    addChild: (component: BlueComponent) => {
      children.push(component)
      return () => {
        const index = children.indexOf(component)
        if (index !== -1) children.splice(index, 1)
      }
    },
    addBottomChild: (component: BlueComponent) => mountBottom(component),
    addDockChild: mountBottom,
    requestRender: (force?: boolean) => { renders.push(force) },
  } as unknown as BlueScreen
  return { screen, children, bottom, dockOptions, renders }
}

function compiler(screen: BlueScreen) {
  return {
    components: fakeBlueComponents(),
    colors: COLORS,
    viewport: () => ({ columns: screen.columns, rows: screen.rows }),
  }
}

function dock(id: string, options: Partial<BlueBottomPaneNode> = {}): BlueBottomPaneNode {
  return { id, node: { kind: 'text', content: id }, ...options }
}

describe('BlueBottomPaneService', () => {
  it('compiles dynamic canonical nodes and disposes idempotently', () => {
    const fixture = screenFixture()
    const service = new BlueBottomPaneService(new Context(), compiler(fixture.screen))
    service.attach(fixture.screen)
    let value = dock('bottom')
    const dispose = service.register(() => value)
    const retained = fixture.bottom[0]!
    const rich = service.register(dock('rich', { node: { kind: 'rich-text', spans: [{ text: 'left', tone: 'accent' }] } }))
    expect(fixture.bottom[0]!.render(20)).toEqual([' bottom'])
    expect(fixture.bottom[1]!.render(20)).toEqual([' left'])
    value = dock('bottom', { node: { kind: 'fields', rows: [{ label: 'state', value: [{ text: 'ok' }] }] } })
    service.refresh('bottom', true)
    service.refresh('missing')
    expect(fixture.bottom[0]!.render(20)).toEqual([' state: ok'])
    expect(fixture.renders.at(-1)).toBe(true)
    expect(service.list()).toHaveLength(2)
    rich()
    dispose()
    dispose()
    expect(fixture.bottom).toEqual([])
    expect(retained.render(20)).toEqual([])
    service.dispose()
  })

  it('orders bottom nodes, caps rows, handles collapse, and reattaches cleanly', () => {
    const first = screenFixture()
    const second = screenFixture()
    const service = new BlueBottomPaneService(new Context(), compiler(first.screen), first.screen)
    service.register(dock('z'))
    service.register(dock('a'))
    service.register(dock('high', { priority: 9 }))
    service.register(dock('low', { priority: 1 }))
    service.register(dock('tie-z', { priority: 5 }))
    service.register(dock('tie-a', { priority: 5 }))
    expect(first.bottom.map(component => component.render(20)[0])).toEqual([' a', ' z', ' low', ' tie-a', ' tie-z', ' high'])
    expect(first.dockOptions).toEqual([{ priority: 0 }, { priority: 0 }, { priority: 1 }, { priority: 5 }, { priority: 5 }, { priority: 9 }])
    const capped = service.register(dock('capped', {
      node: { kind: 'code', code: 'one\ntwo\nthree' },
      preferredRows: 2,
    }))
    expect(first.bottom.find(component => component.render(20)[0] === ' one')?.render(20)).toEqual([' one', ' two'])
    let collapsed = false
    service.register(() => dock('changing', { collapsed, node: { kind: 'text', content: 'live' } }))
    const changing = first.bottom.find(component => component.render(20)[0] === ' live')!
    collapsed = true
    service.refresh('changing')
    expect(changing.render(20)).toEqual([])
    capped()
    service.attach(second.screen)
    expect(first.bottom).toEqual([])
    expect(second.bottom).toHaveLength(7)
    service.dispose()
    expect(second.bottom).toEqual([])
  })

  it('contains invalid nodes, source and adapter throws, and clamps adapter rows', () => {
    const fixture = screenFixture()
    const service = new BlueBottomPaneService(new Context(), compiler(fixture.screen), fixture.screen)
    service.register(dock('invalid', { node: { kind: 'unknown' } as never }))
    expect(fixture.bottom[0]!.render(12).join('')).toContain('Blue UI')

    let sourceThrows = false
    service.register(() => {
      if (sourceThrows) throw new Error('source failed')
      return dock('stable', { priority: 7 })
    })
    sourceThrows = true
    service.refresh('stable')
    expect(service.list().find(entry => entry.id === 'stable')).toMatchObject({ priority: 7 })
    expect(fixture.bottom.find(component => component.render(20).join('').includes('stable'))?.render(20).join('')).toContain('failed')

    service.register(dock('adapter', { preferredRows: 1 }), (_node, width) => [
      'x'.repeat(width + 5),
      'second row',
    ])
    const clamped = fixture.bottom.find(component => component.render(8)[0]?.startsWith(' x'))!.render(8)
    expect(clamped).toHaveLength(1)
    expect(compiler(fixture.screen).components.visibleWidth(clamped[0]!)).toBeLessThanOrEqual(8)
    service.register(dock('adapter-fail'), () => { throw new Error('adapter failed') })
    expect(fixture.bottom.find(component => component.render(30).join('').includes('adapter-fail'))?.render(30).join('')).toContain('failed')
  })

  it('handles absent sources and rejects duplicates', () => {
    const fixture = screenFixture()
    const service = new BlueBottomPaneService(new Context(), compiler(fixture.screen), fixture.screen)
    const absent = service.register(() => null)
    absent()
    service.register(dock('queue'), (_value, width) => ['queued'.repeat(width)])
    expect(compiler(fixture.screen).components.visibleWidth(fixture.bottom[0]!.render(8)[0]!)).toBeLessThanOrEqual(8)
    expect(() => service.register(dock('queue'))).toThrow(/already registered/)
  })

  it('unmounts a dynamic null source and deactivates retained components on service disposal', () => {
    const fixture = screenFixture()
    const service = new BlueBottomPaneService(new Context(), compiler(fixture.screen), fixture.screen)
    let current: BlueBottomPaneNode | null = dock('dynamic')
    service.register(() => current)
    const retained = fixture.bottom[0]!
    current = null
    service.refresh('dynamic')
    expect(service.list()).toEqual([])
    expect(fixture.bottom).toEqual([])
    expect(retained.render(20)).toEqual([])

    current = dock('dynamic')
    service.refresh('dynamic')
    const remounted = fixture.bottom[0]!
    service.dispose()
    expect(remounted.render(20)).toEqual([])
  })
})
