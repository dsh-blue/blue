import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen } from '@dsh-blue/blue-core'
import type { TranscriptModel } from '@dsh-blue/blue-frontend'
import { TranscriptModelComponent, TranscriptModelService } from '../src/transcript-model.ts'

function fixture() { const children: BlueComponent[] = []; const screen = { addChild: (component: BlueComponent) => { children.push(component); return () => { const index = children.indexOf(component); if (index >= 0) children.splice(index, 1) } }, requestRender: () => {} } as unknown as BlueScreen; return { screen, children } }
const model = (id: string, entries = [{ kind: 'text' as const, text: 'entry' }]): TranscriptModel => ({ kind: 'transcript', id, entries })

describe('TranscriptModelService', () => {
  it('mounts dynamic entries and refreshes plain rows', () => { const ctx = new Context(); const f = fixture(); const service = new TranscriptModelService(ctx, f.screen); let current = model('one'); const dispose = service.register(() => current); const component = f.children[0] as TranscriptModelComponent; expect(component.render(20)).toEqual(['entry']); current = model('one', [{ kind: 'fields', fields: [{ label: 'a', value: 'b' }] }]); service.refresh('one'); expect((f.children[0] as TranscriptModelComponent).render(20)).toEqual(['a: b']); expect(service.list()).toHaveLength(1); service.refresh('missing'); dispose(); dispose(); expect(component.render(20)).toEqual([]); service.refresh('one') })
  it('handles absent, duplicate, late attach and unload', () => { const ctx = new Context(); const service = new TranscriptModelService(ctx); expect(service.register(() => null)).toBeTypeOf('function'); const late = service.register(model('late')); expect(service.list()).toHaveLength(1); const f = fixture(); service.attach(f.screen); expect(f.children).toHaveLength(1); expect(() => service.register(model('late'))).toThrow(/already registered/); late(); service.register(model('active')); expect(f.children).toHaveLength(1); service.dispose(); expect(f.children).toHaveLength(0) })
  it('renders null and nested view shapes safely', () => { expect(new TranscriptModelComponent(() => null).render(10)).toEqual([]); const c = new TranscriptModelComponent(() => model('nested', [{ kind: 'sections', sections: [{ title: 's', body: { kind: 'code', code: 'abcdef' } }] }])); expect(c.render(3)).toEqual(['s: ']); c.invalidate() })
  it('renders a statically registered model and disposes its mounted child', () => { const f = fixture(); const service = new TranscriptModelService(new Context(), f.screen); service.register(model('static')); expect((f.children[0] as TranscriptModelComponent).render(20)).toEqual(['entry']); service.dispose(); expect(f.children).toHaveLength(0) })
})
