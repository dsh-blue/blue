/**
 * The AgentGroupComponent: the S33 kimi agent-group port — the A+ fold
 * baseline. Header phases with the max-elapsed tail, the `├─/└─` tree with
 * per-member descriptions and phase tails, the failed second line, the
 * description fallback chain, attach/settle cache rebuilds, the 1 Hz pending
 * tick (injectable timers: start, advance, self-retire, dispose), and width
 * discipline.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { BlueSemanticColors } from '@dsh-blue/blue-core'
import { AgentGroupComponent, setAgentGroupTimers } from '../src/agent-group.ts'
import type { TranscriptToolItem } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors: assertions see structure, not escape codes. */
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

/** Tagged colors for role assertions. */
function tagged(): BlueSemanticColors {
  const tag = (letter: string) => (text: string): string => `[${letter}]${text}[/${letter}]`
  return {
    ...COLORS,
    muted: tag('M'),
    textMuted: tag('T'),
    primary: tag('P'),
    success: tag('S'),
    error: tag('E'),
  }
}

/** The frozen wall clock the injected timers report. */
const T0 = 1_700_000_000_000

/** Fake timer rig: captures the tick callback, reports a settable clock. */
function fakeTimers(): {
  clock: { now: number }
  fire: () => void
  intervalCount: () => number
  clearCount: () => number
} {
  let callback: (() => void) | null = null
  let intervals = 0
  let clears = 0
  const clock = { now: T0 }
  setAgentGroupTimers({
    setInterval: cb => {
      intervals += 1
      callback = cb
      return 0 as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: () => {
      clears += 1
      callback = null
    },
    now: () => clock.now,
  })
  return {
    clock,
    fire: () => callback?.(),
    intervalCount: () => intervals,
    clearCount: () => clears,
  }
}

afterEach(() => {
  setAgentGroupTimers(undefined)
})

/** One subagent member with the dogfood-verified arg shape. */
function agentMember(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
  return {
    kind: 'tool', seq: 1, turn: 1, step: 1, callId: 'c1', name: 'subagent',
    arguments: '{"description":"Survey tests","prompt":"survey the tests"}',
    parsedArguments: { description: 'Survey tests', prompt: 'survey the tests' },
    startedAt: T0,
    ...partial,
  }
}

/** Settle a member `ms` after its start; failures carry the error text. */
function settle(member: TranscriptToolItem, ms: number, isError = false, text = 'done', fullText?: string): void {
  member.result = {
    text,
    isError,
    endedAt: member.startedAt + ms,
    ...(fullText !== undefined ? { fullText } : {}),
  }
}

describe('AgentGroupComponent', () => {
  it('renders the running header and tree while members run', () => {
    const timers = fakeTimers()
    timers.clock.now = T0 + 45_000
    const group = new AgentGroupComponent(agentMember(), tagged(), fakeBlueComponents())
    group.attach(agentMember({ seq: 2, callId: 'c2', parsedArguments: { description: 'Map docs', prompt: 'p' } }))
    expect(group.render(80)).toEqual([
      '',
      '● \x1b[1m[P]Running 2 agents (2 running)[/P]\x1b[22m[M] · 45s[/M]',
      '  ├─ [P]subagent[/P][M] · Survey tests · 45s[/M][P] · Running[/P]',
      '  └─ [P]subagent[/P][M] · Map docs · 45s[/M][P] · Running[/P]',
    ])
  })

  it('renders the mixed breakdown header', () => {
    const timers = fakeTimers()
    timers.clock.now = T0 + 48_000
    const first = agentMember()
    settle(first, 90_000)
    const group = new AgentGroupComponent(first, tagged(), fakeBlueComponents())
    group.attach(agentMember({ seq: 2, callId: 'c2', parsedArguments: { description: 'Map docs', prompt: 'p' } }))
    expect(group.render(80)[1]).toBe(
      '● \x1b[1m[P]Running 2 agents (1 done, 1 running)[/P]\x1b[22m[M] · 1m 30s[/M]')
  })

  it('renders the finished header and completed rows once settled', () => {
    const first = agentMember()
    settle(first, 90_000)
    const second = agentMember({ seq: 2, callId: 'c2', parsedArguments: { description: 'Map docs', prompt: 'p' } })
    settle(second, 45_000)
    const group = new AgentGroupComponent(first, tagged(), fakeBlueComponents())
    group.attach(second)
    expect(group.render(80)).toEqual([
      '',
      '[S]✓ [/S]\x1b[1m[P]2 agents finished[/P]\x1b[22m[M] · 1m 30s[/M]',
      '  ├─ [P]subagent[/P][M] · Survey tests · 1m 30s[/M][S] · ✓ Completed[/S]',
      '  └─ [P]subagent[/P][M] · Map docs · 45s[/M][S] · ✓ Completed[/S]',
    ])
  })

  it('renders the failed tail and error second line with both branch prefixes', () => {
    const first = agentMember()
    settle(first, 30_000, true, 'Error: delegation refused\ncontext line')
    const last = agentMember({ seq: 2, callId: 'c2', parsedArguments: { description: 'Map docs', prompt: 'p' } })
    settle(last, 20_000, true, 'boom')
    const group = new AgentGroupComponent(first, tagged(), fakeBlueComponents())
    group.attach(last)
    expect(group.render(80)).toEqual([
      '',
      '[S]✓ [/S]\x1b[1m[P]2 agents finished[/P]\x1b[22m[M] · 30s[/M]',
      '  ├─ [P]subagent[/P][M] · Survey tests · 30s[/M][E] · ✗ Failed[/E]',
      '  │  ' + '    ' + '[E]Error: Error: delegation refused[/E]',
      '  └─ [P]subagent[/P][M] · Map docs · 20s[/M][E] · ✗ Failed[/E]',
      '     ' + '    ' + '[E]Error: boom[/E]',
    ])
  })

  it('falls back through the description chain', () => {
    const timers = fakeTimers()
    timers.clock.now = T0 + 5_000
    // Parsed description wins.
    const withArgs = agentMember()
    // No parsed description: the raw arguments string ellipsizes.
    const rawOnly = agentMember({
      seq: 2, callId: 'c2',
      arguments: '{"prompt":"survey every test file in the repo and summarize the layout"}',
      parsedArguments: { prompt: 'survey every test file in the repo and summarize the layout' },
    })
    // Nothing usable at all.
    const bare = agentMember({ seq: 3, callId: 'c3', arguments: '', parsedArguments: undefined })
    const group = new AgentGroupComponent(withArgs, COLORS, fakeBlueComponents())
    group.attach(rawOnly)
    group.attach(bare)
    const lines = group.render(200)
    expect(lines[2]).toContain('· Survey tests ·')
    expect(lines[3]).toContain('· {"prompt":"survey every test file in the repo and summarize… ·')
    expect(lines[4]).toContain('· (no description) ·')
  })

  it('prefers a parsed name-like argument as the label', () => {
    const timers = fakeTimers()
    timers.clock.now = T0 + 5_000
    const named = agentMember({ parsedArguments: { name: 'explore', description: 'Survey tests', prompt: 'p' } })
    const group = new AgentGroupComponent(named, tagged(), fakeBlueComponents())
    expect(group.render(80)[2]).toContain('[P]explore[/P]')
  })

  it('rebuilds when a member settles and after attach', () => {
    fakeTimers()
    const components = fakeBlueComponents()
    const member = agentMember()
    const group = new AgentGroupComponent(member, COLORS, components)
    const pending = group.render(80)
    expect(group.render(80)).toBe(pending)
    settle(member, 10_000)
    expect(group.render(80)).not.toBe(pending)
    const settled = group.render(80)
    group.attach(agentMember({ seq: 2, callId: 'c2' }))
    expect(group.render(80)).not.toBe(settled)
  })

  it('ticks pending members forward and retires the timer when none remain', () => {
    const timers = fakeTimers()
    const group = new AgentGroupComponent(agentMember(), COLORS, fakeBlueComponents())
    group.render(80)
    expect(timers.intervalCount()).toBe(1)
    // Advance the clock a minute: the next render (the tick's invalidate +
    // requestRender path) shows the new bucket.
    timers.clock.now = T0 + 61_000
    group.render(80)
    expect(group.render(80)[1]).toContain('1m 1s')
    // Settling both sides stands the tick down on its own next fire.
    settle(group['members'][0]!, 70_000)
    timers.fire()
    expect(timers.clearCount()).toBe(1)
  })

  it('a tick over a still-pending member invalidates and nudges a redraw', () => {
    const timers = fakeTimers()
    const renders: number[] = []
    const group = new AgentGroupComponent(agentMember(), COLORS, fakeBlueComponents(), () => { renders.push(1) })
    group.render(80)
    expect(renders).toHaveLength(0)
    timers.clock.now = T0 + 2_000
    timers.fire()
    expect(renders).toHaveLength(1)
    // The invalidated cache rebuilt with the advanced clock.
    expect(group.render(80)[1]).toContain('2s')
  })

  it('falls back to the bare Failed line when the error text is blank', () => {
    const failed = agentMember()
    settle(failed, 10_000, true, '   \n  ')
    const group = new AgentGroupComponent(failed, COLORS, fakeBlueComponents())
    expect(group.render(80).at(-1)).toContain('Error: Failed')
  })

  it('takes the failed first line from fullText when present', () => {
    const failed = agentMember()
    settle(failed, 10_000, true, 'summarized', 'the full error\nsecond line')
    const group = new AgentGroupComponent(failed, COLORS, fakeBlueComponents())
    expect(group.render(80).at(-1)).toContain('Error: the full error')
  })

  it('counts failed members in the running breakdown', () => {
    const timers = fakeTimers()
    timers.clock.now = T0 + 30_000
    const failed = agentMember()
    settle(failed, 12_000, true, 'boom')
    const group = new AgentGroupComponent(failed, tagged(), fakeBlueComponents())
    group.attach(agentMember({ seq: 2, callId: 'c2', parsedArguments: { description: 'Map docs', prompt: 'p' } }))
    expect(group.render(80)[1]).toBe(
      '● \x1b[1m[P]Running 2 agents (1 failed, 1 running)[/P]\x1b[22m[M] · 30s[/M]')
  })

  it('falls back to (no description) on settled members too', () => {
    const done = agentMember({ arguments: '', parsedArguments: undefined })
    settle(done, 5_000)
    const failed = agentMember({ seq: 2, callId: 'c2', arguments: '', parsedArguments: undefined })
    settle(failed, 6_000, true, 'boom')
    const group = new AgentGroupComponent(done, COLORS, fakeBlueComponents())
    group.attach(failed)
    const lines = group.render(80)
    expect(lines[2]).toContain('subagent · (no description) · 5s · ✓ Completed')
    expect(lines[3]).toContain('subagent · (no description) · 6s · ✗ Failed')
  })

  it('starts no timer for a group that mounts already settled', () => {
    const timers = fakeTimers()
    const first = agentMember()
    settle(first, 10_000)
    const second = agentMember({ seq: 2, callId: 'c2' })
    settle(second, 12_000)
    const group = new AgentGroupComponent(first, COLORS, fakeBlueComponents())
    group.attach(second)
    group.render(80)
    expect(timers.intervalCount()).toBe(0)
  })

  it('stands the tick down on dispose', () => {
    const timers = fakeTimers()
    const group = new AgentGroupComponent(agentMember(), COLORS, fakeBlueComponents())
    group.render(80)
    group.dispose()
    expect(timers.clearCount()).toBe(1)
  })

  it('keeps every row within the viewport width', () => {
    fakeTimers()
    const components = fakeBlueComponents()
    const member = agentMember({
      arguments: '{"description":"a very long delegation description that will not fit narrow widths","prompt":"p"}',
      parsedArguments: { description: 'a very long delegation description that will not fit narrow widths', prompt: 'p' },
    })
    const group = new AgentGroupComponent(member, COLORS, components)
    for (const line of group.render(10)) {
      expect(components.visibleWidth(line)).toBeLessThanOrEqual(10)
    }
  })

  it('exposes no setExpanded (the group never expands)', () => {
    fakeTimers()
    const group = new AgentGroupComponent(agentMember(), COLORS, fakeBlueComponents())
    expect((group as unknown as { setExpanded?: unknown }).setExpanded).toBeUndefined()
  })
})
