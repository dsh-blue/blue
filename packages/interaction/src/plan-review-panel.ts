/**
 * `PlanReviewPanel`: the dedicated presentation for a `plan-review`
 * user question (S24b) — dsh-plan-mode's `exit_plan_mode` ask. The plan
 * markdown (the question's `detail`) renders through
 * `ctx.blueComponents.createMarkdown` inside a scroll window; below it a
 * horizontal three-button row (the shared kimi segment chrome from
 * `thinking-segments.ts`) decides the review:
 *
 * - **Approve** — the option named by `question.intent.approve` (never a
 *   hardcoded label); Enter answers `{selected: [approve]}` and the
 *   harness exits plan mode.
 * - **Reject** — answers with the other option's label: the model hears
 *   "the user chose to keep planning" and reacts in the same turn.
 * - **Revise in chat** — dismisses the ask (the `ASK_CANCELLED` path):
 *   the turn stops, plan mode stays, and the model waits for the user's
 *   next message — the user drives the re-plan by talking (the S24b
 *   dogfood ruling retired the inline feedback editor: an editor inside
 *   the pane read poorly, and the dismissal channel already carries the
 *   semantics). Escape is the same action.
 *
 * ←/→/↑/↓ move the button focus, Enter activates, PgUp/PgDn scroll the
 * plan. Answer encoding stays the generic single-select protocol (the
 * intent changes presentation only). All keys are raw sequences,
 * matching the questionnaire and approval panels (blue-questions
 * injects no keymap).
 *
 * @module @dsh-blue/blue-interaction/plan-review-panel
 */

import type { BlueComponents, BlueFocusable, BlueMarkdown, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import { cycle } from './select-list.ts'
import { renderSegments } from './thinking-segments.ts'

/** Decoded input sequences the panel handles (no keymap actions). */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_LEFT = '\x1b[D'
const KEY_RIGHT = '\x1b[C'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const KEY_ENTER = '\r'
const KEY_ESCAPE = '\x1b'

/** Plan rows rendered at once; longer plans scroll (the help window's budget). */
const MAX_PLAN_ROWS = 10

/** Rows one page jump moves (the help overlay's page size). */
const PAGE_SCROLL = 10

/** The third button's fixed copy: the dismissal path in user terms. */
const REVISE_LABEL = 'Revise in chat'
const REVISE_DESCRIPTION = 'stay in plan mode and type the changes in chat'

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
  /** Theme supplying the plan, button, and rule colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the markdown renderer. */
  readonly components: BlueComponents
  /** The plan-review question (its `detail` is the plan markdown). */
  readonly question: AskUserQuestionItem
  /** The decision pair (from {@link planReviewChoices}). */
  readonly choices: PlanReviewChoices
  /** Enter on Approve or Reject. */
  readonly onComplete: (answer: AskUserQuestionAnswerItem) => void
  /** Enter on Revise in chat, or Escape. */
  readonly onCancel: () => void
}

/** One decision button: the segment shape plus the focused-button description. */
interface DecisionButton {
  readonly id: 'approve' | 'reject' | 'revise'
  readonly label: string
  readonly description: string | undefined
}

/**
 * The plan-review decision panel: a scrollable markdown plan above the
 * three-button decision row.
 */
export class PlanReviewPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0
  private scrollTop = 0
  private readonly markdown: BlueMarkdown
  private readonly title: string
  private readonly buttons: readonly DecisionButton[]

  /**
   * @param options - see {@link PlanReviewPanelOptions}.
   */
  constructor(private readonly options: PlanReviewPanelOptions) {
    this.markdown = options.components.createMarkdown({
      text: options.question.detail ?? '',
      paddingX: 2,
    })
    this.title = options.question.header ?? 'Plan review'
    const { approve, decline } = options.choices
    this.buttons = [
      { id: 'approve', label: approve.label, description: approve.description },
      { id: 'reject', label: 'Reject', description: decline.description },
      { id: 'revise', label: REVISE_LABEL, description: REVISE_DESCRIPTION },
    ]
  }

  /**
   * Dispatch one input sequence: the arrows move the button focus,
   * PageUp/PageDown scroll the plan window, Enter activates the focused
   * button, Escape revises in chat.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    if (data === KEY_UP || data === KEY_LEFT) {
      this.cursor = cycle(this.cursor, this.buttons.length, -1)
      return
    }
    if (data === KEY_DOWN || data === KEY_RIGHT) {
      this.cursor = cycle(this.cursor, this.buttons.length, 1)
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
      this.activate()
      return
    }
    if (data === KEY_ESCAPE) this.options.onCancel()
  }

  /** Drop the markdown's cached render state. */
  invalidate(): void {
    this.markdown.invalidate()
  }

  /**
   * Render the framed dialog: the question, the scrolled plan window
   * (a `showing X-Y of Z` tail when it overflows), a blank rule, the
   * three-button segment row, and the focused button's description.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { theme, components, question } = this.options
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
    rows.push(components.truncateToWidth(
      `  ${renderSegments(this.buttons, this.cursor, theme)}`,
      Math.max(width, 1),
    ))
    const focused = this.buttons[this.cursor]
    if (focused?.description !== undefined) {
      rows.push(colors.muted(components.truncateToWidth(`  — ${focused.description}`, width)))
    }
    return framePanel(rows, width, {
      title: this.title,
      titlePaint: colors.primary,
      titleHint: '· ←→ decide · pgup/pgdn scroll · esc revise in chat',
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }

  /** Run the focused button: approve and reject answer, revise dismisses. */
  private activate(): void {
    const button = this.buttons[this.cursor]
    /* v8 ignore next -- the cursor is cycle-bounded to the button row */
    if (button === undefined) return
    const { question, choices } = this.options
    if (button.id === 'approve') {
      this.options.onComplete({ id: question.id, selected: [choices.approve.label] })
      return
    }
    if (button.id === 'reject') {
      this.options.onComplete({ id: question.id, selected: [choices.decline.label] })
      return
    }
    this.options.onCancel()
  }
}
