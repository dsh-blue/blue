/**
 * Tests for the `blue-pane-queue` plugin: the bottom-pinned queued-message
 * pane rendering, app-owned queue notifications, session switches, and
 * unload behavior.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge and
// the `'test/session-changed'` Events merge this spec emits.
import type {} from '@dsh-blue/blue-app'
import * as paneQueuePlugin from '../src/pane-queue.ts'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

/**
 * Render the mounted (gutter-wrapped) pane as if the child saw `width`:
 * the kimi gutter the mount layer adds is a mount-layer concern covered by
 * the core gutter spec and the bundle e2e; these specs assert the pane's
 * own surface.
 */
function unwrapped(pane: { render(width: number): string[] } | undefined, width: number): string[] {
  return (pane?.render(width + 2) ?? []).map(line => line === ' ' ? '' : line.slice(1))
}

/** In-memory inbox double with recordable removal. */
function fakeInbox(nextTurn: UserMessage[] = [], nextStep: UserMessage[] = []) {
  const removed: string[] = []
  return {
    nextTurn,
    nextStep,
    removed,
    get hasPending(): boolean {
      return nextTurn.length > 0 || nextStep.length > 0
    },
    remove(id: string): boolean {
      removed.push(id)
      return true
    },
  }
}

function message(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function mount(options: { attach?: boolean, inbox?: ReturnType<typeof fakeInbox> } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  agent: Agent
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('pane-queue-spec'))
  const agent = {
    id: session.id,
    session,
    inbox: options.inbox ?? fakeInbox(),
  } as unknown as Agent
  ctx.provide('testSession', { current: options.attach === false ? null : agent, modelRef: undefined })
  const fiber = await ctx.plugin(paneQueuePlugin)
  return { ctx, screen, agent, fiber }
}

describe('blue-pane-queue plugin', () => {
  it('mounts the pane bottom-pinned and renders nothing without an agent', async () => {
    const { screen } = await mount({ attach: false })
    expect(screen.children).toHaveLength(1)
    const pane = screen.children[0]
    expect(unwrapped(pane, 80)).toEqual([])
    pane?.invalidate()
  })

  it('renders nothing when the inbox has no pending messages', async () => {
    const { screen } = await mount()
    expect(unwrapped(screen.children[0], 80)).toEqual([])
  })

  it('renders one row per pending message with the activity glyph accented', async () => {
    const { screen } = await mount({
      inbox: fakeInbox([message('first turn'), message('second\nturn')], [message('steer this')]),
    })
    // The `↑` glyph paints `primary`, the row text stays `muted` around it.
    expect(unwrapped(screen.children[0], 80)).toEqual([
      '~queued ~^↑^~ turn: first turn~',
      '~queued ~^↑^~ turn: second turn~',
      '~queued ~^↑^~ step: steer this~',
    ])
  })

  it('truncates rows to the render width before coloring the glyph', async () => {
    const { screen } = await mount({ inbox: fakeInbox([message('a rather long queued message')]) })
    // Truncation goes through the display-width-aware pi-tui helper (the
    // S33 acceptance crash fix — a char-counted cut left CJK rows two cells
    // over); its ellipsis is reset-wrapped even for plain rows.
    expect(unwrapped(screen.children[0], 20)).toEqual(['~queued ~^↑^~ turn: a \x1b[0m...\x1b[0m~'])
  })

  it('renders a plain muted row when truncation cuts the glyph', async () => {
    const { screen } = await mount({ inbox: fakeInbox([message('a rather long queued message')]) })
    // A 7-column row truncates before the `↑` (column 8): the split is
    // skipped and the whole row renders muted.
    expect(unwrapped(screen.children[0], 7)).toEqual(['~queu\x1b[0m...\x1b[0m~'])
  })

  it('renders a blank text portion for messages without text blocks', async () => {
    const imageOnly = {
      id: 'm-image',
      role: 'user',
      content: [{ type: 'image', data: '...', mimeType: 'image/png' }],
      source: { kind: 'user' },
    } as unknown as UserMessage
    const { screen } = await mount({ inbox: fakeInbox([imageOnly]) })
    expect(unwrapped(screen.children[0], 80)).toEqual(['~queued ~^↑^~ turn: ~'])
  })

  it('re-renders on the app-owned queue notification', async () => {
    const { ctx, screen } = await mount()
    const before = screen.renderRequests
    ctx.emit('blue/queue-changed')
    expect(screen.renderRequests).toBe(before + 1)
  })

  it('follows test/session-changed to the new agent', async () => {
    const { ctx, screen } = await mount({ attach: false })
    const next = {
      id: 'next',
      status: 'idle',
      session: { header: {} },
      inbox: fakeInbox([message('queued')]),
    } as unknown as Agent
    const before = screen.renderRequests
    ;(ctx.get('testSession') as { current: Agent | null }).current = next
    ctx.emit('test/session-changed', next)
    expect(screen.renderRequests).toBe(before + 1)
    expect(unwrapped(screen.children[0], 80)).toEqual(['~queued ~^↑^~ turn: queued~'])
  })

  it('unregisters its queue subscription and dock contribution on dispose', async () => {
    const { ctx, screen, fiber } = await mount()
    await fiber.dispose()
    // Bottom models mount independently so unloading removes the queue
    // component itself instead of leaving an empty lane root behind.
    expect(screen.children).toHaveLength(0)
    const before = screen.renderRequests
    ctx.emit('blue/queue-changed')
    expect(screen.renderRequests).toBe(before)
  })
})
