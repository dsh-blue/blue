/**
 * `PlanReviewPanel`: the dedicated presentation for a `plan-review`
 * user question (S24b) — dsh-plan-mode's `exit_plan_mode` ask, in the
 * kimi approval shape (dogfood round 2): the plan markdown (the
 * question's `detail`) rendered through `ctx.blueComponents
 * .createMarkdown` inside a bordered `plan` box (the btw pane's box
 * idiom: titled top rule, side bars, closing rule), and beneath it the
 * numbered decision list with the inline revision input on the third
 * row — kimi's `3. Revise  <text>`:
 *
 * - **1. Approve** — the option named by `question.intent.approve`
 *   (never a hardcoded label); answers `{selected: [approve]}` and the
 *   harness exits plan mode.
 * - **2. Reject** — answers with the other option's label: the model
 *   hears "the user chose to keep planning" and reacts in the same turn.
 * - **3. Revise** — the row carries the feedback input: typed text
 *   submits `{selected: [], custom}` (the decline-with-feedback the
 *   harness folds into "their feedback: …"), an empty submission
 *   declines plainly. The text rides on the row itself (the FormPanel
 *   discipline: a real editor owns the keys, the row derives from the
 *   tracked text), with `Type feedback · ↵ submit.` beneath while
 *   focused.
 *
 * ↑/↓ move the cursor (wraparound), the digit keys jump-and-fire (3
 * focuses the input), Enter fires the focused row (on Revise it submits
 * the input), PageUp/PageDown scroll the plan box, Escape dismisses the
 * ask (the `ASK_CANCELLED` path — the turn stops, plan mode stays, the
 * model waits for the user's next message). Answer encoding stays the
 * generic single-select protocol (the intent changes presentation
 * only). All keys are raw sequences, matching the questionnaire and
 * approval panels (blue-questions injects no keymap).
 *
 * @module @dsh-blue/blue-interaction/plan-review-panel
 */

import type { BlueComponents, BlueEditor, BlueFocusable, BlueMarkdown, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel, topRule } from '@dsh-blue/blue-core/chrome'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import { cycle } from './select-list.ts'

/** Decoded input sequences the panel handles (no keymap actions). */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_LEFT = '\x1b[D'
const KEY_RIGHT = '\x1b[C'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const KEY_ENTER = '\r'
const KEY_ESCAPE = '\x1b'

/**
 * The panel chrome the plan window yields to: frame title + bottom rule,
 * the box's two borders, the blank rule, three list rows, the revise
 * hint, and the two-row footer shell below the panel. The window fills
 * the remaining height (the dogfood round-3 ruling: the plan is the
 * thing to read).
 */
const RESERVED_ROWS = 11

/** The smallest plan window a very short terminal still gets. */
const MIN_PLAN_ROWS = 6

/** The trailing cursor block on the revision row while it holds focus (FormPanel). */
const CURSOR_BLOCK = '\u001b[7m \u001b[0m'

/** The revise row's hint beneath the list while it holds focus (kimi copy). */
const REVISE_HINT = 'Type feedback · ↵ submit.'

/** The fixed labels of the two Blue-owned rows (the approve label comes from the intent). */
const REJECT_LABEL = 'Reject'
const REVISE_LABEL = 'Revise'

/** The three decision rows, in list order. */
type DecisionId = 'approve' | 'reject'

/**
 * The two decision options of a plan-review question: the approving
 * option first, the declining option second.
 */
export interface PlanReviewChoices {
  /** The option whose label equals `intent.approve`. */
  readonly approve: AskUserQuestionOption
  /** The other option (the reject answer's label). */
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
  /** Component factory supplying the markdown renderer and the revision editor. */
  readonly components: BlueComponents
  /** The plan-review question (its `detail` is the plan markdown). */
  readonly question: AskUserQuestionItem
  /** The decision pair (from {@link planReviewChoices}). */
  readonly choices: PlanReviewChoices
  /** The plan-review question's live viewport height, in rows. */
  readonly viewportRows: () => number
  /** Firing Approve or Reject, or submitting the revision input. */
  readonly onComplete: (answer: AskUserQuestionAnswerItem) => void
  /** Escape — dismiss the ask to speak instead. */
  readonly onCancel: () => void
}

