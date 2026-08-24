/**
 * Tests for the submit-transformer seam and the enhancement presence marks
 * in `../src/editor-instance.ts`: registration order, concatenation
 * semantics, the empty-contribution fallback, and disposer idempotency.
 */

import { describe, expect, it } from 'vitest'
import type { BlueComponent, BlueFocusable } from '@dsh-blue/blue-core'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  applyReversibleSubmitTransformers,
  ENHANCEMENT_EDITOR_PLUS,
  applySubmitTransformers,
  hasEditorEnhancement,
  markEditorEnhancement,
  mountEditorReplacement,
  registerSubmitTransformer,
  setEditorSlotSwap,
} from '../src/editor-instance.ts'

describe('submit transformers', () => {
  it('composes idempotent rollback functions in reverse registration order', () => {
    const restored: string[] = []
    const first = registerSubmitTransformer(() => ({
      blocks: [{ type: 'text', text: 'first' }],
      rollback: () => restored.push('first'),
    }))
    const second = registerSubmitTransformer(() => ({
      blocks: [{ type: 'text', text: 'second' }],
      rollback: () => restored.push('second'),
    }))
    try {
      const result = applyReversibleSubmitTransformers('x')
      expect(result.blocks.map(block => block.type === 'text' ? block.text : block.type)).toEqual(['first', 'second'])
      result.rollback?.()
      result.rollback?.()
      expect(restored).toEqual(['second', 'first'])
    } finally {
      second()
      first()
    }
  })

  it('accepts an object contribution without a rollback', () => {
    const dispose = registerSubmitTransformer(() => ({ blocks: [{ type: 'text', text: 'object' }] }))
    try {
      expect(applyReversibleSubmitTransformers('x')).toEqual({ blocks: [{ type: 'text', text: 'object' }] })
    } finally {
      dispose()
    }
  })

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

describe('enhancement presence marks', () => {
  it('marks attachment, reports presence, and unmarks exactly once', () => {
    expect(hasEditorEnhancement(ENHANCEMENT_EDITOR_PLUS)).toBe(false)
    const unmark = markEditorEnhancement(ENHANCEMENT_EDITOR_PLUS)
    expect(hasEditorEnhancement(ENHANCEMENT_EDITOR_PLUS)).toBe(true)
    unmark()
    unmark()
    expect(hasEditorEnhancement(ENHANCEMENT_EDITOR_PLUS)).toBe(false)
  })
})

describe('editor-slot swap', () => {
  it('degrades to a no-op mount while no swap is installed', () => {
    // The module state may hold nothing (blue-input never mounted, or a
    // fresh module graph between suites): a dialog opening then degrades
    // instead of crashing, and the returned disposer is inert.
    setEditorSlotSwap(undefined)
    const panel: BlueFocusable & BlueComponent = {
      focused: false,
      handleInput: () => {},
      invalidate: () => {},
      render: () => ['panel'],
    }
    const restore = mountEditorReplacement(panel)
    expect(() => {
      restore()
      restore()
    }).not.toThrow()
  })

  it('mounts through the installed swap and forwards the disposer', () => {
    const mounted: string[] = []
    setEditorSlotSwap({
      mount: (component) => {
        mounted.push(component.render(10)[0] ?? '')
        let restored = false
        return () => {
          if (restored) return
          restored = true
          mounted.pop()
        }
      },
    })
    const panel: BlueFocusable & BlueComponent = {
      focused: false,
      handleInput: () => {},
      invalidate: () => {},
      render: () => ['panel'],
    }
    const restore = mountEditorReplacement(panel)
    expect(mounted).toEqual(['panel'])
    restore()
    restore()
    expect(mounted).toEqual([])
    // Leave the module state clean for the suites that follow.
    setEditorSlotSwap(undefined)
  })
})
