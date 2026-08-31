/**
 * Unit tests for the plan-review decision panel: choice-pair extraction
 * from the intent, the bordered plan box with its scroll window, the
 * numbered decision list with the inline revision input, digit
 * direct-fire, and dismissal — over the fake theme/components.
 */

import { describe, expect, it, vi } from 'vitest'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { BlueComponent } from '../../core/src/types.ts'
import { startBlueTerminal } from '../../core/src/terminal.ts'
import { FakeTerminal, waitForRender } from '../../core/tests/fake-terminal.ts'
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
  components: FakeBlueComponents
  onComplete: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onComplete = vi.fn()
  const onCancel = vi.fn()
  const choices = planReviewChoices(question)
  if (choices === undefined) throw new Error('test ask has no choice pair')
  const components = new FakeBlueComponents()
  const panel = new PlanReviewPanel({
    theme: new FakeTheme(),
    components,
    question,
    choices,
    viewportRows: () => viewportRows,
    onComplete,
    onCancel,
  })
  panel.focused = true
  return { panel, components, onComplete, onCancel }
}

describe('planReviewChoices', () => {
  it('pairs the intent-named approving option with the other', () => {
    const { approve, decline } = planReviewChoices(ask())!
    expect(approve.label).toBe('Ship it')
    expect(decline.label).toBe('Keep planning')

    const reversed = planReviewChoices(ask({ options: [decline, approve] }))!
    expect(reversed.approve.label).toBe('Ship it')
    expect(reversed.decline.label).toBe('Keep planning')
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
    expect(panel.currentNode()).toMatchObject({ kind: 'surface', chrome: 'overlay' })
    expect(frame).toContain('# Fix the build')
    expect(frame).toContain('Ship it [1]')
    expect(frame).toContain('Reject [2]')
    expect(frame).toContain('Revise [3]')
    expect(frame).toContain('1-3 choose')
  })

  it('windows a long plan behind a showing tail inside the box and scrolls it', () => {
    // At 24 viewport rows the window is 10 (worst-case chrome with the revise
    // hint, footer, and one visible upstream row reserve the other 14).
    const { panel } = mount(ask({ detail: LONG_DETAIL }))
    const first = panel.render(60).join('\n')
    expect(first).toContain('showing 1-10/15')
    expect(first).toContain('PgUp/PgDn')
    expect(first).toContain('line 1')
    expect(first).not.toContain('line 14')
    // The read-only plan is the initial content group and owns scrolling.
    panel.handleInput(KEY.down)
    expect(panel.render(60).join('\n')).toContain('showing 2-11/15')
    panel.handleInput(KEY.up)
    expect(panel.render(60).join('\n')).toContain('showing 1-10/15')
    // PageDown/Up jump by the window size; one page clamps to the last
    // full window.
    panel.handleInput('\x1b[6~')
    const paged = panel.render(60).join('\n')
    expect(paged).toContain('showing 6-15/15')
    expect(paged).not.toContain('line 5')
    panel.handleInput('\x1b[5~')
    panel.handleInput('\x1b[5~')
    expect(panel.render(60).join('\n')).toContain('showing 1-10/15')
  })

  it('windows one long Markdown line after renderer wrapping and clamps on resize', () => {
    const detail = `# Heading ${'wrapped '.repeat(35)}THE_END`
    const { panel, components } = mount(ask({ detail }))
    const first = panel.render(20).join('\n')
    expect(first).toMatch(/showing 1-10\/\d+/u)
    expect(first).toContain('# Heading')
    expect(first).toContain('PgUp/PgDn')

    panel.handleInput(KEY.down)
    const scrolled = panel.render(20).join('\n')
    expect(scrolled).toMatch(/showing 2-11\/\d+/u)
    expect(scrolled).toContain('PgUp/PgDn')

    for (let page = 0; page < 10; page += 1) panel.handleInput('\x1b[6~')
    expect(panel.render(20).join('\n')).toContain('THE_END')

    const wide = panel.render(120).join('\n')
    expect(wide).not.toContain('showing')
    expect(wide).toContain('THE_END')
    panel.invalidate()
    expect(components.markdowns.some(markdown => markdown.invalidations > 0)).toBe(true)
  })

  it('keeps Markdown heading, list, and fence source on the core-owned leaf', () => {
    const { panel } = mount(ask({ detail: '# Heading\n\n- item\n\n```ts\nconst value = 1\n```' }), 40)
    const frame = panel.render(60).join('\n')
    expect(frame).toContain('# Heading')
    expect(frame).toContain('- item')
    expect(frame).toContain('```ts')
    expect(frame).toContain('const value = 1')
  })

  it('keeps streaming transcript growth inside the main-screen differential viewport', async () => {
    const terminal = new FakeTerminal(60, 24)
    const runtime = await startBlueTerminal(terminal, () => Promise.resolve(undefined))
    const lines = ['stream 1']
    const transcript: BlueComponent = {
      render: () => [...lines],
      invalidate: () => {},
    }
    const footer: BlueComponent = {
      render: () => ['footer 1', 'footer 2'],
      invalidate: () => {},
    }
    const { panel } = mount(ask({ detail: LONG_DETAIL }))
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.right)
    runtime.addChild(transcript)
    runtime.addBottomChild(panel)
    runtime.addBottomChild(footer, 'bottom')
    runtime.requestRender(true)
    await waitForRender()
    const initialFullRedraws = runtime.tui.fullRedraws

    // exit_plan_mode can keep rewriting the active transcript tail while its
    // question is already open. This exact same-line token stream sat one row
    // above the viewport before the reserve and forced a full redraw per token.
    for (let index = 2; index <= 4; index += 1) {
      lines[0] = `stream token ${String(index)}`
      runtime.requestRender()
      await waitForRender()
    }
    // A newline then grows the transcript and moves the panel as well.
    lines.push('stream next line')
    runtime.requestRender()
    await waitForRender()
    expect(runtime.tui.fullRedraws).toBe(initialFullRedraws)
    await runtime.stop()
  })

  it('uses Tab to move from the scroll group into decisions', () => {
    const { panel, onComplete } = mount(ask({ detail: LONG_DETAIL }))
    for (let step = 0; step < 20; step += 1) panel.handleInput(KEY.down)
    expect(onComplete).not.toHaveBeenCalled()
    panel.handleInput(KEY.enter)
    expect(onComplete).not.toHaveBeenCalled()
    panel.handleInput(KEY.tab)
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
    expect(small).toContain('showing 1-6/15')
    expect(small).not.toContain('line 7')
  })

  it('rides the typed revision text inline with the cursor block and hint', () => {
    const { panel } = mount(ask())
    panel.handleInput('3')
    for (const char of 'redo') panel.handleInput(char)
    const frame = panel.render(60).join('\n')
    expect(frame).toContain('Revise:')
    expect(frame).toContain('redo')
    expect(frame).toContain('Enter finish · Type feedback · Esc leave')
    panel.handleInput(KEY.escape)
    expect(panel.render(60).join('\n')).toContain('redo')
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
    expect(rows).toContain('Ship it [1]')
  })
})

