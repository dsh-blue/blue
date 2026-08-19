/**
 * Perf-shaped regression guard: 200 synthetic turns fold and mount within
 * the window's mounted-component bound. Timings are logged, never asserted —
 * the assertion is the window bound itself.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueScreen, BlueComponent } from '@dsh-blue/blue-core'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { apply, setWindowTurns } from '../src/index.ts'
import { DEFAULT_WINDOW_TURNS } from '../src/window.ts'
import {
  assistantEvent,
  fakeBlueComponents,
  resetSeq,
  stepStart,
  toolCallEvent,
  toolResultEvent,
  turnEnd,
  turnStart,
  userEvent,
} from './helpers.ts'

afterEach(() => setWindowTurns(undefined))

/** Identity colors (structure only; nothing renders in this spec). */
const id = (text: string): string => text
const COLORS = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id,
  success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
  diffGutter: id, diffMeta: id,
}

/** Counts mounts only; renders nothing. */
class CountingScreen implements BlueScreen {
  mounted = 0
  readonly columns = 80
  readonly rows = 24
  readonly children: BlueComponent[] = []
  addChild(component: BlueComponent): () => void {
    this.mounted += 1
    this.children.push(component)
    return () => {
      this.mounted -= 1
      const index = this.children.indexOf(component)
      if (index !== -1) this.children.splice(index, 1)
    }
  }
  addBottomChild(): () => () => void {
    return () => {}
  }
  removeChild(): void {}
  setFocus(): void {}
  showOverlay(): never {
    throw new Error('out of scope')
  }
  requestRender(): void {}
}

/** Build `turns` synthetic turns: user, 3 steps × 2 tool calls, assistant. */
function syntheticTurns(turns: number): SessionEvent[] {
  resetSeq()
  const events: SessionEvent[] = []
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push(turnStart(turn), userEvent(`question ${turn}`))
    for (let step = 1; step <= 3; step += 1) {
      events.push(stepStart(turn, step))
      for (let tool = 0; tool < 2; tool += 1) {
        const callId = `t${turn}s${step}c${tool}`
        events.push(toolCallEvent(turn, step, callId, tool === 0 ? 'Read' : 'Edit', '{}'))
        events.push(toolResultEvent(turn, step, callId, 'ok'))
      }
    }
    events.push(assistantEvent(turn, 3, [{ type: 'text', text: `answer ${turn}` }]), turnEnd(turn))
  }
  return events
}

/** Apply the plugin over a fake agent and return the counting screen. */
async function runPerf(turns: number, windowSize: number | undefined): Promise<{ screen: CountingScreen, ms: number }> {
  if (windowSize !== undefined) setWindowTurns(windowSize)
  const ctx = new Context()
  const screen = new CountingScreen()
  const keymap = { register: () => () => {} }
  ctx.reflect.provide('blueScreen', screen)
  ctx.reflect.provide('blueTheme', { colors: COLORS })
  ctx.reflect.provide('blueComponents', fakeBlueComponents())
  ctx.reflect.provide('blueKeymap', keymap)
  ctx.reflect.provide('tools', { get: () => undefined })
  const agent = {
    status: 'idle',
    options: {},
    session: { events: syntheticTurns(turns), header: {}, requestHeader: () => undefined },
  } as unknown as Agent
  const started = performance.now()
  ctx.reflect.provide('blueSession', { current: agent })
  await ctx.ready?.()
  apply(ctx)
  const ms = performance.now() - started
  const mounted = screen.mounted
  await ctx.fiber.dispose()
  return { screen: { get mounted() { return mounted } }, ms }
}

describe('transcript perf: 200 turns', () => {
  it('keeps mounted components within the window bound', async () => {
    const bounded = await runPerf(200, undefined)
    console.log(`perf: window=15 mounted=${bounded.screen.mounted} in ${bounded.ms.toFixed(1)}ms`)
    // Per kept turn: 1 user + 2 folded step summaries + final step's 2 tools
    // + 1 assistant = 6 mounted components, kept over DEFAULT_WINDOW_TURNS.
    const bound = 6 * DEFAULT_WINDOW_TURNS + 6
    expect(bounded.screen.mounted).toBeLessThanOrEqual(bound)

    const unbounded = await runPerf(200, Number.MAX_SAFE_INTEGER)
    console.log(`perf: window=MAX mounted=${unbounded.screen.mounted} in ${unbounded.ms.toFixed(1)}ms`)
    expect(unbounded.screen.mounted).toBeGreaterThan(bounded.screen.mounted)
  })
})
