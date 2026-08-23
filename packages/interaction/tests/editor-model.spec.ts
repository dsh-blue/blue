import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueEditor } from '@dsh-blue/blue-core'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import { EditorModelService } from '../src/editor-model.ts'

function editorFixture() {
  let value = 'draft';
  const editor = { disableSubmit: false, getText: () => value, setText: (next: string) => { value = next } } as unknown as BlueEditor
  setSharedEditor({ editor, submitPrompt: () => {} })
  return editor
}

describe('EditorModelService', () => {
  it('projects and updates the shared editor without leaking renderer objects', () => { const editor = editorFixture(); const service = new EditorModelService(new Context()); const seen: string[] = []; const off = service.subscribe(model => { if (model) seen.push(model.value) }); expect(service.current?.value).toBe('draft'); expect(service.update('next')).toBe(true); expect(service.current?.value).toBe('next'); expect(seen).toContain('next'); expect(editor.getText()).toBe('next'); off(); service.dispose(); clearSharedEditor() })
  it('degrades when input is absent and handles lifecycle events', () => { clearSharedEditor(); const service = new EditorModelService(new Context()); expect(service.current).toBeUndefined(); expect(service.update('x')).toBe(false); const off = service.subscribe(() => {}); off(); service.dispose() })
})
