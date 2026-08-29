/**
 * Minimal editor engine shared by canonical plugin-surface fixtures.
 *
 * @module @dsh-blue/blue-core/tests/fake-editor
 */
import type { BlueEditor } from '../src/types.ts'
import { truncateToWidth } from '../src/width.ts'

/** Create a deterministic editor with the form compiler's required semantics. */
export function createFakeEditor(): BlueEditor {
  let value = ''
  const editor = {
    focused: false,
    onSubmit: undefined,
    onChange: undefined,
    onKey: undefined,
    disableSubmit: false,
    getText: () => value,
    getExpandedText: () => value,
    setText: (text: string) => { value = text },
    handleInput: (data: string) => {
      if (editor.onKey?.(data) === true) return
      if (data === '\r') {
        if (editor.disableSubmit) value += '\n'
        else editor.onSubmit?.(value)
      } else if (/^[^\x00-\x1f\x7f-\x9f]+$/u.test(data)) {
        value += data
        editor.onChange?.(value)
      }
    },
    renderContent: (width: number) => [truncateToWidth(value, width)],
    render: (width: number) => [truncateToWidth(value, width)],
    invalidate: () => {},
    addToHistory: () => {},
    getHistory: () => [],
    setBorderColor: () => {},
    setPromptSymbol: () => {},
    setBorderLabel: () => {},
    setConnectedAbove: () => {},
    setGhostHint: () => {},
    setAutocompleteProvider: () => {},
    isShowingAutocomplete: () => false,
    refreshAutocomplete: () => {},
    insertText: (text: string) => { value += text; editor.onChange?.(value) },
  } as BlueEditor
  return editor
}
