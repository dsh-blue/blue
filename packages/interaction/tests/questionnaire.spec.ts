/** Canonical questionnaire state, keys, drafts, events, and rendering. */

import { describe, expect, it, vi } from 'vitest'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { Questionnaire } from '../src/questionnaire.ts'
import { FakeBlueComponents, FakeTheme, KEY } from './fakes.ts'

function choice(overrides: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
  return {
    id: 'q1', header: 'Setup', question: 'Choose one', detail: 'Pick carefully',
    options: [{ label: 'Alpha', description: 'the first' }, { label: 'Beta' }],
    ...overrides,
  }
}

function make(questions: readonly AskUserQuestionItem[]) {
  const completed = vi.fn()
  const cancelled = vi.fn()
  const questionnaire = new Questionnaire({
    theme: new FakeTheme(), components: new FakeBlueComponents(), questions,
    onComplete: completed, onCancel: cancelled,
  })
  questionnaire.focused = true
  return { questionnaire, completed, cancelled }
}

function type(panel: Questionnaire, text: string): void {
  for (const character of text) panel.handleInput(character)
}

function enterContent(panel: Questionnaire): void { panel.handleInput(KEY.enter) }

function list(panel: Questionnaire) {
  const node = panel.currentNode()
  if (node.kind !== 'surface' || node.child.kind !== 'stack') throw new Error('expected questionnaire surface')
  const result = node.child.children.map(child => child.node).find(child => child.kind === 'list')
  if (result?.kind !== 'list') throw new Error('expected questionnaire list')
  return result
}

