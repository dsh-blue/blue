/**
 * Tests for the editor draft stash: `blue-input` mirrors editor text into
 * the module-level stash, the editor mounted after a reload (a theme swap
 * re-runs this fiber) restores it, and consuming the draft — submit or an
 * Escape buffer clear — clears the stash so the next reload starts empty.
 * The stash is module state shared across this file, so the cases run
 * sequentially.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as inputPlugin from '../src/input-plugin.ts'
import { getStashedDraft, getStashedInputMode, stashDraft, stashInputMode, clearDraft } from '../src/draft-stash.ts'
import { fakeBlueContext, KEY, type FakeBlueComponents, type FakeBlueEditor } from './fakes.ts'

function type(editor: FakeBlueEditor, text: string): void {
  for (const char of text) editor.handleInput(char)
}

async function boot(): Promise<{
  ctx: Context
  components: FakeBlueComponents
  followup: ReturnType<typeof vi.fn>
}> {
  const { ctx, components } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('draft-spec'))
  const followup = vi.fn()
  const agent = { id: session.id, session, status: 'idle', followup } as unknown as Agent
  ctx.provide('blueSession', { current: agent, modelRef: undefined })
  return { ctx, components, followup }
}

describe('editor draft stash', () => {
  it('restores the stashed draft after a reload and clears it on submit', async () => {
    const { ctx, components, followup } = await boot()
    const firstFiber = await ctx.plugin(inputPlugin)
    const first = components.editors[0] as FakeBlueEditor
    type(first, 'half-written thought')
    expect(getStashedDraft()).toBe('half-written thought')
    // The reload: the fiber disposes and re-runs, rebuilding the editor.
    await firstFiber.dispose()
    const secondFiber = await ctx.plugin(inputPlugin)
    const second = components.editors[1] as FakeBlueEditor
    expect(second).not.toBe(first)
    expect(second.getText()).toBe('half-written thought')
    // Submitting consumes the draft; the stash goes with it.
    second.handleInput(KEY.enter)
    expect(followup).toHaveBeenCalledOnce()
    expect(getStashedDraft()).toBe('')
    // A second reload therefore starts empty.
    await secondFiber.dispose()
    await ctx.plugin(inputPlugin)
    expect(components.editors[2]?.getText()).toBe('')
  })

  it('clears the stash when Escape clears the buffer', async () => {
    const { ctx, components } = await boot()
    const firstFiber = await ctx.plugin(inputPlugin)
    const first = components.editors[0] as FakeBlueEditor
    type(first, 'draft')
    expect(getStashedDraft()).toBe('draft')
    first.handleInput(KEY.escape)
    expect(first.getText()).toBe('')
    expect(getStashedDraft()).toBe('')
    await firstFiber.dispose()
    await ctx.plugin(inputPlugin)
    expect(components.editors[1]?.getText()).toBe('')
  })

  it('stashes the input mode beside the draft and resets both on submit', () => {
    stashInputMode('bash')
    expect(getStashedInputMode()).toBe('bash')
    // Consuming the draft resets the mode with it.
    stashDraft('ls')
    clearDraft()
    expect(getStashedInputMode()).toBe('prompt')
    expect(getStashedDraft()).toBe('')
  })
})
