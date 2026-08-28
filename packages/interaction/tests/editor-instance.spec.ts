/**
 * Tests for the submit-transformer seam and the enhancement presence marks
 * in `../src/editor-instance.ts`: registration order, concatenation
 * semantics, the empty-contribution fallback, and disposer idempotency.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueAutocompleteProvider, BlueComponent, BlueFocusable } from '@dsh-blue/blue-core'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  applyReversibleSubmitTransformers,
  clearSharedEditor,
  clearEditorExtensions,
  EditorHostService,
  ENHANCEMENT_EDITOR_PLUS,
  applySubmitTransformers,
  getSharedEditor,
  hasEditorEnhancement,
  markEditorEnhancement,
  mountEditorReplacement,
  registerEditorAutocompleteSource,
  registerSubmitTransformer,
  setEditorExtensions,
  setSharedEditor,
  setEditorSlotSwap,
  type EditorExtensionBinding,
  type SharedEditor,
} from '../src/editor-instance.ts'

function editorContext(): Context {
  const ctx = new Context()
  new EditorHostService(ctx)
  return ctx
}

function extensionBinding(revision: number): EditorExtensionBinding {
  return {
    revision,
    entries: [],
    complete: async () => ({ ok: true, value: [] }),
    transform: async (_entry, request) => ({ ok: true, value: { text: request.text } }),
    dispatch: async () => ({ ok: true, value: undefined }),
  }
}

function autocompleteProvider(): BlueAutocompleteProvider {
  return {
    getSuggestions: async () => null,
    applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
  }
}

describe('editor extension host state', () => {
  it('publishes the shared editor and clears all owned state on disposal', () => {
    const ctx = editorContext()
    const shared: SharedEditor = {
      editor: {} as SharedEditor['editor'],
      submitPrompt: () => {},
    }
    let notifications = 0
    ctx.blueEditorHost.subscribeEditorState(() => { notifications += 1 })
    setSharedEditor(ctx, shared)
    expect(getSharedEditor(ctx)).toBe(shared)
    clearSharedEditor(ctx)
    expect(getSharedEditor(ctx)).toBeUndefined()

    setSharedEditor(ctx, shared)
    let mounted = false
    setEditorSlotSwap(ctx, {
      mount: () => {
        mounted = true
        return () => {}
      },
    })
    const unmark = markEditorEnhancement(ctx, 'dispose-me')
    const unregisterTransformer = registerSubmitTransformer(ctx, () => [{ type: 'text', text: 'transformed' }])
    setEditorExtensions(ctx, extensionBinding(1))
    const unregisterAutocomplete = registerEditorAutocompleteSource(ctx, 'dispose-me', autocompleteProvider())
    const notificationsBeforeDispose = notifications

    ctx.blueEditorHost.dispose()
    expect(getSharedEditor(ctx)).toBeUndefined()
    expect(ctx.blueEditorHost.extensions).toBeUndefined()
    expect(ctx.blueEditorHost.listAutocompleteSources()).toEqual([])
    expect(hasEditorEnhancement(ctx, 'dispose-me')).toBe(false)
    expect(applySubmitTransformers(ctx, 'plain')).toEqual([{ type: 'text', text: 'plain' }])
    mountEditorReplacement(ctx, {} as BlueFocusable)
    expect(mounted).toBe(false)

    setSharedEditor(ctx, shared)
    expect(notifications).toBe(notificationsBeforeDispose)
    unregisterTransformer()
    unregisterAutocomplete()
    unmark()
  })

  it('notifies only for binding changes and fences stale owner cleanup', () => {
    const ctx = editorContext()
    const first = extensionBinding(1)
    const second = extensionBinding(2)
    let notifications = 0
    const unsubscribe = ctx.blueEditorHost.subscribeEditorState(() => { notifications += 1 })

    setEditorExtensions(ctx, first)
    setEditorExtensions(ctx, first)
    expect(notifications).toBe(1)

    setEditorExtensions(ctx, second)
    clearEditorExtensions(ctx, first)
    expect(ctx.blueEditorHost.extensions).toBe(second)
    expect(notifications).toBe(2)

    clearEditorExtensions(ctx, second)
    expect(ctx.blueEditorHost.extensions).toBeUndefined()
    expect(notifications).toBe(3)

    unsubscribe()
    setEditorExtensions(ctx, first)
    expect(notifications).toBe(3)
  })

  it('keeps autocomplete sources ordered, unique, frozen, and lifecycle-notified', () => {
    const ctx = editorContext()
    const first = autocompleteProvider()
    const second = autocompleteProvider()
    let notifications = 0
    const unsubscribe = ctx.blueEditorHost.subscribeEditorState(() => { notifications += 1 })

    const unregisterFirst = registerEditorAutocompleteSource(ctx, 'first', first)
    const firstSnapshot = ctx.blueEditorHost.listAutocompleteSources()
    expect(firstSnapshot).toEqual([first])
    expect(Object.isFrozen(firstSnapshot)).toBe(true)
    expect(notifications).toBe(1)

    const unregisterSecond = registerEditorAutocompleteSource(ctx, 'second', second)
    expect(ctx.blueEditorHost.listAutocompleteSources()).toEqual([first, second])
    expect(firstSnapshot).toEqual([first])
    expect(notifications).toBe(2)
    expect(() => registerEditorAutocompleteSource(ctx, 'second', first)).toThrow(
      'editor autocomplete source "second" is already registered',
    )
    expect(notifications).toBe(2)

    unregisterFirst()
    unregisterFirst()
    expect(ctx.blueEditorHost.listAutocompleteSources()).toEqual([second])
    expect(notifications).toBe(3)

    unregisterSecond()
    expect(ctx.blueEditorHost.listAutocompleteSources()).toEqual([])
    expect(notifications).toBe(4)
    unsubscribe()
  })
})

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
