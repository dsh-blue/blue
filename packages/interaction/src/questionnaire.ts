/**
 * Canonical multi-question controller for `blue-questions`. It retains the
 * answer state machine, drafts, and key mapping while projecting every view
 * through Blue UI list/form/surface nodes.
 *
 * @module @dsh-blue/blue-interaction/questionnaire
 */

import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueTheme } from '@dsh-blue/blue-core'
import { interpolateLocaleMessage, type BlueTranslate } from '@dsh-blue/blue-frontend'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
import { oneLine, windowedRange } from './select-list.ts'

const KEY_TAB = '\t'
const KEY_SHIFT_TAB = '\x1b[Z'
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_ENTER = '\r'
const KEY_SPACE = ' '
const KEY_ESCAPE = '\x1b'
const MAX_OPTION_ROWS = 6
const OTHER_ID = '__other__'

/** Construction options for {@link Questionnaire}. */
export interface QuestionnaireOptions {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly questions: readonly AskUserQuestionItem[]
  readonly onComplete: (answers: AskUserQuestionAnswerItem[]) => void
  readonly onCancel: () => void
  /** Dynamic translator for questionnaire-owned chrome. */
  readonly t?: BlueTranslate
}

interface QuestionState {
  readonly options: readonly AskUserQuestionOption[]
  cursor: number
  readonly toggled: Set<string>
  custom: string | undefined
  draft: string
  answer: AskUserQuestionAnswerItem | undefined
}

