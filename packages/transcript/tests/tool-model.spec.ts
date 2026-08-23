import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen } from '@dsh-blue/blue-core'
import type { ToolPresentationModel } from '@dsh-blue/blue-frontend'
import { BlueModelToolService, ToolModelComponent } from '../src/tool-model.ts'

function screenFixture() {
  const children: BlueComponent[] = []; const renders: number[] = []
  const screen = { addChild: (component: BlueComponent) => { children.push(component); return () => { const index = children.indexOf(component); if (index >= 0) children.splice(index, 1) } }, requestRender: () => { renders.push(1) } } as unknown as BlueScreen
  return { screen, children, renders }
}
const tool = (id: string, expanded = true): ToolPresentationModel => ({ kind: 'tool', id, name: id, call: { kind: 'text', text: 'call' }, result: { kind: 'text', text: 'result' }, expanded })

describe('BlueModelToolService', () => {
  it('mounts dynamic tools and renders call/result plain fallback', () => {
    const ctx = new Context(); const fixture = screenFixture(); const service = new BlueModelToolService(ctx); service.attach(fixture.screen); let current = tool('one'); const dispose = service.register(() => current); const component = fixture.children[0] as ToolModelComponent; expect(component.render(10)).toEqual(['result']); current = tool('one', false); service.refresh('one'); service.refresh('missing'); expect(fixture.children).toHaveLength(1); expect((fixture.children[0] as ToolModelComponent).render(10)).toEqual(['call']); expect(service.list()).toHaveLength(1); dispose(); dispose(); expect(component.render(10)).toEqual([])
  })
  it('handles absent, duplicate, late attach, collapsed and unload', () => {
    const ctx = new Context(); const service = new BlueModelToolService(ctx); const absent = service.register(() => null); absent(); const late = service.register(tool('late')); expect(service.list()).toHaveLength(1); const fixture = screenFixture(); service.attach(fixture.screen); expect(fixture.children).toHaveLength(1); expect(() => service.register(tool('late'))).toThrow(/already registered/); const hidden = service.register(tool('hidden', false)); hidden(); late(); service.register(tool('active')); expect(fixture.children).toHaveLength(1); service.dispose(); expect(fixture.children).toHaveLength(0)
  })
  it('renders missing views and invalidates safely', () => { const empty = new ToolModelComponent(() => ({ kind: 'tool', id: 'empty', name: 'empty' })); expect(empty.render(10)).toEqual([]); empty.invalidate(); const none = new ToolModelComponent(() => null); expect(none.render(10)).toEqual([]); none.invalidate() })
  it('renders a statically registered model through the mounted closure', () => { const ctx = new Context(); const fixture = screenFixture(); const service = new BlueModelToolService(ctx, fixture.screen); service.register(tool('static')); expect((fixture.children[0] as ToolModelComponent).render(10)).toEqual(['result']); service.dispose() })
})
