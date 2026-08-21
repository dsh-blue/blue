/**
 * Unit tests for the plan-review decision panel: choice-pair extraction
 * from the intent, the bordered plan box with its scroll window, the
 * numbered decision list with the inline revision input, digit
 * direct-fire, and dismissal — over the fake theme/components.
 */

import { describe, expect, it, vi } from 'vitest'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { PlanReviewPanel, planReviewChoices } from '../src/plan-review-panel.ts'
import { FakeBlueComponents, FakeTheme, KEY } from './fakes.ts'

/** The plan-review ask, with a non-standard approve label (never hardcoded). */
function ask(overrides: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
  return {
    id: 'plan-review',
    header: 'Plan review',
    question: 'Approve this plan and leave plan mode?',
    detail: '# Fix the build\n\n1. One\n2. Two',
    options: [
      { label: 'Ship it', description: 'Leave plan mode; carry out the plan.' },
      { label: 'Keep planning', description: 'Stay in plan mode; refine first.' },
    ],
    intent: { kind: 'plan-review', approve: 'Ship it' },
    ...overrides,
  }
}

/** A 15-line plan body, beyond the 10-row window. */
const LONG_DETAIL = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join('\n')

function mount(question: AskUserQuestionItem, viewportRows = 24): {
  panel: PlanReviewPanel
  onComplete: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onComplete = vi.fn()
  const onCancel = vi.fn()
  const choices = planReviewChoices(question)
  if (choices === undefined) throw new Error('test ask has no choice pair')
  const panel = new PlanReviewPanel({
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    question,
    choices,
    viewportRows: () => viewportRows,
    onComplete,
    onCancel,
  })
  return { panel, onComplete, onCancel }
}

describe('planReviewChoices', () => {
  it('pairs the intent-named approving option with the other', () => {
    const { approve, decline } = planReviewChoices(ask())!
    expect(approve.label).toBe('Ship it')
    expect(decline.label).toBe('Keep planning')
  })

  it('rejects asks without the intent or with a malformed pair', () => {
    const { intent, ...withoutIntent } = ask()
    void intent
    expect(planReviewChoices(withoutIntent as AskUserQuestionItem)).toBeUndefined()
    expect(planReviewChoices(ask({ intent: { kind: 'plan-review', approve: 'Missing' } }))).toBeUndefined()
    const { options, ...optionless } = ask()
    void options
    expect(planReviewChoices(optionless as AskUserQuestionItem)).toBeUndefined()
    expect(planReviewChoices(ask({
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      intent: { kind: 'plan-review', approve: 'A' },
    }))).toBeUndefined()
    // A future intent kind falls back to the generic questionnaire.
    const future = ask({ intent: { kind: 'future-kind' } as AskUserQuestionItem['intent'] })
    expect(planReviewChoices(future)).toBeUndefined()
  })
})

