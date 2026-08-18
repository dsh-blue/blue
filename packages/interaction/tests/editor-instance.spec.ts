/**
 * Tests for the submit-transformer seam in `../src/editor-instance.ts`:
 * registration order, concatenation semantics, the empty-contribution
 * fallback, and disposer idempotency.
 */

import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { applySubmitTransformers, registerSubmitTransformer } from '../src/editor-instance.ts'

describe('submit transformers', () => {
  it('returns the historical single text block with no transformers registered', () => {
    expect(applySubmitTransformers('plain')).toEqual([{ type: 'text', text: 'plain' }])
  })

  it('concatenates every transformer contribution in registration order', () => {
    const disposeFirst = registerSubmitTransformer(text => [
      { type: 'text', text: `first:${text}` },
    ])
    const disposeSecond = registerSubmitTransformer(() => [
      { type: 'text', text: 'second-a' },
      { type: 'text', text: 'second-b' },
    ])
    expect(applySubmitTransformers('x')).toEqual([
      { type: 'text', text: 'first:x' },
      { type: 'text', text: 'second-a' },
      { type: 'text', text: 'second-b' },
    ])
    disposeFirst()
    disposeSecond()
  })

  it('skips empty contributions and falls back to the text block when all decline', () => {
    const disposeEmpty = registerSubmitTransformer(() => [])
    expect(applySubmitTransformers('untouched')).toEqual([{ type: 'text', text: 'untouched' }])
    const disposeReal = registerSubmitTransformer((text): ContentBlock[] => [
      { type: 'text', text: `kept:${text}` },
    ])
    expect(applySubmitTransformers('y')).toEqual([{ type: 'text', text: 'kept:y' }])
    disposeEmpty()
    disposeReal()
  })

  it('disposer unregisters exactly once and is safe to call twice', () => {
    const dispose = registerSubmitTransformer(text => [{ type: 'text', text: `gone:${text}` }])
    expect(applySubmitTransformers('z')).toEqual([{ type: 'text', text: 'gone:z' }])
    dispose()
    dispose()
    expect(applySubmitTransformers('z')).toEqual([{ type: 'text', text: 'z' }])
  })
})
