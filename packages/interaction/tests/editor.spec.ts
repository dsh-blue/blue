/**
 * Unit tests for the `BlueInput` editor component over the fake keymap and
 * theme.
 */

import { describe, expect, it, vi } from 'vitest'
import { BlueInput } from '../src/editor.ts'
import { FakeKeymap, FakeTheme, KEY } from './fakes.ts'

function mount(options: {
  onSubmit?: (value: string) => void
  onCancel?: () => void
  onChange?: () => void
  hint?: () => string | undefined
} = {}): BlueInput {
  return new BlueInput({ keymap: new FakeKeymap(), theme: new FakeTheme(), ...options })
}

/** Type one printable sequence per call, as decoded input arrives. */
function type(input: BlueInput, text: string): void {
  for (const char of text) input.handleInput(char)
}

describe('BlueInput editing', () => {
  it('inserts printable text and submits the buffer on Enter', () => {
    const onSubmit = vi.fn()
    const input = mount({ onSubmit })
    type(input, 'hello')
    expect(input.getValue()).toBe('hello')
    input.handleInput(KEY.enter)
    expect(onSubmit).toHaveBeenCalledWith('hello')
  })

  it('ignores control sequences, C1 controls, and empty input', () => {
    const input = mount()
    input.handleInput('\x1b[5~')
    input.handleInput('\x85')
    input.handleInput('')
    expect(input.getValue()).toBe('')
  })

  it('fires onCancel on Escape without clearing the buffer', () => {
    const onCancel = vi.fn()
    const input = mount({ onCancel })
    type(input, 'ab')
    input.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(input.getValue()).toBe('ab')
  })

  it('moves the cursor, edits mid-buffer, and clamps at both ends', () => {
    const input = mount()
    type(input, 'ac')
    input.handleInput(KEY.left)
    input.handleInput(KEY.left)
    input.handleInput(KEY.left)
    // Cursor clamped at the start: insertion lands before 'a'.
    type(input, 'b')
    expect(input.getValue()).toBe('bac')
    input.handleInput(KEY.right)
    input.handleInput(KEY.right)
    input.handleInput(KEY.right)
    input.handleInput(KEY.right)
    type(input, 'd')
    expect(input.getValue()).toBe('bacd')
  })

  it('deletes backward and no-ops at the buffer start', () => {
    const onChange = vi.fn()
    const input = mount({ onChange })
    input.handleInput(KEY.backspace)
    expect(onChange).not.toHaveBeenCalled()
    type(input, 'ab')
    input.handleInput(KEY.backspace)
    expect(input.getValue()).toBe('a')
  })

  it('flattens a single-chunk bracketed paste to one line', () => {
    const input = mount()
    input.handleInput('\x1b[200~line one\nline two\x1b[201~')
    expect(input.getValue()).toBe('line one line two')
  })

  it('clamps the cursor when setValue shortens the buffer', () => {
    const input = mount()
    type(input, 'long text')
    input.setValue('s')
    input.handleInput(KEY.right)
    type(input, 'x')
    expect(input.getValue()).toBe('sx')
  })

  it('invalidate() is a no-op', () => {
    const input = mount()
    input.invalidate()
    expect(input.getValue()).toBe('')
  })
})

describe('BlueInput rendering', () => {
  it('renders the prompt with a reverse-video cursor while focused', () => {
    const input = mount()
    type(input, 'hi')
    input.focused = true
    const [line] = input.render(20)
    expect(line).toBe('*> *hi\x1b[7m \x1b[27m' + ' '.repeat(15))
  })

  it('renders the cursor character plainly while unfocused', () => {
    const input = mount()
    type(input, 'hi')
    const [line] = input.render(10)
    expect(line).toContain('hi ')
    expect(line).not.toContain('\x1b[7m')
  })

  it('scrolls horizontally to keep the cursor visible on overflow', () => {
    const input = mount()
    input.focused = true
    type(input, 'abcdefghij')
    const [line] = input.render(7)
    // text budget = 4; cursor at end shows the tail.
    expect(line).toContain('ghij')
    input.handleInput(KEY.left)
    input.handleInput(KEY.left)
    input.handleInput(KEY.left)
    const [scrolled] = input.render(7)
    expect(scrolled).toContain('\x1b[7m')
  })

  it('renders wide CJK text within the viewport: padding accounts for two-cell graphemes', () => {
    const input = mount()
    input.focused = true
    type(input, '你好啊')
    const [line] = input.render(20)
    // 3 graphemes occupy 6 columns: prompt 2 + text 6 + cursor 1 + padding 11.
    expect(line).toBe('*> *你好啊\x1b[7m \x1b[27m' + ' '.repeat(11))
  })

  it('scrolls wide CJK text in columns so the line never exceeds the width', () => {
    const input = mount()
    input.focused = true
    type(input, '你好世界啊')
    // text budget = 4; scrolling drops three two-column graphemes.
    expect(input.render(7)[0]).toBe('*> *界啊\x1b[7m \x1b[27m')
    // Cursor moved into the middle wraps the grapheme under it in reverse video.
    const mid = mount()
    mid.focused = true
    type(mid, '中文ab')
    mid.handleInput(KEY.left)
    mid.handleInput(KEY.left)
    expect(mid.render(20)[0]).toBe('*> *中文\x1b[7ma\x1b[27mb' + ' '.repeat(11))
  })

  it('renders the hint line muted and truncated when present', () => {
    const input = mount({ hint: () => 'a hint that is far too long' })
    const lines = input.render(10)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('~a hint th…~')
  })

  it('drops the hint line when the hint is undefined and tolerates zero width', () => {
    const withHint = mount({ hint: () => 'hint' })
    expect(withHint.render(0)).toHaveLength(2)
    expect(withHint.render(0)[1]).toBe('~~')
    const without = mount()
    expect(without.render(0)).toHaveLength(1)
  })
})
