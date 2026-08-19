/**
 * Tests for the `Questionnaire` overlay component: the tab row, the three
 * question shapes (single-select, multi-select, free text), the `Other`
 * custom-answer editor, tab navigation, list truncation, and the
 * complete/cancel callbacks.
 */

import { describe, expect, it, vi } from 'vitest'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { Questionnaire } from '../src/questionnaire.ts'
import { FakeBlueComponents, FakeTheme, KEY } from './fakes.ts'

function make(questions: AskUserQuestionItem[]): {
  questionnaire: Questionnaire
  components: FakeBlueComponents
  completed: ReturnType<typeof vi.fn>
  cancelled: ReturnType<typeof vi.fn>
} {
  const components = new FakeBlueComponents()
  const completed = vi.fn()
  const cancelled = vi.fn()
  const questionnaire = new Questionnaire({
    theme: new FakeTheme(),
    components,
    questions,
    onComplete: completed,
    onCancel: cancelled,
  })
  return { questionnaire, components, completed, cancelled }
}

function choice(question: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
  return {
    id: 'q1',
    question: 'Pick one',
    options: [{ label: 'Alpha', description: 'the first' }, { label: 'Beta' }],
    ...question,
  }
}

function type(questionnaire: Questionnaire, text: string): void {
  for (const char of text) questionnaire.handleInput(char)
}

