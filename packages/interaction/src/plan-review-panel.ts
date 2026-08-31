/**
 * Canonical plan-review controller. Harness answer encoding, decision keys,
 * revision state, and plan-window navigation remain product state; core owns
 * all rows, chrome, focus markers, wrapping, semantic paint, and width math.
 *
 * @module @dsh-blue/blue-interaction/plan-review-panel
 */

import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueTheme } from '@dsh-blue/blue-core'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem, AskUserQuestionOption } from '@deepseek-ai/dsh-user-questions'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
const RESERVED_ROWS = 14
const MIN_PLAN_ROWS = 6
const REJECT_LABEL = 'Reject'
const REVISE_LABEL = 'Revise'
const PLAN_LEAF_PATH = '$.child.0.scroll.0'

type DecisionId = 'approve' | 'reject'

/** The approving option and its one declining peer. */
export interface PlanReviewChoices {
  readonly approve: AskUserQuestionOption
  readonly decline: AskUserQuestionOption
}

/** Extract a valid plan-review choice pair. */
export function planReviewChoices(question: AskUserQuestionItem): PlanReviewChoices | undefined {
  const intent = question.intent
  if (intent?.kind !== 'plan-review') return undefined
  const options = question.options ?? []
  if (options.length !== 2) return undefined
  const approve = options.find(option => option.label === intent.approve)
  if (approve === undefined) return undefined
  const decline = options[options[0] === approve ? 1 : 0]!
  return { approve, decline }
}

/** Construction options for {@link PlanReviewPanel}. */
export interface PlanReviewPanelOptions {
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly question: AskUserQuestionItem
  readonly choices: PlanReviewChoices
  readonly viewportRows: () => number
  readonly onComplete: (answer: AskUserQuestionAnswerItem) => void
  readonly onCancel: () => void
}

/** Canonical plan-review decision controller. */
export class PlanReviewPanel implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private cursor = 0
  private scrollTop = 0
  private revision = ''
  private editing = false
  private planRows: number
  private planLimit: number
  private readonly labels: readonly [string, string, string]

  constructor(private readonly options: PlanReviewPanelOptions) {
    this.planRows = (options.question.detail ?? '').split('\n').length
    this.planLimit = this.planWindowRows()
    this.labels = [options.choices.approve.label, REJECT_LABEL, REVISE_LABEL]
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onFocusChange: identity => this.syncCursor(identity.controlId, identity.itemId),
      onUnhandledEscape: options.onCancel,
      maxLeafRows: () => this.planWindowRows(),
      leafRowWindowPath: PLAN_LEAF_PATH,
      markdownLeafPath: PLAN_LEAF_PATH,
      leafRowOffset: () => this.scrollTop,
      onLeafRowOffset: (offset, totalRows, limit) => {
        const changed = offset !== this.scrollTop || totalRows !== this.planRows || limit !== this.planLimit
        this.scrollTop = offset
        this.planRows = totalRows
        this.planLimit = limit
        if (changed) this.adapter.invalidate()
      },
      onTextSubmit: (_controlId, value) => this.submitRevision(value),
      fallbackFocusIdentity: () => this.editing ? { controlId: 'revision' } : undefined,
      startEditing: () => this.editing,
      contextHints: () => this.editing
        ? [
            { id: 'feedback', keys: 'Type', label: 'feedback', priority: 90 },
          ]
        : [
            { id: 'digits', keys: '1-3', label: 'choose', priority: 95 },
          ],
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  private planWindowRows(): number { return Math.max(MIN_PLAN_ROWS, this.options.viewportRows() - RESERVED_ROWS) }

  /** Preserve direct decision shortcuts; core owns focus and scrolling. */
  handleInput(data: string): void {
    if (!this.editing && data === '1') { this.fire('approve'); return }
    if (!this.editing && data === '2') { this.fire('reject'); return }
    if (!this.editing && data === '3') { this.enterRevision(); return }
    this.adapter.handleInput(data)
    if (this.editing && data === '\x1b') this.editing = false
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current renderer-neutral plan-review tree. */
  currentNode(): BlueUiNode {
    const planTail = this.planRows > this.planLimit
      ? [{ node: { kind: 'text', content: `showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + Math.min(this.planLimit, this.planRows - this.scrollTop))}/${String(this.planRows)}`, tone: 'muted' } as const }]
      : []
    const children: BlueUiNode[] = [
      {
        kind: 'scroll',
        child: {
          kind: 'stack', direction: 'column', children: [
            { node: { kind: 'text', content: this.options.question.detail ?? '' } },
            ...planTail,
          ],
        },
      },
      {
        kind: 'list',
        id: 'plan-review-decisions',
        selectedIds: [String(this.cursor)],
        items: this.labels.map((label, index) => ({ id: String(index), label, badge: String(index + 1) })),
      },
    ]
    if (this.cursor === 2) {
      children.push({ kind: 'form', id: 'plan-review-revision', fields: [{ kind: 'input', id: 'revision', label: 'Revise', value: this.revision }] })
    }
    return {
      kind: 'surface',
      chrome: 'overlay',
      title: this.options.question.header ?? 'Plan review',
      child: { kind: 'stack', direction: 'column', gap: 1, children: children.map(node => ({ node })) },
    }
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind === 'value-change' && event.controlId === 'revision' && typeof event.value === 'string') {
      this.revision = event.value
      return
    }
    if (event.kind === 'selection-change' && event.controlId === 'plan-review-decisions' && typeof event.value === 'string') {
      const index = Number(event.value)
      if (index === 0) this.fire('approve')
      else if (index === 1) this.fire('reject')
      else if (index === 2) this.enterRevision()
    }
  }

  private enterRevision(): void {
    this.cursor = 2
    this.editing = true
    this.adapter.focus({ controlId: 'revision' })
  }

  private syncCursor(controlId: string, itemId: string | undefined): void {
    if (controlId !== 'plan-review-decisions' || itemId === undefined) return
    const index = Number(itemId)
    if (!Number.isInteger(index) || index < 0 || index >= this.labels.length || index === this.cursor) return
    this.cursor = index
    this.adapter.invalidate()
  }

  private submitRevision(value: string): void {
    this.revision = value
    this.editing = false
    if (value.length === 0) this.fire('reject')
    else this.options.onComplete({ id: this.options.question.id, selected: [], custom: value })
  }

  private fire(id: DecisionId): void {
    const { question, choices } = this.options
    this.options.onComplete({ id: question.id, selected: [id === 'approve' ? choices.approve.label : choices.decline.label] })
  }
}
