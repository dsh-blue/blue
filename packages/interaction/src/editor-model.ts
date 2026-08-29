/**
 * Renderer-neutral projection of the active prompt editor. The shared editor
 * reference remains an internal renderer seam; consumers receive only an
 * immutable model and a structured submit action.
 *
 * @module @dsh-blue/blue-interaction/editor-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Action, EditorModel } from '@dsh-blue/blue-frontend'
import { getSharedEditor } from './editor-instance.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { blueEditorModels: EditorModelService }
  interface Events { 'blue/editor-model-changed'(): void }
}

export class EditorModelService extends Service {
  private readonly listeners = new Set<(model: EditorModel | undefined) => void>()
  constructor(ctx: Context) {
    super(ctx, 'blueEditorModels')
    ctx.on('blue/input-editor-changed', () => this.emit())
    ctx.on('blue/editor-model-changed', () => this.emit())
  }
  get current(): EditorModel | undefined {
    const shared = getSharedEditor(this.ctx)
    if (shared === undefined) return undefined
    return Object.freeze({ kind: 'editor', id: 'prompt', value: shared.editor.getText(), placeholder: 'Message', enabled: !shared.editor.disableSubmit, set: { kind: 'editor.set' }, submit: { kind: 'editor.submit' }, abort: { kind: 'editor.abort' } })
  }
  update(value: string): boolean { const shared = getSharedEditor(this.ctx); if (shared === undefined) return false; shared.editor.setText(value); this.emit(); return true }
  execute(action: Action): boolean {
    const shared = getSharedEditor(this.ctx)
    if (shared === undefined) return false
    if (action.kind === 'editor.set') return typeof action.value === 'string' && this.update(action.value)
    if (action.kind === 'editor.submit') {
      if (shared.editor.disableSubmit) return false
      const value = action.value
      if (value !== undefined && typeof value !== 'string') return false
      if (value !== undefined) shared.editor.setText(value)
      shared.editor.submit()
      this.emit()
      return true
    }
    if (action.kind !== 'editor.abort') return false
    if (shared.abortPrompt === undefined) shared.editor.setText('')
    else shared.abortPrompt()
    this.emit()
    return true
  }
  subscribe(listener: (model: EditorModel | undefined) => void): () => void { this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener) }
  dispose(): void { this.listeners.clear() }
  private emit(): void { const model = this.current; for (const listener of this.listeners) listener(model) }
}