describe('Questionnaire', () => {
  it('renders the framed dialog: title, tabs, question, detail, options, and the Other row', () => {
    const { questionnaire } = make([choice({ header: 'Setup', detail: 'extra context' })])
    const rows = questionnaire.render(60)
    const bar = '^' + '─'.repeat(60) + '^'
    expect(rows[0]).toBe(bar)
    expect(rows[1]).toBe('^ question ^')
    expect(rows[2]).toBe('^Setup^')
    expect(rows[3]).toBe('')
    expect(rows[4]).toBe('^Pick one^')
    expect(rows[5]).toBe('~extra context~')
    expect(rows[6]).toBe('^→ Alpha^~ — the first~')
    expect(rows[7]).toBe('  Beta')
    expect(rows[8]).toBe('  Other')
    expect(rows[9]).toBe('')
    expect(rows[10]).toBe('_  ↑↓ select · space toggle · ↵ choose · tab switch · esc cancel_')
    expect(rows[11]).toBe(bar)
  })

  it('answers a single-select question with the highlighted option and completes', () => {
    const { questionnaire, completed } = make([choice()])
    questionnaire.handleInput(KEY.down)
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['Beta'] }])
  })

  it('wraps the cursor with Up and Down', () => {
    const { questionnaire } = make([choice()])
    // Rows: Alpha, Beta, Other — Up from the top lands on Other.
    questionnaire.handleInput(KEY.up)
    expect(questionnaire.render(60)[7]).toBe('^→ Other^')
    questionnaire.handleInput(KEY.down)
    expect(questionnaire.render(60)[5]).toBe('^→ Alpha^~ — the first~')
  })

  it('answers a multi-select question with the toggled labels', () => {
    const { questionnaire, completed } = make([choice({
      multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    })])
    questionnaire.handleInput(KEY.space)
    questionnaire.handleInput(KEY.down)
    questionnaire.handleInput(KEY.down)
    questionnaire.handleInput(KEY.space)
    const rows = questionnaire.render(60)
    expect(rows[5]).toBe('  [x] A')
    expect(rows[7]).toBe('^→ [x] C^')
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['A', 'C'] }])
  })

  it('confirms the focused option in a multi-select when nothing was toggled', () => {
    const { questionnaire, completed } = make([choice({
      multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }],
    })])
    questionnaire.handleInput(KEY.down)
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['B'] }])
  })

  it('ignores Space on a single-select list and on the Other row', () => {
    const { questionnaire, completed } = make([choice({ multiSelect: true })])
    // Cursor on Other: Space is a no-op there.
    questionnaire.handleInput(KEY.up)
    questionnaire.handleInput(KEY.space)
    questionnaire.handleInput(KEY.enter)
    // Enter on Other opened the editor instead of answering.
    expect(completed).not.toHaveBeenCalled()
    questionnaire.handleInput(KEY.escape)
    // Single-select: Space never toggles.
    const second = make([choice()])
    second.questionnaire.handleInput(KEY.space)
    expect(second.questionnaire.render(60)[5]).toBe('^→ Alpha^~ — the first~')
    second.questionnaire.handleInput(KEY.escape)
  })

  it('answers a single-select Other with custom text', () => {
    const { questionnaire, completed } = make([choice()])
    questionnaire.handleInput(KEY.up)
    questionnaire.handleInput(KEY.enter)
    type(questionnaire, 'mine')
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([{ id: 'q1', selected: [], custom: 'mine' }])
  })

  it('keeps custom text alongside toggled labels in a multi-select', () => {
    const { questionnaire, completed } = make([choice({
      multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }],
    })])
    questionnaire.handleInput(KEY.space)
    questionnaire.handleInput(KEY.up) // wraps to Other
    questionnaire.handleInput(KEY.enter) // open the editor
    type(questionnaire, 'note')
    questionnaire.handleInput(KEY.enter) // save the custom text, back to the list
    expect(completed).not.toHaveBeenCalled()
    // The cursor stayed on the Other row, which now shows the custom text.
    expect(questionnaire.render(60)[7]).toBe('^→ Other: note^')
    questionnaire.handleInput(KEY.up) // B
    questionnaire.handleInput(KEY.up) // A
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['A'], custom: 'note' }])
  })

  it('exits the Other editor without a custom answer on empty text', () => {
    const { questionnaire, completed } = make([choice()])
    questionnaire.handleInput(KEY.up)
    questionnaire.handleInput(KEY.enter)
    questionnaire.handleInput(KEY.enter)
    expect(completed).not.toHaveBeenCalled()
    // Back in list mode: the Other row is rendered again.
    expect(questionnaire.render(60)[7]).toBe('^→ Other^')
    questionnaire.handleInput(KEY.escape)
  })

  it('answers an optionless question with custom text straight from the editor', () => {
    const { questionnaire, components, completed } = make([{ id: 'q2', question: 'Why?' }])
    // The editor opens with the question, above the frame's key row.
    expect(components.editors).toHaveLength(1)
    expect(questionnaire.render(60)[5]).toBe('>')
    type(questionnaire, 'because')
    expect(questionnaire.render(60)[5]).toBe('>because')
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([{ id: 'q2', selected: [], custom: 'because' }])
  })

  it('answers an optionless question without custom text on an empty submission', () => {
    const { questionnaire, completed } = make([{ id: 'q2', question: 'Why?' }])
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([{ id: 'q2', selected: [] }])
  })

  it('advances to the next unanswered question and completes after the last', () => {
    const { questionnaire, completed } = make([choice(), { id: 'q2', question: 'Name?' }])
    questionnaire.handleInput(KEY.enter)
    expect(completed).not.toHaveBeenCalled()
    // The tab row marks q1 answered and highlights Q2; its editor is open.
    expect(questionnaire.render(60)[2]).toBe('(✓) Q1  ^Q2^')
    type(questionnaire, 'neo')
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([
      { id: 'q1', selected: ['Alpha'] },
      { id: 'q2', selected: [], custom: 'neo' },
    ])
  })

  it('switches tabs with Tab and Shift-Tab, wrapping around', () => {
    const { questionnaire } = make([choice(), choice({ id: 'q2', question: 'Second' })])
    questionnaire.handleInput(KEY.tab)
    expect(questionnaire.render(60)[2]).toBe('~(○) Q1~  ^Q2^')
    questionnaire.handleInput(KEY.tab)
    expect(questionnaire.render(60)[2]).toBe('^Q1^  ~(○) Q2~')
    questionnaire.handleInput(KEY.shiftTab)
    expect(questionnaire.render(60)[2]).toBe('~(○) Q1~  ^Q2^')
    questionnaire.handleInput(KEY.escape)
  })

  it('leaves the editor and switches tabs on Tab while editing', () => {
    const { questionnaire } = make([{ id: 'q1', question: 'Why?' }, choice({ id: 'q2' })])
    type(questionnaire, 'draft')
    questionnaire.handleInput(KEY.tab)
    // The draft is lost with the editor; the optioned question shows its list.
    expect(questionnaire.render(60)[2]).toBe('~(○) Q1~  ^Q2^')
    questionnaire.handleInput(KEY.shiftTab)
    // Back on the optionless question: a fresh editor opens.
    expect(questionnaire.render(60)[5]).toBe('>')
    // Shift-Tab while editing wraps to the optioned question too.
    questionnaire.handleInput(KEY.shiftTab)
    expect(questionnaire.render(60)[2]).toBe('~(○) Q1~  ^Q2^')
    questionnaire.handleInput(KEY.escape)
  })

  it('untoggles an option with a second Space', () => {
    const { questionnaire, completed } = make([choice({
      multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }],
    })])
    questionnaire.handleInput(KEY.space)
    expect(questionnaire.render(60)[5]).toBe('^→ [x] A^')
    questionnaire.handleInput(KEY.space)
    expect(questionnaire.render(60)[5]).toBe('^→ [ ] A^')
    questionnaire.handleInput(KEY.escape)
    expect(completed).not.toHaveBeenCalled()
  })

  it('advances between optioned questions without opening an editor', () => {
    const { questionnaire, completed } = make([choice(), choice({ id: 'q2', question: 'Second' })])
    questionnaire.handleInput(KEY.enter)
    expect(completed).not.toHaveBeenCalled()
    expect(questionnaire.render(60)[2]).toBe('(✓) Q1  ^Q2^')
    questionnaire.handleInput(KEY.enter)
    expect(completed).toHaveBeenCalledWith([
      { id: 'q1', selected: ['Alpha'] },
      { id: 'q2', selected: ['Alpha'] },
    ])
  })

  it('ignores unrelated keys in list mode', () => {
    const { questionnaire, completed, cancelled } = make([choice()])
    questionnaire.handleInput('x')
    expect(completed).not.toHaveBeenCalled()
    expect(cancelled).not.toHaveBeenCalled()
    questionnaire.handleInput(KEY.escape)
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('truncates long option lists behind a muted ellipsis row', () => {
    const options = Array.from({ length: 10 }, (_, index) => ({ label: `opt-${index}` }))
    const { questionnaire } = make([choice({ options })])
    const rows = questionnaire.render(60)
    // Frame + tabs + question + 6 entries (the S12 kimi value) + the
    // ellipsis row + the key row.
    expect(rows).toHaveLength(15)
    expect(rows[11]).toBe('~…~')
    expect(rows[13]).toBe('_  ↑↓ select · space toggle · ↵ choose · tab switch · esc cancel_')
    questionnaire.handleInput(KEY.escape)
  })

  it('dismisses through the cancel callback on Escape, in list and editing mode', () => {
    const first = make([choice()])
    first.questionnaire.handleInput(KEY.escape)
    expect(first.cancelled).toHaveBeenCalledOnce()
    const second = make([{ id: 'q2', question: 'Why?' }])
    second.questionnaire.handleInput(KEY.escape)
    expect(second.cancelled).toHaveBeenCalledOnce()
  })

  it('invalidates through the editor when one is open', () => {
    const { questionnaire } = make([{ id: 'q2', question: 'Why?' }])
    questionnaire.invalidate()
    questionnaire.handleInput(KEY.escape)
    const list = make([choice()])
    list.questionnaire.invalidate()
    list.questionnaire.handleInput(KEY.escape)
  })
})