/** Canonical questionnaire with one retained draft per question. */
export class Questionnaire implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private tab = 0
  private readonly states: QuestionState[]
  private editing = false

  constructor(private readonly options: QuestionnaireOptions) {
    this.states = options.questions.map(question => ({
      options: question.options ?? [],
      cursor: 0,
      toggled: new Set(),
      custom: undefined,
      draft: '',
      answer: undefined,
    }))
    this.editing = this.isOptionless(this.current())
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onTextSubmit: (_controlId, value) => this.submitCustom(this.current(), this.state(), value),
      onUnhandledEscape: options.onCancel,
      startEditing: () => this.editing,
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  private current(): AskUserQuestionItem {
    const question = this.options.questions[this.tab]
    if (question === undefined) throw new Error('questionnaire requires at least one question')
    return question
  }

  private state(): QuestionState {
    const state = this.states[this.tab]
    if (state === undefined) throw new Error('questionnaire state is unavailable')
    return state
  }

  private isOptionless(question: AskUserQuestionItem): boolean {
    return (question.options ?? []).length === 0
  }

  private rowCount(state: QuestionState): number { return state.options.length + 1 }

  /** Preserve historical raw keys while delegating text editing to core. */
  handleInput(data: string): void {
    if (this.editing) {
      if (data === KEY_ESCAPE) {
        if (this.isOptionless(this.current())) this.options.onCancel()
        else { this.editing = false; this.adapter.invalidate() }
        return
      }
      if (data === KEY_TAB) { this.move(1); return }
      if (data === KEY_SHIFT_TAB) { this.move(-1); return }
      this.adapter.handleInput(data)
      return
    }
    const question = this.current()
    const state = this.state()
    if (data === KEY_TAB) { this.move(1); return }
    if (data === KEY_SHIFT_TAB) { this.move(-1); return }
    if (data === KEY_UP) { state.cursor = (state.cursor + this.rowCount(state) - 1) % this.rowCount(state); this.adapter.invalidate(); return }
    if (data === KEY_DOWN) { state.cursor = (state.cursor + 1) % this.rowCount(state); this.adapter.invalidate(); return }
    if (data === KEY_SPACE) { this.toggle(question, state); return }
    if (data === KEY_ENTER) { this.confirm(question, state); return }
    if (data === KEY_ESCAPE) { this.options.onCancel(); return }
    if (/^[1-9]$/u.test(data)) {
      const index = Number(data) - 1
      if (index < this.rowCount(state)) { state.cursor = index; this.confirm(question, state) }
    }
  }

  private move(delta: 1 | -1): void {
    this.editing = false
    this.tab = (this.tab + this.options.questions.length + delta) % this.options.questions.length
    this.editing = this.isOptionless(this.current())
    this.adapter.invalidate()
  }

  private toggle(question: AskUserQuestionItem, state: QuestionState): void {
    if (question.multiSelect !== true) return
    const option = state.options[state.cursor]
    if (option === undefined) return
    if (state.toggled.has(option.label)) state.toggled.delete(option.label)
    else state.toggled.add(option.label)
    this.adapter.invalidate()
  }

  private confirm(question: AskUserQuestionItem, state: QuestionState): void {
    if (state.cursor === state.options.length) {
      this.editing = true
      this.adapter.invalidate()
      return
    }
    if (question.multiSelect === true) {
      const selected = state.options.filter(option => state.toggled.has(option.label)).map(option => option.label)
      const focused = state.options[state.cursor]
      if (selected.length === 0 && focused !== undefined) selected.push(focused.label)
      this.recordAnswer(state, {
        id: question.id,
        selected,
        ...(state.custom === undefined ? {} : { custom: state.custom }),
      })
      return
    }
    const chosen = state.options[state.cursor]
    if (chosen !== undefined) this.recordAnswer(state, { id: question.id, selected: [chosen.label] })
  }

  private submitCustom(question: AskUserQuestionItem, state: QuestionState, text: string): void {
    state.draft = text
    if (this.isOptionless(question)) {
      this.recordAnswer(state, { id: question.id, selected: [], ...(text.length === 0 ? {} : { custom: text }) })
      return
    }
    this.editing = false
    if (text.length === 0) { this.adapter.invalidate(); return }
    state.custom = text
    if (question.multiSelect === true) { this.adapter.invalidate(); return }
    this.recordAnswer(state, { id: question.id, selected: [], custom: text })
  }

  private recordAnswer(state: QuestionState, answer: AskUserQuestionAnswerItem): void {
    state.answer = answer
    this.editing = false
    const next = this.states.findIndex(entry => entry.answer === undefined)
    if (next < 0) {
      this.options.onComplete(this.states.map(entry => entry.answer).filter((entry): entry is AskUserQuestionAnswerItem => entry !== undefined))
      return
    }
    this.tab = next
    this.editing = this.isOptionless(this.current())
    this.adapter.invalidate()
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current renderer-neutral question tree. */
  currentNode(): BlueUiNode {
    const t: BlueTranslate = this.options.t ?? interpolateLocaleMessage
    const question = this.current()
    const state = this.state()
    const progress = this.options.questions.map((entry, index) => ({
      text: `${index === 0 ? '' : '  '}${this.states[index]?.answer === undefined ? index === this.tab ? '●' : '○' : '✓'} ${entry.header ?? `Q${String(index + 1)}`}`,
      tone: this.states[index]?.answer === undefined ? index === this.tab ? 'accent' as const : 'muted' as const : 'success' as const,
      ...(index === this.tab ? { emphasis: 'strong' as const } : {}),
    }))
    const body: BlueUiNode[] = [
      { kind: 'rich-text', spans: progress },
      { kind: 'rich-text', spans: [{ text: question.question, tone: 'accent', emphasis: 'strong' }] },
      ...(question.detail === undefined ? [] : [{ kind: 'text', content: question.detail, tone: 'muted' } as const]),
    ]
    if (this.editing) {
      body.push({
        kind: 'form',
        id: 'questionnaire-answer',
        fields: [{ kind: 'input', id: 'answer', label: t('Answer'), value: state.draft }],
      })
    } else {
      const ids = [...state.options.map((_, index) => String(index + 1)), OTHER_ID]
      const range = windowedRange(state.cursor, ids.length, MAX_OPTION_ROWS)
      body.push({
        kind: 'list',
        id: 'questionnaire-options',
        mode: 'single',
        selectedIds: [ids[state.cursor]!],
        items: ids.slice(range.start, range.end).map((id, offset) => {
          const index = range.start + offset
          const option = state.options[index]
          if (option === undefined) return {
            id,
            label: state.custom === undefined ? t('Other') : t('Other: {value}', { value: state.custom }),
            badge: String(state.options.length + 1),
          }
          return {
            id,
            label: `${question.multiSelect === true ? state.toggled.has(option.label) ? '[x] ' : '[ ] ' : ''}${option.label}`,
            ...(option.description === undefined ? {} : { detail: oneLine(option.description) }),
            badge: String(index + 1),
          }
        }),
      })
    }
    return {
      kind: 'surface',
      chrome: 'overlay',
      title: t('Question {current} of {total}', { current: this.tab + 1, total: this.options.questions.length }),
      child: { kind: 'stack', direction: 'column', gap: 1, children: body.map(node => ({ node })) },
      footer: { kind: 'text', content: this.footer(), tone: 'muted' },
    }
  }

  private footer(): string {
    const source = this.editing
      ? this.isOptionless(this.current()) ? 'Enter save · Tab next · Esc cancel' : 'Enter save · Tab next · Esc back'
      : this.current().multiSelect === true
      ? '↑↓ select · 1-9 choose · Space toggle · Enter choose · Tab next · Esc cancel'
      : '↑↓ select · 1-9 choose · Enter choose · Tab next · Esc cancel'
    return this.options.t?.(source) ?? source
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind === 'value-change' && event.controlId === 'answer' && typeof event.value === 'string') {
      this.state().draft = event.value
      return
    }
    if (event.kind === 'selection-change' && event.controlId === 'questionnaire-options' && typeof event.value === 'string') {
      const state = this.state()
      const index = event.value === OTHER_ID ? state.options.length : Number(event.value) - 1
      if (index >= 0 && index < this.rowCount(state)) { state.cursor = index; this.confirm(this.current(), state) }
    }
  }
}
