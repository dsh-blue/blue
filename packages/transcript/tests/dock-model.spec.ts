import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueDockOptions, BlueScreen } from '@dsh-blue/blue-core'
import type { DockModel } from '@dsh-blue/blue-frontend'
import { BlueDockModelService, ModelDockComponent } from '../src/dock-model.ts'

function screenFixture() {
  const children: BlueComponent[] = []; const bottom: BlueComponent[] = []; const dockOptions: BlueDockOptions[] = []; const renders: number[] = []
  const mountBottom = (component: BlueComponent, options: BlueDockOptions = {}) => { bottom.push(component); dockOptions.push(options); return () => { const index = bottom.indexOf(component); if (index !== -1) { bottom.splice(index, 1); dockOptions.splice(index, 1) } } }
  const screen = { addChild: (component: BlueComponent) => { children.push(component); return () => { const index = children.indexOf(component); if (index !== -1) children.splice(index, 1) } }, addBottomChild: (component: BlueComponent) => mountBottom(component), addDockChild: mountBottom, requestRender: () => { renders.push(1) } } as unknown as BlueScreen
  return { screen, children, bottom, dockOptions, renders }
}

const dock = (id: string, placement: DockModel['placement'] = 'bottom', view: DockModel['view'] = { kind: 'text', text: 'dock' }, collapsed = false): DockModel => ({ kind: 'dock', id, placement, view, collapsed })

describe('BlueDockModelService', () => {
  it('mounts both screen placements and renders dynamic plain fallback', () => {
    const ctx = new Context(); const fixture = screenFixture(); const service = new BlueDockModelService(ctx); service.attach(fixture.screen); let value = dock('bottom'); const dispose = service.register(() => value); const top = service.register(dock('top', 'left', { kind: 'rich-text', spans: [{ text: 'top' }] })); expect(fixture.bottom).toHaveLength(1); expect(fixture.children).toHaveLength(1); const bottomComponent = fixture.bottom[0]!; expect(bottomComponent.render(20)).toEqual(['dock']); expect(fixture.children[0]!.render(20)).toEqual(['top']); value = dock('bottom', 'bottom', { kind: 'fields', fields: [{ label: 'a', value: 'b' }] }); service.refresh('bottom'); service.refresh('missing'); expect(fixture.bottom).toHaveLength(1); expect(service.list()).toHaveLength(2); top(); dispose(); dispose(); expect(bottomComponent.render(20)).toEqual([]); expect(fixture.bottom).toHaveLength(0); expect(fixture.children).toHaveLength(0); service.dispose(); expect(fixture.bottom).toHaveLength(0); expect(fixture.children).toHaveLength(0)
  })

  it('handles absent, collapsed, duplicate, late attach, and unload', () => {
    const ctx = new Context(); const service = new BlueDockModelService(ctx); const absent = service.register(() => null); absent(); const late = service.register(dock('late')); expect(service.list()).toHaveLength(1); const fixture = screenFixture(); service.attach(fixture.screen); expect(fixture.bottom).toHaveLength(1); expect(() => service.register(dock('late'))).toThrow(/already registered/); const collapsed = service.register(dock('collapsed', 'bottom', { kind: 'text', text: 'hidden' }, true)); expect(fixture.bottom).toHaveLength(2); service.refresh('collapsed'); collapsed(); late(); service.register(dock('active')); expect(fixture.bottom).toHaveLength(1); service.dispose(); expect(fixture.bottom).toHaveLength(0)
  })

  it('renders hidden models as no rows and invalidates without state', () => {
    const component = new ModelDockComponent(() => null); expect(component.render(10)).toEqual([]); component.invalidate(); const hidden = new ModelDockComponent(() => dock('hidden', 'bottom', { kind: 'code', code: 'x' }, true)); expect(hidden.render(10)).toEqual([]); const wide = new ModelDockComponent(() => dock('wide', 'bottom', { kind: 'diff', before: 'a', after: 'abcdef' })); expect(wide.render(3)).toEqual(['- a', '+', 'abc', 'def']); hidden.invalidate(); wide.invalidate()
  })

  it('orders placements and priorities, caps rows, and cleans up on reattach', () => {
    const first = screenFixture(); const second = screenFixture(); const service = new BlueDockModelService(new Context(), first.screen)
    service.register(dock('z-default', 'bottom', { kind: 'text', text: 'z-default' })); service.register(dock('a-default', 'bottom', { kind: 'text', text: 'a-default' })); service.register({ ...dock('z-bottom'), priority: 9 }); service.register({ ...dock('a-bottom'), priority: 1 }); service.register({ ...dock('right', 'right'), priority: 2 }); service.register({ ...dock('left', 'left'), priority: 3 }); service.register({ ...dock('tie-z', 'bottom', { kind: 'text', text: 'tie-z' }), priority: 5 }); service.register({ ...dock('tie-a', 'bottom', { kind: 'text', text: 'tie-a' }), priority: 5 })
    expect(first.children.map(component => component.render(20)[0])).toEqual(['dock', 'dock'])
    first.children[0]!.invalidate()
    expect(first.bottom.map(component => component.render(20)[0])).toEqual(['a-default', 'z-default', 'dock', 'tie-a', 'tie-z', 'dock'])
    expect(first.dockOptions).toEqual([
      { priority: 0 },
      { priority: 0 },
      { priority: 1 },
      { priority: 5 },
      { priority: 5 },
      { priority: 9 },
    ])
    const capped = new ModelDockComponent(() => ({ ...dock('capped', 'bottom', { kind: 'code', code: 'one\ntwo\nthree' }), preferredRows: 2 }))
    expect(capped.render(20)).toEqual(['one', 'two'])
    service.attach(second.screen); expect(first.children).toHaveLength(0); expect(first.bottom).toHaveLength(0); expect(second.children).toHaveLength(2); expect(second.bottom).toHaveLength(6)
    service.dispose()
  })

  it('makes a retained model component inert after its registration is disposed', () => {
    const service = new BlueDockModelService(new Context())
    const dispose = service.register(dock('retained'))
    const component = (service as unknown as { components: Map<string, BlueComponent> }).components.get('retained')
    expect(component?.render(20)).toEqual(['dock'])
    dispose()
    expect(component?.render(20)).toEqual([])
  })

  it('keeps stable mounts while sources collapse and invalidates the component', () => {
    const service = new BlueDockModelService(new Context())
    const absent = service.register(() => null)
    absent()
    const fixture = screenFixture()
    service.attach(fixture.screen)
    let collapsed = false
    service.register(() => dock('changing', 'bottom', { kind: 'text', text: 'live' }, collapsed))
    expect(fixture.bottom[0]!.render(20)).toEqual(['live'])
    collapsed = true
    service.refresh('changing')
    fixture.bottom[0]!.invalidate()
    expect(fixture.bottom[0]!.render(20)).toEqual([])
    service.dispose()
  })
})
