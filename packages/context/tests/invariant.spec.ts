import { describe, expect, it } from 'vitest'
import * as invariant from '../src/invariant.ts'
import { apply, contextPlugin } from '../src/plugins.ts'
import { ContextFeature } from '../src/feature.ts'
describe('context invariant companion', () => { it('has a stable entry', () => { expect(invariant.name).toBe('blue-context-invariant'); expect(() => invariant.apply({} as never)).not.toThrow() }) })
describe('context plugin', () => { it('owns feature disposal in the Cordis fiber', () => { const feature = new ContextFeature(); const provided = new Map<string, unknown>(); const cleanups: (() => void)[] = []; const ctx = { provide: (key: string, value: unknown) => provided.set(key, value), effect: (effect: () => () => void) => { cleanups.push(effect()); return cleanups.at(-1) } } as never; contextPlugin(feature).apply(ctx); apply(ctx); expect(provided.get('blueContextFeature')).toBeDefined(); for (const cleanup of cleanups) cleanup(); feature.dispose() }) })
