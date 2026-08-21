/**
 * Unit tests for the plan-review decision panel: choice-pair extraction
 * from the intent, the markdown scroll window, the decision rows, the
 * feedback editor path, and dismissal — over the fake theme/components.
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

function mount(question: AskUserQuestionItem): {
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
  it('frames the plan, the window, and the two decision rows', () => {
    const { panel } = mount(ask())
    const lines = panel.render(60)
    const frame = lines.join('\n')
    expect(frame).toContain('Plan review')
    expect(frame).toContain('^  Approve this plan and leave plan mode?^')
    // The markdown body rides between the question and the rows.
    expect(frame).toContain('# Fix the build')
    expect(frame).toContain('1. One')
    expect(frame).toContain('→ Ship it')
    expect(frame).toContain('Keep planning')
    expect(frame).toContain('~ — Leave plan mode; carry out the plan.~')
    expect(frame).toContain('↑↓ choose · pgup/pgdn scroll')
  })

  it('windows a long plan behind a showing tail and pages through it', () => {
    const { panel } = mount(ask({ detail: LONG_DETAIL }))
    const first = panel.render(60).join('\n')
    expect(first).toContain('showing 1-10 of 15')
    expect(first).toContain('line 1')
    expect(first).not.toContain('line 11')
    panel.handleInput('\x1b[6~')
    const paged = panel.render(60).join('\n')
    // One page (10) from the top clamps to the last full window.
    expect(paged).toContain('showing 6-15 of 15')
    expect(paged).not.toContain('line 5')
    // Page up clamps at the top.
    panel.handleInput('\x1b[5~')
    panel.handleInput('\x1b[5~')
    expect(panel.render(60).join('\n')).toContain('showing 1-10 of 15')
  })

  it('swaps the rows for the feedback editor with its own hint', () => {
    const { panel } = mount(ask())
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    const frame = panel.render(60).join('\n')
    expect(frame).toContain('↵ send feedback · esc back')
    expect(frame).not.toContain('→ Ship it')
  })

  it('defaults the title when the header is absent', () => {
    const { header, ...withoutHeader } = ask()
    void header
    const { panel } = mount(withoutHeader as AskUserQuestionItem)
    expect(panel.render(60).join('\n')).toContain('Plan review')
  })

  it('tolerates a bare ask: no header, no detail, no descriptions', () => {
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
    expect(rows).toContain('→ Ship it')
    // The editor frame keeps the default title too.
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    expect(panel.render(60).join('\n')).toContain('Plan review')
  })
})

describe('PlanReviewPanel decisions', () => {
  it('approves from the seeded cursor without touching the editor', () => {
    const { panel, onComplete, onCancel } = mount(ask())
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Ship it'] })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('wraps the cursor between the two rows', () => {
    const { panel, onComplete } = mount(ask())
    // Up off the approving row wraps to the decline row and back.
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Ship it'] })
  })

  it('declines with feedback text from the inline editor', () => {
    const { panel, onComplete } = mount(ask())
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    for (const char of 'redo step 2') panel.handleInput(char)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: [], custom: 'redo step 2' })
  })

  it('declines without feedback on an empty editor submission', () => {
    const { panel, onComplete } = mount(ask())
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Keep planning'] })
  })

  it('returns from the editor to the rows on Escape, then dismisses', () => {
    const { panel, onComplete, onCancel } = mount(ask())
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.escape)
    // Back on the rows: Enter approves again (the editor is gone).
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Ship it'] })
    panel.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('ignores unbound keys and forwards invalidation to the body', () => {
    const { panel } = mount(ask())
    panel.handleInput('x')
    panel.invalidate()
    expect(panel.render(60).length).toBeGreaterThan(0)
  })

  it('creates the feedback editor through the factory without options', () => {
    const components = new FakeBlueComponents()
    const choices = planReviewChoices(ask())!
    const panel = new PlanReviewPanel({
      theme: new FakeTheme(),
      components,
      question: ask(),
      choices,
      onComplete: () => {},
      onCancel: () => {},
    })
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    expect(components.editors[0]).toBeDefined()
    expect(components.editorOptions[0]).toBeUndefined()
  })
})