describe('Questionnaire', () => {
  it('rejects an empty question set and a missing retained state', () => {
    expect(() => make([])).toThrow('questionnaire requires at least one question')
    const { questionnaire } = make([choice()])
    ;(questionnaire as unknown as { states: unknown[] }).states.length = 0
    expect(() => questionnaire.currentNode()).toThrow('questionnaire state is unavailable')

    const partial = make([choice(), choice({ id: 'q2' })]).questionnaire
    ;(partial as unknown as { states: unknown[] }).states.pop()
    expect(partial.currentNode()).toMatchObject({ title: 'Question 1 of 2' })

    const missingQuestion = make([choice()]).questionnaire
    ;(missingQuestion as unknown as { tab: number }).tab = 9
    expect(() => missingQuestion.currentNode()).toThrow('questionnaire requires at least one question')
  })

  it('projects progress, question, detail, choices, Other, and hints canonically', () => {
    const { questionnaire } = make([choice()])
    expect(questionnaire.currentNode()).toMatchObject({ kind: 'surface', chrome: 'overlay', title: 'Question 1 of 1' })
    const node = questionnaire.currentNode()
    if (node.kind !== 'surface' || node.child.kind !== 'stack') throw new Error('expected questionnaire surface')
    expect(node.child.children[0]?.node).toMatchObject({ kind: 'tabs', id: 'questionnaire-questions', activeId: 'q1' })
    expect(list(questionnaire).items).toMatchObject([
      { id: '1', label: 'Alpha', detail: 'the first', badge: '1' },
      { id: '2', label: 'Beta', badge: '2' },
      { id: '__other__', label: 'Other', badge: '3' },
    ])
    const rows = questionnaire.render(60).join('\n')
    expect(rows).toContain('Setup')
    expect(rows).toContain('Choose one')
    expect(rows).toContain('Pick carefully')
    expect(rows).toContain('←→ tabs')
    expect(rows).toContain('Enter open')
  })

  it('uses non-wrapping list navigation and supports numeric direct selection', () => {
    const first = make([choice()])
    enterContent(first.questionnaire)
    first.questionnaire.handleInput(KEY.up)
    expect(list(first.questionnaire).selectedIds).toEqual(['1'])
    first.questionnaire.handleInput(KEY.down)
    expect(list(first.questionnaire).selectedIds).toEqual(['2'])
    first.questionnaire.handleInput(KEY.down)
    first.questionnaire.handleInput(KEY.down)
    expect(list(first.questionnaire).selectedIds).toEqual(['__other__'])

    const direct = make([choice()])
    direct.questionnaire.handleInput('2')
    expect(direct.completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['Beta'] }])
  })

  it('toggles and untoggles multi-select choices and falls back to focus', () => {
    const value = make([choice({ multiSelect: true })])
    enterContent(value.questionnaire)
    expect(value.questionnaire.render(80).join('\n')).toContain('Space toggle')
    value.questionnaire.handleInput(KEY.space)
    expect(list(value.questionnaire).items[0]?.label).toBe('[x] Alpha')
    value.questionnaire.handleInput(KEY.space)
    expect(list(value.questionnaire).items[0]?.label).toBe('[ ] Alpha')
    value.questionnaire.handleInput(KEY.down)
    value.questionnaire.handleInput(KEY.enter)
    expect(value.completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['Beta'] }])
  })

  it('retains toggles and custom text for a multi-select Other answer', () => {
    const value = make([choice({ multiSelect: true })])
    enterContent(value.questionnaire)
    value.questionnaire.handleInput(KEY.space)
    value.questionnaire.handleInput(KEY.down)
    value.questionnaire.handleInput(KEY.down)
    value.questionnaire.handleInput(KEY.enter)
    type(value.questionnaire, 'note')
    value.questionnaire.handleInput(KEY.enter)
    enterContent(value.questionnaire)
    expect(list(value.questionnaire).items.at(-1)?.label).toBe('Other: note')
    value.questionnaire.handleInput(KEY.up)
    value.questionnaire.handleInput(KEY.enter)
    expect(value.completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['Alpha'], custom: 'note' }])
  })

  it('answers single-select Other and returns from empty Other editing', () => {
    const custom = make([choice()])
    enterContent(custom.questionnaire)
    custom.questionnaire.handleInput(KEY.down)
    custom.questionnaire.handleInput(KEY.down)
    custom.questionnaire.handleInput(KEY.enter)
    custom.questionnaire.focused = true
    custom.questionnaire.handleInput('\x1b[200~我X的答案\x1b[201~')
    for (let step = 0; step < 3; step += 1) custom.questionnaire.handleInput(KEY.left)
    custom.questionnaire.handleInput('\x7f')
    expect(custom.questionnaire.render(60).join('\n')).toContain('我|的答案')
    custom.questionnaire.handleInput(KEY.enter)
    expect(custom.completed).toHaveBeenCalledWith([{ id: 'q1', selected: [], custom: '我的答案' }])

    const empty = make([choice()])
    enterContent(empty.questionnaire)
    empty.questionnaire.handleInput(KEY.down)
    empty.questionnaire.handleInput(KEY.down)
    empty.questionnaire.handleInput(KEY.enter)
    empty.questionnaire.handleInput(KEY.enter)
    expect(empty.completed).not.toHaveBeenCalled()
    expect(list(empty.questionnaire).selectedIds).toEqual(['__other__'])
  })

  it('answers optionless questions, including an empty answer, and cancels on Escape', () => {
    const value = make([{ id: 'free', question: 'Why?' }])
    expect(value.questionnaire.render(60).join('\n')).toContain('Answer:')
    enterContent(value.questionnaire)
    type(value.questionnaire, 'because')
    value.questionnaire.handleInput('\x7f')
    value.questionnaire.handleInput(KEY.enter)
    expect(value.completed).toHaveBeenCalledWith([{ id: 'free', selected: [], custom: 'becaus' }])

    const blank = make([{ id: 'blank', question: 'Anything?' }])
    blank.questionnaire.handleInput(KEY.enter)
    blank.questionnaire.handleInput(KEY.enter)
    blank.questionnaire.handleInput(KEY.enter)
    expect(blank.completed).toHaveBeenCalledWith([{ id: 'blank', selected: [] }])
    const cancelled = make([{ id: 'cancel', question: 'Stop?' }])
    cancelled.questionnaire.handleInput(KEY.escape)
    expect(cancelled.cancelled).toHaveBeenCalledOnce()
  })

  it('moves between questions, retains drafts, and completes in question order', () => {
    const value = make([{ id: 'free', question: 'Free' }, choice({ id: 'q2' })])
    enterContent(value.questionnaire)
    type(value.questionnaire, 'draft')
    value.questionnaire.handleInput(KEY.escape)
    value.questionnaire.handleInput(KEY.escape)
    value.questionnaire.handleInput(KEY.right)
    expect(value.questionnaire.currentNode()).toMatchObject({ title: 'Question 2 of 2' })
    value.questionnaire.handleInput(KEY.left)
    expect(value.questionnaire.render(60).join('\n')).toContain('draft')
    value.questionnaire.handleInput(KEY.enter)
    value.questionnaire.handleInput(KEY.enter)
    value.questionnaire.handleInput(KEY.enter)
    expect(value.questionnaire.render(60).join('\n')).toContain('✓ Q1')
    value.questionnaire.handleInput(KEY.enter)
    value.questionnaire.handleInput(KEY.enter)
    expect(value.completed).toHaveBeenCalledWith([
      { id: 'free', selected: [], custom: 'draft' },
      { id: 'q2', selected: ['Alpha'] },
    ])
  })

  it('switches question tabs with Left/Right and does not wrap', () => {
    const value = make([choice({ id: 'q1' }), { id: 'free', question: 'Free' }])
    value.questionnaire.handleInput(KEY.left)
    expect(value.questionnaire.currentNode()).toMatchObject({ title: 'Question 1 of 2' })
    value.questionnaire.handleInput(KEY.right)
    value.questionnaire.handleInput(KEY.right)
    expect(value.questionnaire.currentNode()).toMatchObject({ title: 'Question 2 of 2' })
    value.questionnaire.handleInput(KEY.left)
    expect(value.questionnaire.currentNode()).toMatchObject({ title: 'Question 1 of 2' })
  })

  it('keeps Tab inert on question tabs and Escape climbs content then tabs', () => {
    const value = make([choice(), choice({ id: 'q2' })])
    value.questionnaire.handleInput(KEY.shiftTab)
    expect(value.questionnaire.currentNode()).toMatchObject({ title: 'Question 1 of 2' })
    value.questionnaire.handleInput(KEY.tab)
    expect(value.questionnaire.currentNode()).toMatchObject({ title: 'Question 1 of 2' })
    value.questionnaire.handleInput(KEY.enter)
    value.questionnaire.handleInput(KEY.escape)
    expect(value.cancelled).not.toHaveBeenCalled()
    value.questionnaire.handleInput(KEY.escape)
    expect(value.cancelled).toHaveBeenCalledOnce()
  })

  it('bounds long option windows and flattens details', () => {
    const options = Array.from({ length: 10 }, (_, index) => ({ label: `opt-${String(index)}`, description: index === 0 ? 'line one\nline two' : undefined }))
    const value = make([choice({ options })])
    expect(list(value.questionnaire).items).toHaveLength(11)
    expect(list(value.questionnaire).items[0]).toMatchObject({ detail: 'line one line two' })
    enterContent(value.questionnaire)
    for (let index = 0; index < 8; index += 1) value.questionnaire.handleInput(KEY.down)
    const rendered = value.questionnaire.render(60).join('\n')
    expect(rendered).toContain('opt-8')
    expect(rendered).not.toContain('opt-0')
  })

  it('ignores irrelevant list keys and Space for single-select or Other', () => {
    const value = make([choice()])
    value.questionnaire.handleInput('x')
    value.questionnaire.handleInput(KEY.space)
    enterContent(value.questionnaire)
    value.questionnaire.handleInput(KEY.up)
    value.questionnaire.handleInput(KEY.space)
    value.questionnaire.handleInput('9')
    expect(value.completed).not.toHaveBeenCalled()
    expect(value.cancelled).not.toHaveBeenCalled()
  })

  it('ignores Space and confirmation when the retained cursor has no option', () => {
    const multi = make([choice({ multiSelect: true })])
    enterContent(multi.questionnaire)
    multi.questionnaire.handleInput(KEY.up)
    multi.questionnaire.handleInput(KEY.space)
    expect(list(multi.questionnaire).items[0]?.label).toBe('[x] Alpha')

    const malformed = make([choice()])
    const state = (malformed.questionnaire as unknown as { states: Array<{ cursor: number }> }).states[0]!
    state.cursor = 4
    malformed.questionnaire.handleInput('9')
    expect(malformed.completed).not.toHaveBeenCalled()

    const missingOption = make([choice({ multiSelect: true })])
    enterContent(missingOption.questionnaire)
    ;(missingOption.questionnaire as unknown as { states: Array<{ cursor: number }> }).states[0]!.cursor = 2
    missingOption.questionnaire.handleInput(KEY.space)
    expect(missingOption.completed).not.toHaveBeenCalled()
  })

  it('bridges focus, compiler events, invalidation, and malformed events safely', () => {
    const value = make([choice()])
    value.questionnaire.focused = true
    expect(value.questionnaire.focused).toBe(true)
    value.questionnaire.invalidate()
    const adapter = (value.questionnaire as unknown as { adapter: { handleInput(data: string): void } }).adapter
    adapter.handleInput(KEY.enter)
    adapter.handleInput(KEY.enter)
    expect(value.completed).toHaveBeenCalledWith([{ id: 'q1', selected: ['Alpha'] }])

    const free = make([{ id: 'free', question: 'Free' }])
    const events = free.questionnaire as unknown as { onEvent(event: { kind: string, controlId: string, value?: unknown }): void }
    events.onEvent({ kind: 'value-change', controlId: 'other', value: 'ignored' })
    events.onEvent({ kind: 'selection-change', controlId: 'other', value: '1' })
    events.onEvent({ kind: 'value-change', controlId: 'answer', value: 3 })
    enterContent(free.questionnaire)
    type(free.questionnaire, 'ok')
    expect(free.questionnaire.render(60).join('\n')).toContain('ok')

    const selected = make([choice()])
    const selectedEvents = selected.questionnaire as unknown as { onEvent(event: { kind: string, controlId: string, value?: unknown }): void }
    selectedEvents.onEvent({ kind: 'selection-change', controlId: 'questionnaire-options', value: '__other__' })
    expect(selected.questionnaire.render(60).join('\n')).toContain('Answer:')

    const ignored = make([choice()])
    const ignoredEvents = ignored.questionnaire as unknown as { onEvent(event: { kind: string, controlId: string, value?: unknown }): void }
    ignoredEvents.onEvent({ kind: 'selection-change', controlId: 'questionnaire-options', value: '0' })
    ignoredEvents.onEvent({ kind: 'selection-change', controlId: 'questionnaire-options', value: '9' })
    ignoredEvents.onEvent({ kind: 'tab-change', controlId: 'questionnaire-questions', tabId: 'missing' })
    expect(ignored.completed).not.toHaveBeenCalled()
  })
})
