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
    // The questionnaire renders the inline editor and invalidates through it.
    const panel = screen.overlays[0]?.component
    expect(panel?.render(60).at(-1)).toBe('>because')
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
    expect(rendered[0]).toBe('*Setup*')
    expect(rendered[1]).toBe('*Pick one*')
    expect(rendered[2]).toBe('~extra context~')
    overlay(screen).handleInput(KEY.escape)
    await pending.catch(() => {})
  })

  it('rejects ASK_DISMISSED on Escape and hides the overlay', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [choice()] })
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).rejects.toMatchObject({ code: 'ASK_DISMISSED' })
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('rejects ASK_DISMISSED on Escape from a free-text question', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [{ id: 'q2', question: 'Why?' }] })
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).rejects.toMatchObject({ code: 'ASK_DISMISSED' })
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