describe('PlanReviewPanel decisions', () => {
  it('approves from the seeded cursor with the intent-named label', () => {
    const { panel, onComplete, onCancel } = mount(ask())
    panel.handleInput(KEY.tab)
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Ship it'] })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('rejects with the other option label from the second row', () => {
    const { panel, onComplete } = mount(ask())
    panel.handleInput(KEY.tab)
    panel.handleInput(KEY.down)
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
    panel.focused = true
    expect(panel.focused).toBe(true)
    panel.handleInput('\x1b[200~重做 step 2\x1b[201~')
    expect(panel.render(60).join('\n')).toContain('重做 step 2|')
    // Backspace edits the inline input.
    panel.handleInput('\x7f')
    panel.handleInput(KEY.enter)
    expect(onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: [], custom: '重做 step ' })
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

  it('moves decisions with Up/Down according to the vertical layout', () => {
    const value = mount(ask())
    value.panel.handleInput(KEY.tab)
    value.panel.handleInput(KEY.down)
    value.panel.handleInput(KEY.enter)
    expect(value.onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: ['Keep planning'] })
  })

  it('enters revision editing from the third canonical decision row', () => {
    const value = mount(ask())
    value.panel.handleInput(KEY.tab)
    value.panel.handleInput(KEY.down)
    value.panel.handleInput(KEY.down)
    value.panel.handleInput(KEY.enter)
    value.panel.handleInput('redo')
    value.panel.handleInput(KEY.enter)
    expect(value.onComplete).toHaveBeenCalledWith({ id: 'plan-review', selected: [], custom: 'redo' })
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
    const events = panel as unknown as { onEvent(event: { kind: string, controlId: string, value?: unknown }): void }
    events.onEvent({ kind: 'activate', controlId: 'revision' })
    events.onEvent({ kind: 'value-change', controlId: 'other', value: 'ignored' })
    events.onEvent({ kind: 'value-change', controlId: 'revision', value: 3 })
    events.onEvent({ kind: 'selection-change', controlId: 'plan-review-decisions', value: '2' })
    events.onEvent({ kind: 'selection-change', controlId: 'plan-review-decisions', value: '9' })
    const cursor = panel as unknown as { syncCursor(controlId: string, itemId: string | undefined): void }
    cursor.syncCursor('other', '0')
    cursor.syncCursor('plan-review-decisions', undefined)
    cursor.syncCursor('plan-review-decisions', 'missing')
    cursor.syncCursor('plan-review-decisions', '9')
    cursor.syncCursor('plan-review-decisions', '0')
    panel.invalidate()
    expect(panel.render(60).length).toBeGreaterThan(0)
  })
})
