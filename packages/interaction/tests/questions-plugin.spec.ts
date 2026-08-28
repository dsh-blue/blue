/**
 * Tests for the `blue-questions` plugin over the real user-questions
 * service: one tabbed questionnaire overlay per request, dismissal, abort,
 * provider uniqueness, and disposal.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import * as questionsPlugin from '../src/questions-plugin.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

async function mount(): Promise<{ ctx: Context; screen: FakeScreen; fiber: { dispose(): Promise<void> } }> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(UserQuestionService)
  const fiber = await ctx.plugin(questionsPlugin)
  return { ctx, screen, fiber }
}

function choice(question: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
  return {
    id: 'q1',
    question: 'Pick one',
    options: [{ label: 'Alpha', description: 'the first' }, { label: 'Beta' }],
    ...question,
  }
}

/** The overlay component of the last shown overlay. */
function overlay(screen: FakeScreen): { handleInput(data: string): void } {
  const entry = screen.overlays.at(-1)
  if (entry === undefined) throw new Error('no overlay shown')
  return entry.component as { handleInput(data: string): void }
}

describe('blue-questions provider', () => {
  it('answers a single-select question through the overlay', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [choice()] })
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.enter)
    // A second confirmation after settling is a no-op.
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Beta'] }] })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('answers a multi-select question with toggled labels', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({
      questions: [choice({
        multiSelect: true,
        options: [{ label: 'A', description: 'the first' }, { label: 'B' }, { label: 'C' }],
      })],
    })
    overlay(screen).handleInput(KEY.space)
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.space)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['A', 'C'] }] })
  })

  it('answers an optionless question with custom text', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [{ id: 'q2', question: 'Why?' }] })
    for (const char of 'because') overlay(screen).handleInput(char)
    // The questionnaire renders the inline editor above the frame's key row
    // and invalidates through it.
    const panel = screen.overlays[0]?.component
    expect(panel?.render(60)[5]).toContain('Answer')
    expect(panel?.render(60)[5]).toContain('because')
    panel?.invalidate()
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q2', selected: [], custom: 'because' }] })
  })

  it('omits custom text for an empty free-text answer', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [{ id: 'q2', question: 'Why?' }] })
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q2', selected: [] }] })
  })

  it('carries a multi-question request in a single overlay', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({
      questions: [choice(), { id: 'q2', question: 'Name?' }],
    })
    expect(screen.overlays).toHaveLength(1)
    // Tabs move between questions without answering them.
    overlay(screen).handleInput(KEY.tab)
    overlay(screen).handleInput(KEY.tab)
    overlay(screen).handleInput(KEY.enter)
    // Still one overlay: answering q1 advanced to q2's editor.
    expect(screen.overlays).toHaveLength(1)
    for (const char of 'neo') overlay(screen).handleInput(char)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({
      answers: [{ id: 'q1', selected: ['Alpha'] }, { id: 'q2', selected: [], custom: 'neo' }],
    })
  })

  it('renders the header as the tab label, plus the question and detail rows', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({
      questions: [choice({ header: 'Setup', detail: 'extra context' })],
    })
    const rendered = screen.overlays[0]?.component.render(60) ?? []
    const frame = rendered.join('\n')
    expect(frame).toContain('Question 1 of 1')
    expect(frame).toContain('Setup')
    expect(frame).toContain('Pick one')
    expect(frame).toContain('extra context')
    overlay(screen).handleInput(KEY.escape)
    await pending.catch(() => {})
  })

  it('rejects ASK_CANCELLED on Escape and hides the overlay', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [choice()] })
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('rejects ASK_CANCELLED on Escape from a free-text question', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [{ id: 'q2', question: 'Why?' }] })
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('rejects ASK_ABORTED when the request signal aborts mid-question', async () => {
    const { ctx, screen } = await mount()
    const controller = new AbortController()
    const pending = ctx.userQuestions.ask({ questions: [choice()], signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('rejects ASK_ABORTED for a pre-aborted signal without showing an overlay', async () => {
    const { ctx, screen } = await mount()
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.userQuestions.ask({ questions: [choice()], signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('registers exactly one provider; a second registration fails with DUPLICATE_PROVIDER', async () => {
    const { ctx } = await mount()
    expect(() => ctx.userQuestions.registerProvider({ ask: () => Promise.resolve({ answers: [] }) }))
      .toThrow(/already registered/u)
  })

  it('unregisters the provider when the fiber disposes (HMR safety)', async () => {
    const { ctx, fiber } = await mount()
    await fiber.dispose()
    await expect(ctx.userQuestions.ask({ questions: [choice()] }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
    // The slot is free again after disposal.
    const dispose = ctx.userQuestions.registerProvider({ ask: () => Promise.resolve({ answers: [] }) })
    dispose()
  })
})

describe('blue-questions plan-review intent', () => {
  /** The exit_plan_mode ask, with a non-standard approve label. */
  function planAsk(overrides: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
    return {
      id: 'plan-review',
      header: 'Plan review',
      question: 'Approve this plan and leave plan mode?',
      detail: '# Fix the build\n\n1. One\n2. Two',
      options: [
        { label: 'Ship it', description: 'Leave plan mode.' },
        { label: 'Keep planning', description: 'Stay and refine.' },
      ],
      intent: { kind: 'plan-review', approve: 'Ship it' },
      ...overrides,
    }
  }

  it('mounts the dedicated panel and approves from the seeded cursor', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [planAsk()] })
    const frame = screen.overlays[0]?.component.render(60).join('\n') ?? ''
    expect(frame).toContain('Plan review')
    expect(frame).toContain('# Fix the build')
    expect(frame).toContain('Ship it [1]')
    expect(frame).toContain('Reject [2]')
    expect(frame).toContain('Revise [3]')
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'plan-review', selected: ['Ship it'] }] })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('rejects with the other option label from the second button', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [planAsk()] })
    overlay(screen).handleInput(KEY.right)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: ['Keep planning'] }],
    })
  })

  it('submits typed revision feedback from the third row', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [planAsk()] })
    overlay(screen).handleInput(KEY.right)
    overlay(screen).handleInput(KEY.right)
    for (const char of 'redo step 2') overlay(screen).handleInput(char)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: [], custom: 'redo step 2' }],
    })
  })

  it('rejects with ASK_CANCELLED when the plan review is dismissed', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [planAsk()] })
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('rejects with ASK_ABORTED when the plan review signal aborts', async () => {
    const { ctx, screen } = await mount()
    const controller = new AbortController()
    const pending = ctx.userQuestions.ask({ questions: [planAsk()], signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('falls back to the questionnaire for a three-option intent ask', async () => {
    const { ctx, screen } = await mount()
    // A wrong approve label never reaches the provider (the service's
    // BAD_INTENT gate); the reachable fallback is an intent ask whose
    // options are not the decision pair — three options here.
    const pending = ctx.userQuestions.ask({
      questions: [planAsk({
        options: [
          { label: 'Ship it', description: 'Leave plan mode.' },
          { label: 'Keep planning', description: 'Stay and refine.' },
          { label: 'Third way' },
        ],
      })],
    })
    // The generic questionnaire: its title and the fixed Other row.
    const frame = screen.overlays[0]?.component.render(60).join('\n') ?? ''
    expect(frame).toContain('Question 1 of 1')
    expect(frame).toContain('Other')
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'plan-review', selected: ['Ship it'] }] })
  })

  it('keeps the questionnaire for a multi-question batch carrying the intent', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [planAsk(), choice()] })
    const frame = screen.overlays[0]?.component.render(60).join('\n') ?? ''
    expect(frame).toContain('Other')
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
  })
})
