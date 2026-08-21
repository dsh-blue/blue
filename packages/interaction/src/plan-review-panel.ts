/**
 * `PlanReviewPanel`: the dedicated presentation for a `plan-review`
 * user question (S24b) — dsh-plan-mode's `exit_plan_mode` ask. The plan
 * markdown (the question's `detail`) renders through
 * `ctx.blueComponents.createMarkdown` inside a scroll window; below it
 * the two decision rows: the approving option (named by
 * `question.intent.approve` — never a hardcoded label) and the other
 * option. Enter approves from the first row; Enter on the other row
 * swaps the rows for an inline feedback editor (the kimi Revise shape)
 * whose submission declines — empty text as the plain decline, typed
 * text as the decline-with-feedback the harness folds into "their
 * feedback: …". Escape from the editor returns to the rows; Escape
 * from the rows dismisses the ask. Answer encoding is the generic
 * single-select protocol (the intent changes presentation only). All
 * keys are raw sequences, matching the questionnaire and approval
 * panels (blue-questions injects no keymap).
 *
 * @module @dsh-blue/blue-interaction/plan-review-panel
 */

import type { BlueComponents, BlueEditor, BlueFocusable, BlueMarkdown, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import { cycle } from './select-list.ts'

/** Decoded input sequences the panel handles (no keymap actions). */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const KEY_ENTER = '\r'
const KEY_ESCAPE = '\x1b'

/** Plan rows rendered at once; longer plans scroll (the help window's budget). */
const MAX_PLAN_ROWS = 10

/** Rows one page jump moves (the help overlay's page size). */
const PAGE_SCROLL = 10

/**
 * The two decision rows of a plan-review question: the approving option
 * first, the declining option second.
 */
export interface PlanReviewChoices {
  /** The option whose label equals `intent.approve`. */
  readonly approve: AskUserQuestionOption
  /** The other option (the decline path). */
  readonly decline: AskUserQuestionOption
}

/**
 * Extract the decision pair from a plan-review question, or `undefined`
 * when the options do not carry exactly the approving option plus one
 * other (malformed asks fall back to the generic questionnaire).
 * @param question - the question carrying the `plan-review` intent.
 */
export function planReviewChoices(question: AskUserQuestionItem): PlanReviewChoices | undefined {
  const intent = question.intent
  if (intent?.kind !== 'plan-review') return undefined
  const options = question.options ?? []
  if (options.length !== 2) return undefined
  const approve = options.find(option => option.label === intent.approve)
  if (approve === undefined) return undefined
  const decline = options.find(option => option !== approve)
  /* v8 ignore next -- with two options and the approving one found, the
     other always exists */
  if (decline === undefined) return undefined
  return { approve, decline }
}

/** Construction options for {@link PlanReviewPanel}. */
export interface PlanReviewPanelOptions {
  /** Theme supplying the plan, choice, and rule colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the markdown and feedback editor. */
  readonly components: BlueComponents
  /** The plan-review question (its `detail` is the plan markdown). */
  readonly question: AskUserQuestionItem
  /** The decision pair (from {@link planReviewChoices}). */
  readonly choices: PlanReviewChoices
  /** Enter on the approving row, or a feedback submission. */
  readonly onComplete: (answer: AskUserQuestionAnswerItem) => void
  /** Escape from the choice rows. */
  readonly onCancel: () => void
}

/**
 * The plan-review decision panel: a scrollable markdown plan above the
 * two decision rows, or the feedback editor while the decline row is
 * being answered.
 */
export class PlanReviewPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0
  private scrollTop = 0
  private editor: BlueEditor | undefined
  private readonly markdown: BlueMarkdown
  private readonly title: string

  /**
   * @param options - see {@link PlanReviewPanelOptions}.
   */
  constructor(private readonly options: PlanReviewPanelOptions) {
    this.markdown = options.components.createMarkdown({
      text: options.question.detail ?? '',
      paddingX: 2,
    })
    this.title = options.question.header ?? 'Plan review'
  }

  /**
   * Dispatch one input sequence: editing mode forwards to the feedback
   * editor (Escape returns to the rows); row mode moves the cursor,
   * scrolls the plan window, decides, or dismisses.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const editor = this.editor
    if (editor !== undefined) {
      if (data === KEY_ESCAPE) {
        this.editor = undefined
        return
      }
      editor.handleInput?.(data)
      return
    }
    if (data === KEY_UP) {
      this.cursor = cycle(this.cursor, 2, -1)
      return
    }
    if (data === KEY_DOWN) {
      this.cursor = cycle(this.cursor, 2, 1)
      return
    }
    if (data === KEY_PAGE_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - PAGE_SCROLL)
      return
    }
    if (data === KEY_PAGE_DOWN) {
      this.scrollTop += PAGE_SCROLL // render clamps
      return
    }
    if (data === KEY_ENTER) {
      if (this.cursor === 0) {
        this.options.onComplete({ id: this.options.question.id, selected: [this.options.choices.approve.label] })
        return
      }
      this.openFeedback()
      return
    }
    if (data === KEY_ESCAPE) this.options.onCancel()
  }

  /** Drop the markdown's and editor's cached render state. */
  invalidate(): void {
    this.markdown.invalidate()
    this.editor?.invalidate()
  }

  /**
   * Render the framed dialog: the question, the scrolled plan window
   * (a `showing X-Y of Z` tail when it overflows), a blank rule, and
   * the two decision rows — or the feedback editor while it is open.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { theme, components, question, choices } = this.options
    const colors = theme.colors
    const rows: string[] = [
      colors.primary(components.truncateToWidth(`  ${question.question}`, width)),
    ]
    const plan = this.markdown.render(width)
    if (plan.length > MAX_PLAN_ROWS) {
      this.scrollTop = Math.max(0, Math.min(this.scrollTop, plan.length - MAX_PLAN_ROWS))
      const slice = plan.slice(this.scrollTop, this.scrollTop + MAX_PLAN_ROWS)
      rows.push(...slice)
      rows.push(colors.textMuted(components.truncateToWidth(
        ` showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + slice.length)} of ${String(plan.length)}`,
        width,
      )))
    } else {
      this.scrollTop = 0
      rows.push(...plan)
    }
    rows.push('')
    const editor = this.editor
    if (editor !== undefined) {
      rows.push(...editor.render(width))
      return framePanel(rows, width, {
        title: this.title,
        titlePaint: colors.primary,
        titleHint: '· ↵ send feedback · esc back',
        hintPaint: colors.textMuted,
        rulePaint: colors.primary,
      })
    }
    const entries = [choices.approve, choices.decline].map((option, at) => {
      const prefix = at === this.cursor ? '  → ' : '    '
      const label = components.truncateToWidth(`${prefix}${option.label}`, width)
      const description = option.description === undefined ? '' : colors.muted(` — ${option.description}`)
      return at === this.cursor ? colors.primary(label) + description : label + description
    })
    rows.push(...entries)
    return framePanel(rows, width, {
      title: this.title,
      titlePaint: colors.primary,
      titleHint: '· ↑↓ choose · pgup/pgdn scroll · ↵ decide · esc dismiss',
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }

  /** Open the inline feedback editor for the decline row. */
  private openFeedback(): void {
    const editor = this.options.components.createEditor()
    // The editor clears its buffer before invoking onSubmit; the text
    // arrives trimmed. Empty text declines without feedback.
    editor.onSubmit = (text) => {
      if (text.length === 0) {
        this.options.onComplete({ id: this.options.question.id, selected: [this.options.choices.decline.label] })
        return
      }
      this.options.onComplete({ id: this.options.question.id, selected: [], custom: text })
    }
    this.editor = editor
  }
}