describe('PlanReviewPanel rendering', () => {
  it('frames the question, the bordered plan box, and the numbered list', () => {
    const { panel } = mount(ask())
    const frame = panel.render(60).join('\n')
    expect(frame).toContain('Plan review')
    // No question row: the frame title names the panel (round-5 ruling).
    expect(frame).not.toContain('Approve this plan and leave plan mode?')
    // The plan box: a plain top rule (no title — the frame title already
    // says Plan review), the markdown body at the box's own inset, the
    // closing rule (the btw pane's box idiom).
    expect(frame).toContain('│ # Fix the build')
    expect(frame).toContain('╰')
    // The numbered decision list: the approve option's own label, then
    // Blue's Reject and Revise wording; the seeded cursor on Approve.
    expect(frame).toContain('^▶ ^^1. Ship it^')
    expect(frame).toContain('2. Reject')
    expect(frame).toContain('3. Revise')
    expect(frame).toContain('←→/1-3 choose · ↑↓ scroll · esc dismiss')
  })

  it('windows a long plan behind a showing tail inside the box and scrolls it', () => {
    // At 24 viewport rows the window is 13 (the panel chrome reserves 11).
    const { panel } = mount(ask({ detail: LONG_DETAIL }))
    const first = panel.render(60).join('\n')
    expect(first).toContain('showing 1-13 of 15')
    expect(first).toContain('↑↓ scroll')
    expect(first).toContain('line 1')
    expect(first).not.toContain('line 14')
    // ↓/↑ step one line — the mouse wheel arrives as those arrows, so the
    // wheel scrolls the plan (the round-4 ruling).
    panel.handleInput(KEY.down)
    expect(panel.render(60).join('\n')).toContain('showing 2-14 of 15')
    panel.handleInput(KEY.up)
    expect(panel.render(60).join('\n')).toContain('showing 1-13 of 15')
    // PageDown/Up jump by the window size; one page clamps to the last
    // full window.
    panel.handleInput('\x1b[6~')
    const paged = panel.render(60).join('\n')
    expect(paged).toContain('showing 3-15 of 15')
    expect(paged).not.toContain('line 2')
    panel.handleInput('\x1b[5~')
    panel.handleInput('\x1b[5~')
    expect(panel.render(60).join('\n')).toContain('showing 1-13 of 15')
  })

  it('scrolling never moves the choice cursor — the arrows are two axes', () => {
    const { panel, onComplete } = mount(ask({ detail: LONG_DETAIL }))
    for (let step = 0; step < 20; step += 1) panel.handleInput(KEY.down)
    expect(onComplete).not.toHaveBeenCalled()
    // Still the seeded Approve row: Enter approves, not rejects.
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Ship it'] })
  })

  it('fills the viewport: a tall terminal windows nothing, a tiny one clamps to the minimum', () => {
    const tall = mount(ask({ detail: LONG_DETAIL }), 40)
    const frame = tall.panel.render(60).join('\n')
    expect(frame).not.toContain('showing')
    expect(frame).not.toContain('pgup/pgdn')
    expect(frame).toContain('line 15')
    const tiny = mount(ask({ detail: LONG_DETAIL }), 12)
    const small = tiny.panel.render(60).join('\n')
    expect(small).toContain('showing 1-6 of 15')
    expect(small).not.toContain('line 7')
  })

  it('rides the typed revision text inline with the cursor block and hint', () => {
    const { panel } = mount(ask())
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.right)
    for (const char of 'redo') panel.handleInput(char)
    const frame = panel.render(60).join('\n')
    expect(frame).toContain('3. Revise  redo')
    expect(frame).toContain('[7m [0m')
    expect(frame).toContain('~  Type feedback · ↵ submit.~')
    // Leaving the row drops the hint and the block but keeps the text.
    panel.handleInput(KEY.left)
    const moved = panel.render(60).join('\n')
    expect(moved).not.toContain('Type feedback')
    expect(moved).toContain('3. Revise  redo')
  })

  it('defaults the title when the header is absent', () => {
    const { header, ...withoutHeader } = ask()
    void header
    const { panel } = mount(withoutHeader as AskUserQuestionItem)
    expect(panel.render(60).join('\n')).toContain('Plan review')
  })

  it('tolerates a bare ask: no header, no detail', () => {
    const { header, detail, options, ...bare } = ask()
    void header
    void detail
    void options
    const { panel } = mount({
      ...bare,
      options: [{ label: 'Ship it' }, { label: 'Keep planning' }],
    } as AskUserQuestionItem)
    const rows = panel.render(60).join('\n')
    expect(rows).toContain('Plan review')
    expect(rows).toContain('1. Ship it')
  })
})

describe('PlanReviewPanel decisions', () => {
  it('approves from the seeded cursor with the intent-named label', () => {
    const { panel, onComplete, onCancel } = mount(ask())
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Ship it'] })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('rejects with the other option label from the second row', () => {
    const { panel, onComplete } = mount(ask())
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Keep planning'] })
  })

  it('fires Approve and Reject directly through the digit keys', () => {
    const { panel, onComplete } = mount(ask())
    panel.handleInput('2')
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Keep planning'] })
    panel.handleInput('1')
    expect(onComplete).toHaveBeenLastCalledWith({ id: 'plan-review', selected: ['Ship it'] })
  })

  it('digit 3 focuses the revision input, typed text submits as feedback', () => {
    const { panel, onComplete } = mount(ask())
    panel.handleInput('3')
    for (const char of 'redo step 2') panel.handleInput(char)
    // Backspace edits the inline input.
    panel.handleInput('\x7f')
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: [], custom: 'redo step ' })
  })

  it('an empty revision submission declines plainly', () => {
    const { panel, onComplete } = mount(ask())
    panel.handleInput('3')
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Keep planning'] })
  })

  it('typing while a decision row holds focus does nothing', () => {
    const { panel, onComplete, onCancel } = mount(ask())
    for (const char of 'redo') panel.handleInput(char)
    expect(onComplete).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    // The typed text never reached the revision input either.
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.right)
    expect(panel.render(60).join('\n')).not.toContain('3. Revise  redo')
  })

  it('moves with ←/→ and wraps at both ends', () => {
    const { panel, onComplete } = mount(ask())
    // Left off the seeded Approve wraps to Revise; left again lands on Reject.
    panel.handleInput(KEY.left)
    panel.handleInput(KEY.left)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Keep planning'] })
    // Right off the tail wraps back to Approve.
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenLastCalledWith({ id: 'plan-review', selected: ['Ship it'] })
  })

  it('dismisses on Escape without answering', () => {
    const { panel, onComplete, onCancel } = mount(ask())
    panel.handleInput(KEY.escape)
    expect(onComplete).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('forwards invalidation to the markdown and the editor', () => {
    const { panel } = mount(ask())
    panel.handleInput('x')
    panel.invalidate()
    expect(panel.render(60).length).toBeGreaterThan(0)
  })
})
