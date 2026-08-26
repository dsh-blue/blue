import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueEditor } from '@dsh-blue/blue-core'
import { clearSharedEditor, EditorHostService, setSharedEditor } from '../src/editor-instance.ts'
import { EditorModelService } from '../src/editor-model.ts'

function editorFixture(ctx: Context) {
  let value = 'draft'; const submitted: string[] = []; let aborted = 0
  const editor = { disableSubmit: false, getText: () => value, getExpandedText: () => `expanded:${value}`, setText: (next: string) => { value = next } } as unknown as BlueEditor
  setSharedEditor(ctx, { editor, submitPrompt: text => { submitted.push(text) }, abortPrompt: () => { aborted += 1 } })
  return { editor, submitted, aborted: () => aborted }
}

describe('EditorModelService', () => {
  it('projects, updates, submits, and aborts through structured actions', () => {
    const ctx = new Context()
    new EditorHostService(ctx)
    const fixture = editorFixture(ctx)
    const service = new EditorModelService(ctx)
    const seen: string[] = []
    const off = service.subscribe(model => { if (model) seen.push(model.value) })
    expect(service.current).toMatchObject({ value: 'draft', set: { kind: 'editor.set' }, submit: { kind: 'editor.submit' }, abort: { kind: 'editor.abort' } })
    expect(service.update('next')).toBe(true)
    expect(service.execute({ kind: 'editor.set', value: 'set' })).toBe(true)
    expect(service.execute({ kind: 'editor.set', value: 1 })).toBe(false)
    expect(service.execute({ kind: 'editor.submit' })).toBe(true)
    expect(service.execute({ kind: 'editor.submit', value: 'explicit' })).toBe(true)
    expect(service.execute({ kind: 'editor.submit', value: 1 })).toBe(false)
    expect(fixture.submitted).toEqual(['expanded:set', 'explicit'])
    expect(service.execute({ kind: 'editor.abort' })).toBe(true)
    expect(fixture.aborted()).toBe(1)
    expect(service.execute({ kind: 'other' })).toBe(false)
    expect(seen).toContain('set')
    expect(fixture.editor.getText()).toBe('set')
    off()
    service.dispose()
    clearSharedEditor(ctx)
  })

  it('degrades when input is absent and handles lifecycle events', () => {
    const ctx = new Context()
    new EditorHostService(ctx)
    const service = new EditorModelService(ctx)
    expect(service.current).toBeUndefined()
    expect(service.update('x')).toBe(false)
    const off = service.subscribe(() => {})
    off()
    service.dispose()
  })

  it('refuses disabled submit and falls back to clearing on abort', () => {
    const ctx = new Context()
    new EditorHostService(ctx)
    let value = 'draft'
    const editor = { disableSubmit: true, getText: () => value, getExpandedText: () => value, setText: (next: string) => { value = next } } as unknown as BlueEditor
    setSharedEditor(ctx, { editor, submitPrompt: () => {} })
    const service = new EditorModelService(ctx)
    expect(service.execute({ kind: 'editor.submit' })).toBe(false)
    expect(service.execute({ kind: 'editor.abort' })).toBe(true)
    expect(value).toBe('')
    clearSharedEditor(ctx)
    expect(service.execute({ kind: 'editor.abort' })).toBe(false)
    service.dispose()
  })
})
