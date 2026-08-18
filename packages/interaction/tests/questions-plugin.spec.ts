/**
 * Tests for the `blue-questions` plugin over the real user-questions
 * service: option overlays, free-text overlays, dismissal, abort, provider
 * uniqueness, and disposal.
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
        options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
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
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q2', selected: [], custom: 'because' }] })
  })

  it('omits custom text for an empty free-text answer', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [{ id: 'q2', question: 'Why?' }] })
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q2', selected: [] }] })
  })

  it('asks sequential questions one overlay at a time', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({
      questions: [choice(), { id: 'q2', question: 'Name?' }],
    })
    expect(screen.overlays).toHaveLength(1)
    overlay(screen).handleInput(KEY.enter)
    await vi_wait()
    expect(screen.overlays).toHaveLength(2)
    for (const char of 'neo') overlay(screen).handleInput(char)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toEqual({
      answers: [{ id: 'q1', selected: ['Alpha'] }, { id: 'q2', selected: [], custom: 'neo' }],
    })
  })

  it('rejects ASK_DISMISSED on Escape and hides the overlay', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({ questions: [choice()] })
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

  it('renders the question, header, and detail in the overlay header', async () => {
    const { ctx, screen } = await mount()
    const pending = ctx.userQuestions.ask({
      questions: [choice({ header: 'Setup', detail: 'extra context' })],
    })
    const rendered = screen.overlays[0]?.component.render(60) ?? []
    expect(rendered[0]).toBe('~Setup~')
    expect(rendered[1]).toBe('*Pick one*')
    expect(rendered[2]).toBe('~extra context~')
    overlay(screen).handleInput(KEY.escape)
    await pending.catch(() => {})
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

/** Flush one macrotask so sequential overlays can mount. */
function vi_wait(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}
