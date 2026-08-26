/**
 * Tests for the submit-transformer seam and the enhancement presence marks
 * in `../src/editor-instance.ts`: registration order, concatenation
 * semantics, the empty-contribution fallback, and disposer idempotency.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueFocusable } from '@dsh-blue/blue-core'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  applyReversibleSubmitTransformers,
  EditorHostService,
  ENHANCEMENT_EDITOR_PLUS,
  applySubmitTransformers,
  hasEditorEnhancement,
  markEditorEnhancement,
  mountEditorReplacement,
  registerSubmitTransformer,
  setEditorSlotSwap,
} from '../src/editor-instance.ts'

function editorContext(): Context {
  const ctx = new Context()
  new EditorHostService(ctx)
  return ctx
}

describe('submit transformers', () => {
  it('composes idempotent rollback functions in reverse registration order', () => {
    const ctx = editorContext()
    const restored: string[] = []
    const first = registerSubmitTransformer(ctx, () => ({
      blocks: [{ type: 'text', text: 'first' }],
      rollback: () => restored.push('first'),
    }))
    const second = registerSubmitTransformer(ctx, () => ({
      blocks: [{ type: 'text', text: 'second' }],
      rollback: () => restored.push('second'),
    }))
    try {
      const result = applyReversibleSubmitTransformers(ctx, 'x')
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
    const ctx = editorContext()
    const dispose = registerSubmitTransformer(ctx, () => ({ blocks: [{ type: 'text', text: 'object' }] }))
    try {
      expect(applyReversibleSubmitTransformers(ctx, 'x')).toEqual({ blocks: [{ type: 'text', text: 'object' }] })
    } finally {
      dispose()
    }
  })

  it('returns the historical single text block with no transformers registered', () => {
    const ctx = editorContext()
    expect(applySubmitTransformers(ctx, 'plain')).toEqual([{ type: 'text', text: 'plain' }])
  })

  it('concatenates every transformer contribution in registration order', () => {
    const ctx = editorContext()
    const disposeFirst = registerSubmitTransformer(ctx, text => [
      { type: 'text', text: `first:${text}` },
    ])
    const disposeSecond = registerSubmitTransformer(ctx, () => [
      { type: 'text', text: 'second-a' },
      { type: 'text', text: 'second-b' },
    ])
    expect(applySubmitTransformers(ctx, 'x')).toEqual([
      { type: 'text', text: 'first:x' },
      { type: 'text', text: 'second-a' },
      { type: 'text', text: 'second-b' },
    ])
    disposeFirst()
    disposeSecond()
  })

  it('skips empty contributions and falls back to the text block when all decline', () => {
    const ctx = editorContext()
    const disposeEmpty = registerSubmitTransformer(ctx, () => [])
    expect(applySubmitTransformers(ctx, 'untouched')).toEqual([{ type: 'text', text: 'untouched' }])
    const disposeReal = registerSubmitTransformer(ctx, (text): ContentBlock[] => [
      { type: 'text', text: `kept:${text}` },
    ])
    expect(applySubmitTransformers(ctx, 'y')).toEqual([{ type: 'text', text: 'kept:y' }])
    disposeEmpty()
    disposeReal()
  })

  it('disposer unregisters exactly once and is safe to call twice', () => {
    const ctx = editorContext()
    const dispose = registerSubmitTransformer(ctx, text => [{ type: 'text', text: `gone:${text}` }])
    expect(applySubmitTransformers(ctx, 'z')).toEqual([{ type: 'text', text: 'gone:z' }])
    dispose()
    dispose()
    expect(applySubmitTransformers(ctx, 'z')).toEqual([{ type: 'text', text: 'z' }])
  })
})

describe('enhancement presence marks', () => {
  it('marks attachment, reports presence, and unmarks exactly once', () => {
    const ctx = editorContext()
    expect(hasEditorEnhancement(ctx, ENHANCEMENT_EDITOR_PLUS)).toBe(false)
    const unmark = markEditorEnhancement(ctx, ENHANCEMENT_EDITOR_PLUS)
    expect(hasEditorEnhancement(ctx, ENHANCEMENT_EDITOR_PLUS)).toBe(true)
    unmark()
    unmark()
    expect(hasEditorEnhancement(ctx, ENHANCEMENT_EDITOR_PLUS)).toBe(false)
  })
})

describe('editor-slot swap', () => {
  it('degrades to a no-op mount while no swap is installed', () => {
    const ctx = editorContext()
    // The module state may hold nothing (blue-input never mounted, or a
    // fresh module graph between suites): a dialog opening then degrades
    // instead of crashing, and the returned disposer is inert.
    setEditorSlotSwap(ctx, undefined)
    const panel: BlueFocusable & BlueComponent = {
      focused: false,
      handleInput: () => {},
      invalidate: () => {},
      render: () => ['panel'],
    }
    const restore = mountEditorReplacement(ctx, panel)
    expect(() => {
      restore()
      restore()
    }).not.toThrow()
  })

  it('mounts through the installed swap and forwards the disposer', () => {
    const ctx = editorContext()
    const mounted: string[] = []
    setEditorSlotSwap(ctx, {
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
    const restore = mountEditorReplacement(ctx, panel)
    expect(mounted).toEqual(['panel'])
    restore()
    restore()
    expect(mounted).toEqual([])
    // Leave the module state clean for the suites that follow.
    setEditorSlotSwap(ctx, undefined)
  })
})
