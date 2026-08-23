import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen } from '@dsh-blue/blue-core'
import type { DockModel } from '@dsh-blue/blue-frontend'
import { BlueDockModelService, ModelDockComponent } from '../src/dock-model.ts'

function screenFixture() {
  const children: BlueComponent[] = []; const bottom: BlueComponent[] = []; const renders: number[] = []
  const screen = { addChild: (component: BlueComponent) => { children.push(component); return () => { const index = children.indexOf(component); if (index !== -1) children.splice(index, 1) } }, addBottomChild: (component: BlueComponent) => { bottom.push(component); return () => { const index = bottom.indexOf(component); if (index !== -1) bottom.splice(index, 1) } }, requestRender: () => { renders.push(1) } } as unknown as BlueScreen
  return { screen, children, bottom, renders }
}

const dock = (id: string, placement: DockModel['placement'] = 'bottom', view: DockModel['view'] = { kind: 'text', text: 'dock' }, collapsed = false): DockModel => ({ kind: 'dock', id, placement, view, collapsed })

describe('BlueDockModelService', () => {
  it('mounts both screen placements and renders dynamic plain fallback', () => {
    const ctx = new Context(); const fixture = screenFixture(); const service = new BlueDockModelService(ctx); service.attach(fixture.screen); let value = dock('bottom'); const dispose = service.register(() => value); const top = service.register(dock('top', 'left', { kind: 'rich-text', spans: [{ text: 'top' }] })); expect(fixture.bottom).toHaveLength(1); expect(fixture.children).toHaveLength(1); const bottomComponent = fixture.bottom[0] as ModelDockComponent; expect(bottomComponent.render(20)).toEqual(['dock']); expect((fixture.children[0] as ModelDockComponent).render(20)).toEqual(['top']); value = dock('bottom', 'bottom', { kind: 'fields', fields: [{ label: 'a', value: 'b' }] }); service.refresh('bottom'); service.refresh('missing'); expect(fixture.bottom).toHaveLength(1); expect(service.list()).toHaveLength(2); top(); dispose(); dispose(); expect(bottomComponent.render(20)).toEqual([]); expect(fixture.bottom).toHaveLength(0); expect(fixture.children).toHaveLength(0)
  })

  it('handles absent, collapsed, duplicate, late attach, and unload', () => {
    const ctx = new Context(); const service = new BlueDockModelService(ctx); const absent = service.register(() => null); absent(); const late = service.register(dock('late')); expect(service.list()).toHaveLength(1); const fixture = screenFixture(); service.attach(fixture.screen); expect(fixture.bottom).toHaveLength(1); expect(() => service.register(dock('late'))).toThrow(/already registered/); const collapsed = service.register(dock('collapsed', 'bottom', { kind: 'text', text: 'hidden' }, true)); expect(fixture.bottom).toHaveLength(1); service.refresh('collapsed'); collapsed(); late(); service.register(dock('active')); expect(fixture.bottom).toHaveLength(1); service.dispose(); expect(fixture.bottom).toHaveLength(0)
  })

  it('renders hidden models as no rows and invalidates without state', () => {
    const component = new ModelDockComponent(() => null); expect(component.render(10)).toEqual([]); component.invalidate(); const hidden = new ModelDockComponent(() => dock('hidden', 'bottom', { kind: 'code', code: 'x' }, true)); expect(hidden.render(10)).toEqual([]); const wide = new ModelDockComponent(() => dock('wide', 'bottom', { kind: 'diff', before: 'a', after: 'abcdef' })); expect(wide.render(3)).toEqual(['abc']); hidden.invalidate(); wide.invalidate()
  })
})
