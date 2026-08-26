/**
 * `Questionnaire`: the progress-driven multi-question overlay component behind the
 * `blue-questions` provider. One overlay carries the whole request: a tab
 * row (one entry per question, the current one highlighted, answered ones
 * check-marked) above the active question's body — an option list (Space
 * toggles in a multi-select) with a fixed trailing `Other` pseudo-row that
 * opens an inline editor for custom text, or the editor alone for an
 * optionless question. Tab/Shift-Tab move between questions, Enter answers
 * the active one and advances to the next unanswered question, and the
 * request resolves once every question is answered — dismissal (Escape) is
 * the only other way out. All keys are handled as raw sequences in
 * `handleInput`; no keymap actions are registered.
 *
 * @module @dsh-blue/blue-interaction/questionnaire
 */

import type { BlueComponents, BlueEditor, BlueFocusable, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import { oneLine } from './select-list.ts'

/** Decoded input sequences the questionnaire handles (no keymap actions). */
const KEY_TAB = '\t'
const KEY_SHIFT_TAB = '\x1b[Z'
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_ENTER = '\r'
const KEY_SPACE = ' '
const KEY_ESCAPE = '\x1b'

/** Inverse-video cursor block used by the compact input row. */
const CURSOR_BLOCK = '\x1b[7m \x1b[0m'

/**
 * Option rows rendered at once; longer lists truncate with an ellipsis row.
 * S12 sets the kimi value (6) so the framed dialog fits its overlay budget.
 */
const MAX_OPTION_ROWS = 6

/** Construction options for {@link Questionnaire}. */
export interface QuestionnaireOptions {
  /** Theme supplying the tab/question/highlight colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the custom-answer editor and width helpers. */
  readonly components: BlueComponents
  /** The questions to present, in tab order. */
  readonly questions: readonly AskUserQuestionItem[]
  /**
   * Called once every question carries an answer.
   * @param answers - the answers in question order.
   */
  readonly onComplete: (answers: AskUserQuestionAnswerItem[]) => void
  /** Called when the user dismisses the questionnaire (Escape). */
  readonly onCancel: () => void
}

/** Per-question scratch state: normalized options, list cursor, multi-select toggles, custom text, settled answer. */
interface QuestionState {
  /** The question's options normalized to an array (empty for free-text questions). */
  readonly options: readonly AskUserQuestionOption[]
  cursor: number
  readonly toggled: Set<string>
  custom: string | undefined
  draft: string
  answer: AskUserQuestionAnswerItem | undefined
}

/**
 * The tabbed questionnaire overlay. The presence of {@link editor} is the
 * editing state: it exists for the active optionless question, or while an
 * `Other` row is being answered with custom text. One draft is retained per
 * question while the user navigates.
 */
export class Questionnaire implements BlueFocusable {
  /** Whether the questionnaire currently holds focus. Managed by the screen. */
  private panelFocused = false

  private tab = 0
  private readonly states: QuestionState[]
  private editor: BlueEditor | undefined

  /**
   * @param options - see {@link QuestionnaireOptions}.
   */
  constructor(private readonly options: QuestionnaireOptions) {
    this.states = options.questions.map(question => ({
      options: question.options ?? [],
      cursor: 0,
      toggled: new Set(),
      custom: undefined,
      draft: '',
      answer: undefined,
    }))
    // An optionless question is edited directly, with no list to show.
    if (this.isOptionless(this.current())) this.openEditor()
  }

  get focused(): boolean {
    return this.panelFocused
  }

  set focused(value: boolean) {
    this.panelFocused = value
    if (this.editor !== undefined) this.editor.focused = value
  }

  /** The active question. */
  private current(): AskUserQuestionItem {
    const question = this.options.questions[this.tab]
    /* v8 ignore next -- tab is clamped to the question list on every mutation */
    if (question === undefined) throw new Error('questionnaire tab out of range')
    return question
  }

  /** The active question's scratch state. */
  private state(): QuestionState {
    const state = this.states[this.tab]
    /* v8 ignore next -- states are built alongside the question list */
    if (state === undefined) throw new Error('questionnaire tab out of range')
    return state
  }

  /** Whether a question is answered with free text only. */
  private isOptionless(question: AskUserQuestionItem): boolean {
    return (question.options ?? []).length === 0
  }

  /** Row count of the active question's list: the options plus `Other`. */
  private rowCount(state: QuestionState): number {
    return state.options.length + 1
  }

  /**
   * Dispatch one input sequence: editing mode forwards to the inline editor
   * (Escape dismisses, Tab/Shift-Tab leave the editor and switch tabs);
   * list mode navigates, toggles, confirms, or dismisses.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const editor = this.editor
    if (editor !== undefined) {
      if (data === KEY_ESCAPE) {
        if (this.isOptionless(this.current())) this.options.onCancel()
        else {
          this.saveEditorDraft()
          this.editor = undefined
        }
        return
      }
      if (data === KEY_TAB) {
        this.move(1)
        return
      }
      if (data === KEY_SHIFT_TAB) {
        this.move(-1)
        return
      }
      editor.handleInput?.(data)
      return
    }
    const question = this.current()
    const state = this.state()
    if (data === KEY_TAB) {
      this.move(1)
      return
    }
    if (data === KEY_SHIFT_TAB) {
      this.move(-1)
      return
    }
    if (data === KEY_UP) {
      state.cursor = state.cursor === 0 ? this.rowCount(state) - 1 : state.cursor - 1
      return
    }
    if (data === KEY_DOWN) {
      state.cursor = (state.cursor + 1) % this.rowCount(state)
      return
    }
    if (data === KEY_SPACE) {
      this.toggle(question, state)
      return
    }
    if (data === KEY_ENTER) {
      this.confirm(question, state)
      return
    }
    if (data === KEY_ESCAPE) this.options.onCancel()
  }

  /** Switch questions while retaining any unfinished editor draft. */
  private move(delta: number): void {
    this.saveEditorDraft()
    this.editor = undefined
    const count = this.options.questions.length
    this.tab = (this.tab + delta + count) % count
    if (this.isOptionless(this.current())) this.openEditor()
  }

  /** Toggle the focused option in a multi-select; no-op otherwise and on `Other`. */
  private toggle(question: AskUserQuestionItem, state: QuestionState): void {
    if (question.multiSelect !== true) return
    const option = state.options[state.cursor]
    if (option === undefined) return
    if (state.toggled.has(option.label)) state.toggled.delete(option.label)
    else state.toggled.add(option.label)
  }

  /** Confirm the focused row: an option answers the question, `Other` opens the editor. */
  private confirm(question: AskUserQuestionItem, state: QuestionState): void {
    const options = state.options
    if (state.cursor === options.length) {
      this.openEditor()
      return
    }
    if (question.multiSelect === true) {
      const selected = options.filter(option => state.toggled.has(option.label)).map(option => option.label)
      if (selected.length === 0) {
        // Nothing toggled: the focused option is the confirmation, matching
        // the retired BlueSelect fallback.
        const focused = options[state.cursor]
        /* v8 ignore next -- the cursor is clamped to the option rows here */
        if (focused === undefined) return
        selected.push(focused.label)
      }
      this.recordAnswer(state, {
        id: question.id,
        selected,
        ...state.custom === undefined ? {} : { custom: state.custom },
      })
      return
    }
    const chosen = options[state.cursor]
    /* v8 ignore next -- the cursor is clamped to the option rows here */
    if (chosen === undefined) return
    this.recordAnswer(state, {
      id: question.id,
      selected: [chosen.label],
    })
  }

  /** Open the inline editor for the active question's custom text. */
  private openEditor(): void {
    const question = this.current()
    const state = this.state()
    const editor = this.options.components.createEditor()
    // The editor clears its buffer before invoking onSubmit; the callback
    // argument already carries the paste-expanded, trimmed text.
    editor.onSubmit = (text) => {
      this.submitCustom(question, state, text)
    }
    if (state.draft.length > 0) editor.setText(state.draft)
    editor.focused = this.panelFocused
    this.editor = editor
  }

  /** Keep an unfinished answer when the user changes questions. */
  private saveEditorDraft(): void {
    if (this.editor !== undefined) this.state().draft = this.editor.getExpandedText()
  }

  /**
   * Take one editor submission: an optionless question is answered outright
   * (empty text answers without custom), while an `Other` submission stores
   * the custom text — answering immediately for a single-select, returning
   * to the list for a multi-select.
   */
  private submitCustom(question: AskUserQuestionItem, state: QuestionState, text: string): void {
    state.draft = text
    if (this.isOptionless(question)) {
      this.recordAnswer(state, {
        id: question.id,
        selected: [],
        ...text.length === 0 ? {} : { custom: text },
      })
      return
    }
    this.editor = undefined
    if (text.length === 0) return
    state.custom = text
    if (question.multiSelect === true) return
    this.recordAnswer(state, { id: question.id, selected: [], custom: text })
  }

  /** Record one answer and advance, completing once every question is answered. */
  private recordAnswer(state: QuestionState, answer: AskUserQuestionAnswerItem): void {
    state.answer = answer
    this.editor = undefined
    const next = this.states.findIndex(entry => entry.answer === undefined)
    if (next === -1) {
      const answers: AskUserQuestionAnswerItem[] = []
      for (const entry of this.states) {
        /* v8 ignore next -- completion fires only when every state answered */
        if (entry.answer === undefined) continue
        answers.push(entry.answer)
      }
      this.options.onComplete(answers)
      return
    }
    this.tab = next
    if (this.isOptionless(this.current())) this.openEditor()
  }

  /** Drop the editor's cached render state. */
  invalidate(): void {
    this.editor?.invalidate()
  }

  /**
   * Render the framed dialog: progress summary, active question, and its
   * list or compact editor, closed by a state-specific key row. Option lists
   * longer than {@link MAX_OPTION_ROWS} truncate the tail behind a muted
   * ellipsis row, and an option row budgets its description into the width
   * its label leaves (the select-list discipline, so no row exceeds the
   * viewport).
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const colors = this.options.theme.colors
    const components = this.options.components
    const question = this.current()
    const state = this.state()
    const progress = this.options.questions.map((entry, at) => {
      const label = entry.header ?? `Q${at + 1}`
      if (at === this.tab) return colors.primary(`● ${label}`)
      return this.states[at]?.answer === undefined
        ? colors.muted(`○ ${label}`)
        : colors.success(`✓ ${label}`)
    }).join('  ')
    const rows = [
      components.truncateToWidth(`  ${this.tab + 1}/${this.options.questions.length} · ${progress}`, width),
      '',
      colors.primary(components.truncateToWidth(`  ${question.question}`, width)),
    ]
    if (question.detail !== undefined) {
      rows.push(colors.muted(components.truncateToWidth(question.detail, width)))
    }
    const editor = this.editor
    if (editor !== undefined) {
      rows.push(this.renderEditorRow(editor, width))
      return framePanel(rows, width, {
        title: `Question ${this.tab + 1} of ${this.options.questions.length}`,
        titlePaint: colors.primary,
        rulePaint: colors.primary,
        footer: this.footerParts(),
        footerPaint: colors.textMuted,
      })
    }
    const options = state.options
    const multi = question.multiSelect === true
    const entries: string[] = []
    for (const [at, option] of options.entries()) {
      // The kimi dialog body indents every option row two columns.
      const prefix = at === state.cursor ? '  → ' : '    '
      const checkbox = multi ? (state.toggled.has(option.label) ? '[x] ' : '[ ] ') : ''
      const label = components.truncateToWidth(`${prefix}${checkbox}${option.label}`, width)
      // The description rides the label's leftover width (the select-list
      // budget discipline): one-lined, truncated to what remains, hidden
      // when fewer than five columns survive. Unbudgeted it overflowed
      // pi-tui's width guard and crashed the process (#14).
      const descriptionWidth = width - components.visibleWidth(label)
      const description = option.description !== undefined && descriptionWidth > 4
        ? colors.muted(components.truncateToWidth(` — ${oneLine(option.description)}`, descriptionWidth))
        : ''
      const row = at === state.cursor ? colors.primary(label) + description : label + description
      if (at === state.cursor) {
        const clipped = components.truncateToWidth(row, width)
        entries.push(colors.selectedBg(clipped + ' '.repeat(Math.max(0, width - components.visibleWidth(clipped)))))
      } else {
        entries.push(row)
      }
    }
    const otherPrefix = state.cursor === options.length ? '  → ' : '    '
    const otherLabel = state.custom === undefined ? 'Other' : `Other: ${state.custom}`
    const other = components.truncateToWidth(`${otherPrefix}${otherLabel}`, width)
    if (state.cursor === options.length) {
      const clipped = components.truncateToWidth(colors.primary(other), width)
      entries.push(colors.selectedBg(clipped + ' '.repeat(Math.max(0, width - components.visibleWidth(clipped)))))
    } else {
      entries.push(other)
    }
    if (entries.length > MAX_OPTION_ROWS) {
      rows.push(...entries.slice(0, MAX_OPTION_ROWS), colors.muted('…'))
    } else {
      rows.push(...entries)
    }
    rows.push('')
    return framePanel(rows, width, {
      title: `Question ${this.tab + 1} of ${this.options.questions.length}`,
      titlePaint: colors.primary,
      rulePaint: colors.primary,
      footer: this.footerParts(),
      footerPaint: colors.textMuted,
    })
  }

  /** Footer key-row parts for the framed dialog. */
  private footerParts(): string[] {
    if (this.editor !== undefined) {
      return this.isOptionless(this.current())
        ? ['↵ save', 'tab next', 'esc cancel']
        : ['↵ save', 'tab next', 'esc back']
    }
    return this.current().multiSelect === true
      ? ['↑↓ select', 'space toggle', '↵ choose', 'tab next', 'esc cancel']
      : ['↑↓ select', '↵ choose', 'tab next', 'esc cancel']
  }

  /** Render free text with the same compact field treatment as FormPanel. */
  private renderEditorRow(editor: BlueEditor, width: number): string {
    const colors = this.options.theme.colors
    const components = this.options.components
    const contentWidth = Math.max(1, width - 4)
    const valueWidth = Math.max(1, contentWidth - 12)
    const value = components.truncateToWidth(
      editor.getExpandedText().replace(/[\r\n]+/g, ' '),
      Math.max(1, valueWidth - 1),
    )
    const cursor = this.panelFocused ? CURSOR_BLOCK : ''
    const row = `  ${colors.primary('>')} ${colors.accent('Answer')}   ${colors.text(value)}${cursor}`
    const clipped = components.truncateToWidth(row, contentWidth)
    return colors.selectedBg(clipped + ' '.repeat(Math.max(0, contentWidth - components.visibleWidth(clipped))))
  }
}