/**
 * The plan-review decision panel: the bordered plan box above the
 * numbered decision list with the inline revision input.
 */
export class PlanReviewPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0
  private scrollTop = 0
  private revision = ''
  private readonly markdown: BlueMarkdown
  private readonly editor: BlueEditor
  private readonly title: string
  private readonly labels: readonly [string, string, string]

  /**
   * @param options - see {@link PlanReviewPanelOptions}.
   */
  constructor(private readonly options: PlanReviewPanelOptions) {
    // No markdown padding: the box's own `│ ` inset is the content gutter
    // (paddingX here double-indents inside the box).
    this.markdown = options.components.createMarkdown({ text: options.question.detail ?? '' })
    this.title = options.question.header ?? 'Plan review'
    this.labels = [options.choices.approve.label, REJECT_LABEL, REVISE_LABEL]
    // The revision row's input: a real editor owns the keys, the row
    // derives from the tracked text (the FormPanel discipline).
    this.editor = options.components.createEditor()
    this.editor.onChange = text => {
      this.revision = text
    }
    this.editor.onSubmit = text => {
      if (text.length === 0) {
        this.options.onComplete({ id: this.options.question.id, selected: [this.options.choices.decline.label] })
        return
      }
      this.options.onComplete({ id: this.options.question.id, selected: [], custom: text })
    }
  }

  /** The plan window's row budget: the viewport minus the panel chrome. */
  private planWindowRows(): number {
    return Math.max(MIN_PLAN_ROWS, this.options.viewportRows() - RESERVED_ROWS)
  }

  /**
   * Dispatch one input sequence: ↑/↓ scroll the plan box line-by-line —
   * the mouse wheel arrives as those arrows while no mouse reporting is
   * on, so the wheel scrolls the plan (the round-4 ruling) — ←/→ move
   * the cursor, the digits jump (and fire, except 3 which focuses the
   * input), Enter fires the focused row (on Revise it submits the
   * input), PageUp/PageDown page the plan box, Escape dismisses;
   * anything else feeds the revision input while it holds focus.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    if (data === KEY_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - 1)
      return
    }
    if (data === KEY_DOWN) {
      this.scrollTop += 1 // render clamps
      return
    }
    if (data === KEY_LEFT) {
      this.cursor = cycle(this.cursor, this.labels.length, -1)
      return
    }
    if (data === KEY_RIGHT) {
      this.cursor = cycle(this.cursor, this.labels.length, 1)
      return
    }
    // The digit keys jump-and-fire from the list; while the revision
    // input holds focus they type (kimi: feedback mode owns the keys).
    if (this.cursor !== 2) {
      if (data === '1') {
        this.fire('approve')
        return
      }
      if (data === '2') {
        this.fire('reject')
        return
      }
      if (data === '3') {
        this.cursor = 2
        return
      }
    }
    if (data === KEY_PAGE_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - this.planWindowRows())
      return
    }
    if (data === KEY_PAGE_DOWN) {
      this.scrollTop += this.planWindowRows() // render clamps
      return
    }
    if (data === KEY_ESCAPE) {
      this.options.onCancel()
      return
    }
    if (this.cursor === 2) {
      // The revision row owns the remaining keys — Enter included: the
      // editor's own submit path answers with (or without) the feedback.
      this.editor.handleInput?.(data)
      return
    }
    if (data === KEY_ENTER) this.fire(this.cursor === 0 ? 'approve' : 'reject')
  }

  /** Drop the markdown's and editor's cached render state. */
  invalidate(): void {
    this.markdown.invalidate()
    this.editor.invalidate()
  }

  /**
   * Render the framed dialog: the question, the bordered plan box (a
   * `showing X-Y of Z` tail inside it when the plan overflows), a blank
   * rule, the numbered decision list with the inline revision input, and
   * the revision hint while that row holds focus.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { theme, components } = this.options
    const colors = theme.colors
    // No question row: the frame title names the panel and the plan is
    // the content — the ask's wording read redundant (round-5 ruling).
    const rows: string[] = []
    rows.push(...this.renderPlanBox(width))
    rows.push('')
    for (let index = 0; index < this.labels.length; index += 1) {
      const focused = index === this.cursor
      const pointer = focused ? colors.primary('▶ ') : '  '
      const label = `${index + 1}. ${this.labels[index]}`
      if (index === 2) {
        // The revision row carries the tracked input text inline, with
        // the cursor block while it holds focus.
        const inline = components.truncateToWidth(
          `${label}  ${this.revision.replace(/[\r\n]+/g, ' ')}`,
          Math.max(1, width - 4),
        )
        const block = focused ? CURSOR_BLOCK : ''
        rows.push(components.truncateToWidth(`  ${pointer}${colors.text(inline)}${block}`, width))
        continue
      }
      const painted = focused ? colors.primary(label) : colors.text(label)
      rows.push(components.truncateToWidth(`  ${pointer}${painted}`, width))
    }
    if (this.cursor === 2) {
      rows.push(colors.muted(components.truncateToWidth(`  ${REVISE_HINT}`, width)))
    }
    return framePanel(rows, width, {
      title: this.title,
      titlePaint: colors.primary,
      titleHint: '· ←→/1-3 choose · ↑↓ scroll · esc dismiss',
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }

  /** The bordered plan box: titled top rule, windowed markdown rows, closing rule. */
  private renderPlanBox(width: number): string[] {
    const { theme, components } = this.options
    const colors = theme.colors
    const boxWidth = Math.max(4, width - 4)
    const contentWidth = boxWidth - 4
    const plan = this.markdown.render(contentWidth)
    const maxRows = this.planWindowRows()
    const lines: string[] = [topRule(boxWidth, {
      // No box title: the frame title already says Plan review — a second
      // `plan` label reads redundant (the round-4 ruling); only the
      // scroll hint rides the border while the plan overflows.
      ...(plan.length > maxRows ? { hint: colors.textMuted('↑↓ scroll') } : {}),
      paint: colors.border,
    })]
    const windowed = plan.length > maxRows
    if (windowed) this.scrollTop = Math.max(0, Math.min(this.scrollTop, plan.length - maxRows))
    const slice = windowed
      ? plan.slice(this.scrollTop, this.scrollTop + maxRows)
      : plan
    for (const line of slice) {
      const clipped = components.truncateToWidth(line, contentWidth, '…')
      const padding = Math.max(0, contentWidth - components.visibleWidth(clipped))
      lines.push(colors.border('│') + ' ' + clipped + ' '.repeat(padding) + ' ' + colors.border('│'))
    }
    if (windowed) {
      const tail = components.truncateToWidth(
        `showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + slice.length)} of ${String(plan.length)}`,
        contentWidth,
        '…',
      )
      const tailPadding = Math.max(0, contentWidth - components.visibleWidth(tail))
      lines.push(colors.border('│') + ' ' + colors.textMuted(tail) + ' '.repeat(tailPadding) + ' ' + colors.border('│'))
    }
    lines.push(colors.border('╰') + colors.border('─'.repeat(Math.max(0, boxWidth - 2))) + colors.border('╯'))
    return lines
  }

  /** Fire one of the answering rows (digit keys and Enter on rows 1-2). */
  private fire(id: DecisionId): void {
    const { question, choices } = this.options
    if (id === 'approve') {
      this.options.onComplete({ id: question.id, selected: [choices.approve.label] })
      return
    }
    this.options.onComplete({ id: question.id, selected: [choices.decline.label] })
  }
}
