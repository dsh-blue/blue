/**
 * Frontend-tree-scoped editor host. The service owns renderer references,
 * panel-slot replacement, enhancement presence, and submit transformations;
 * this module contains no product-level singleton state.
 *
 * @module @dsh-blue/blue-interaction/editor-instance
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { BlueAutocompleteProvider, BlueEditor, BlueFocusable } from '@dsh-blue/blue-core'

declare module '@deepseek-ai/cordis' {
  interface Context { blueEditorHost: EditorHostService }
  interface Events { 'blue/input-editor-changed'(): void }
}

/** The editor and callbacks published by `blue-input` while mounted. */
export interface SharedEditor {
  readonly editor: BlueEditor
  readonly submitPrompt: (text: string) => void
  readonly abortPrompt?: () => void
  readonly notice?: (text: string) => void
}

/** Editor-slot replacement machinery installed by `blue-input`. */
export interface EditorSlotSwap {
  readonly mount: (component: BlueFocusable) => () => void
}

/** Reversible content produced by one submit transformer. */
export interface SubmitTransformation {
  readonly blocks: ContentBlock[]
  readonly rollback?: () => void
}

export type SubmitTransformer = (text: string) => ContentBlock[] | SubmitTransformation

/** Presence id of the optional editor-plus enhancement. */
export const ENHANCEMENT_EDITOR_PLUS = 'blue-editor-plus'

/** Per-frontend-tree editor host. */
export class EditorHostService extends Service {
  private shared: SharedEditor | undefined
  private slotSwap: EditorSlotSwap | undefined
  private readonly enhancements = new Set<string>()
  private readonly submitTransformers: SubmitTransformer[] = []
  private readonly editorStateListeners = new Set<() => void>()
  private readonly autocompleteSources = new Map<string, BlueAutocompleteProvider>()

  constructor(ctx: Context) {
    super(ctx, 'blueEditorHost')
  }

  get current(): SharedEditor | undefined { return this.shared }

  setCurrent(value: SharedEditor | undefined): void {
    this.shared = value
    this.emitEditorState()
  }

  setSlotSwap(value: EditorSlotSwap | undefined): void { this.slotSwap = value }

  mountReplacement(component: BlueFocusable): () => void {
    return this.slotSwap?.mount(component) ?? (() => {})
  }

  markEnhancement(id: string): () => void {
    this.enhancements.add(id)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.enhancements.delete(id)
    }
  }

  hasEnhancement(id: string): boolean { return this.enhancements.has(id) }

  /** Observe editor and autocomplete-source changes. */
  subscribeEditorState(listener: () => void): () => void {
    this.editorStateListeners.add(listener)
    return () => { this.editorStateListeners.delete(listener) }
  }

  /** Register one Blue-owned completion source in stable insertion order. */
  registerAutocompleteSource(id: string, provider: BlueAutocompleteProvider): () => void {
    if (this.autocompleteSources.has(id)) throw new Error(`editor autocomplete source "${id}" is already registered`)
    this.autocompleteSources.set(id, provider)
    this.emitEditorState()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.autocompleteSources.delete(id)
      this.emitEditorState()
    }
  }

  /** Stable snapshot of Blue-owned completion sources. */
  listAutocompleteSources(): readonly BlueAutocompleteProvider[] {
    return Object.freeze([...this.autocompleteSources.values()])
  }

  registerSubmitTransformer(transformer: SubmitTransformer): () => void {
    this.submitTransformers.push(transformer)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const index = this.submitTransformers.indexOf(transformer)
      if (index >= 0) this.submitTransformers.splice(index, 1)
    }
  }

  applySubmitTransformers(text: string): ContentBlock[] {
    return this.applyReversibleSubmitTransformers(text).blocks
  }

  applyReversibleSubmitTransformers(text: string): SubmitTransformation {
    if (this.submitTransformers.length === 0) return { blocks: [{ type: 'text', text }] }
    const blocks: ContentBlock[] = []
    const rollbacks: Array<() => void> = []
    for (const transformer of this.submitTransformers) {
      const result = transformer(text)
      if (Array.isArray(result)) blocks.push(...result)
      else {
        blocks.push(...result.blocks)
        if (result.rollback !== undefined) rollbacks.push(result.rollback)
      }
    }
    let rolledBack = false
    return {
      blocks: blocks.length === 0 ? [{ type: 'text', text }] : blocks,
      ...(rollbacks.length === 0 ? {} : {
        rollback: () => {
          if (rolledBack) return
          rolledBack = true
          for (const rollback of rollbacks.reverse()) rollback()
        },
      }),
    }
  }

  dispose(): void {
    this.shared = undefined
    this.slotSwap = undefined
    this.enhancements.clear()
    this.submitTransformers.splice(0)
    this.autocompleteSources.clear()
    this.editorStateListeners.clear()
  }

  private emitEditorState(): void {
    for (const listener of this.editorStateListeners) listener()
  }
}

export const setSharedEditor = (ctx: Context, value: SharedEditor): void => { ctx.blueEditorHost.setCurrent(value) }
export const clearSharedEditor = (ctx: Context): void => { ctx.blueEditorHost.setCurrent(undefined) }
export const getSharedEditor = (ctx: Context): SharedEditor | undefined => ctx.blueEditorHost.current
export const setEditorSlotSwap = (ctx: Context, value: EditorSlotSwap | undefined): void => { ctx.blueEditorHost.setSlotSwap(value) }
export const mountEditorReplacement = (ctx: Context, component: BlueFocusable): (() => void) => ctx.blueEditorHost.mountReplacement(component)
export const markEditorEnhancement = (ctx: Context, id: string): (() => void) => ctx.blueEditorHost.markEnhancement(id)
export const hasEditorEnhancement = (ctx: Context, id: string): boolean => ctx.blueEditorHost.hasEnhancement(id)
export const registerSubmitTransformer = (ctx: Context, transformer: SubmitTransformer): (() => void) => ctx.blueEditorHost.registerSubmitTransformer(transformer)
export const applySubmitTransformers = (ctx: Context, text: string): ContentBlock[] => ctx.blueEditorHost.applySubmitTransformers(text)
export const applyReversibleSubmitTransformers = (ctx: Context, text: string): SubmitTransformation => ctx.blueEditorHost.applyReversibleSubmitTransformers(text)
export const registerEditorAutocompleteSource = (ctx: Context, id: string, provider: BlueAutocompleteProvider): (() => void) => ctx.blueEditorHost.registerAutocompleteSource(id, provider)
