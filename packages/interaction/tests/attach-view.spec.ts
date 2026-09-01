/**
 * Unit tests for `blue-attach-view`: the `blueChildAttach` service lifecycle
 * (open/close state restoration, single-attach concurrency, display-less
 * degradation, session-switch/unload force close, fiber unload) and the
 * attach view itself (framed render, one-shot read-only degradation,
 * follow-up submit, Ctrl+C interrupt, live projection pushes, the elapsed
 * ticker, width containment) over in-memory seams.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as attachViewPlugin from '../src/attach-view.ts'
import {
  ATTACH_CHROME,
  attachMetricsText,
  ChildAttachView,
  formatAttachElapsed,
  type BlueChildAttachService,
  type BlueChildAttachTarget,
} from '../src/attach-view.ts'
import { EditorHostService, setEditorSlotSwap, setSharedEditor } from '../src/editor-instance.ts'
import { FakeBlueComponents, FakeKeymap, FakeScreen, FakeTheme, KEY } from './fakes.ts'
import { expectLinesFit } from '../../core/tests/width-scan.ts'

/** Strip SGR and the fake palette's marker characters so assertions read visible text. */
function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#!?@]/g, ''))
}

/** One valid conversation projection value with one user/assistant exchange. */
function conversation(text: string, seq = 2): unknown {
  return {
    entries: [
      { id: 'e1', seq: seq - 1, turn: 1, kind: 'user', text: 'hello child', images: [] },
      { id: 'e2', seq, turn: 1, kind: 'assistant', step: 0, text, streaming: false },
    ],
    streaming: false,
  }
}

/**
 * One conversation value with `turns` user/assistant exchanges — enough rows
 * to overflow the attach body budget (10 at the fake screen's 24 rows). The
 * final seq is `2 * turns`.
 */
function longConversation(turns: number): unknown {
  const entries: unknown[] = []
  for (let index = 0; index < turns; index += 1) {
    entries.push(
      { id: `u${String(index)}`, seq: 2 * index + 1, turn: index + 1, kind: 'user', text: `line ${String(index)}`, images: [] },
      { id: `a${String(index)}`, seq: 2 * index + 2, turn: index + 1, kind: 'assistant', step: 0, text: `reply ${String(index)}`, streaming: false },
    )
  }
  return { entries, streaming: false }
}

/** One conversation value whose tool entry exercises the presentation source. */
function conversationWithTool(): unknown {
  return {
    entries: [
      { id: 'e1', seq: 1, turn: 1, kind: 'user', text: 'run ls', images: [] },
      {
        id: 't1',
        seq: 2,
        turn: 1,
        kind: 'tool',
        step: 0,
        callId: 'call-1',
        name: 'bash',
        arguments: '{"command":"ls"}',
        startedAt: 1000,
        channel: 'transcript',
      },
    ],
    streaming: false,
  }
}

/** The programmable in-memory seams one mounted plugin consumes. */
interface Harness {
  readonly ctx: Context
  readonly screen: FakeScreen
  readonly components: FakeBlueComponents
  readonly service: BlueChildAttachService
  readonly fiber: { readonly dispose: () => Promise<void> }
  /** The stand-in editor holding the dock slot before an attach opens. */
  readonly editor: { focused: boolean, render: () => string[], invalidate: () => void, handleInput: ReturnType<typeof vi.fn> }
  readonly cuts: { readonly id: string, readonly keys: readonly string[] }[]
  readonly followups: { readonly id: string, readonly blocks: unknown }[]
  readonly interrupts: string[]
  readonly unsubscribed: string[]
  readonly presenterGet: ReturnType<typeof vi.fn>
  readonly push: (id: string, key: string, value: unknown, seq: number) => void
  readonly switchSession: (id: string | null) => void
  cutError: boolean
  cutReject: boolean
  cutSeq: number
  cutValues: Record<string, unknown>
  failFollowup: boolean
  throwFollowup: boolean
  deferFollowup: boolean
  failInterrupt: boolean
  resolveFollowup: (() => void) | undefined
}

/** Mount the plugin over fakes: real Cordis fiber, in-memory session seams. */
async function mount(options: {
  readonly display?: boolean
  readonly session?: string | null
  readonly tools?: boolean
  readonly cut?: { readonly asOfSeq?: number, readonly values?: Record<string, unknown> }
} = {}): Promise<Harness> {
  const ctx = new Context()
  const screen = new FakeScreen()
  const components = new FakeBlueComponents()
  if (options.display !== false) {
    ctx.provide('blueScreen', screen as never)
    ctx.provide('blueTheme', new FakeTheme() as never)
    ctx.provide('blueKeymap', new FakeKeymap() as never)
    ctx.provide('blueComponents', components as never)
  }
  new EditorHostService(ctx)
  setEditorSlotSwap(ctx, { mount: component => screen.mountDialogPanel(component) })
  // The pre-attach editor holding the dock slot and focus; the handleInput
  // spy proves no key reaches it while a replacement panel holds focus.
  const editor = { focused: false, render: () => ['>'], invalidate: () => {}, handleInput: vi.fn() }
  screen.addBottomChild(editor)
  screen.setFocus(editor)

  const followups: { readonly id: string, readonly blocks: unknown }[] = []
  const interrupts: string[] = []
  const cuts: { readonly id: string, readonly keys: readonly string[] }[] = []
  const unsubscribed: string[] = []
  const childListeners = new Map<string, Set<(key: string, value: unknown, seq: number) => void>>()
  const readerListeners = new Set<(value: unknown) => void>()
  let snapshot: { readonly id: string } | null = options.session === null
    ? null
    : { id: options.session ?? 'agent-1' }
  const harness: Harness = {
    ctx,
    screen,
    components,
    service: undefined as unknown as BlueChildAttachService,
    fiber: undefined as unknown as Harness['fiber'],
    editor,
    cuts,
    followups,
    interrupts,
    unsubscribed,
    presenterGet: vi.fn(() => undefined),
    push: (id, key, value, seq) => {
      // Set iteration tolerates a listener unsubscribing itself mid-dispatch.
      for (const listener of childListeners.get(id) ?? []) listener(key, value, seq)
    },
    switchSession: id => {
      snapshot = id === null ? null : { id }
      for (const listener of readerListeners) listener(snapshot)
    },
    cutError: false,
    cutReject: false,
    cutSeq: options.cut?.asOfSeq ?? 2,
    cutValues: options.cut?.values ?? { blueConversation: conversation('child reply') },
    failFollowup: false,
    throwFollowup: false,
    deferFollowup: false,
    failInterrupt: false,
    resolveFollowup: undefined,
  }
  ctx.provide('blueSessionReader', {
    current: () => snapshot,
    subscribe(listener: (value: unknown) => void) {
      readerListeners.add(listener)
      listener(snapshot)
      return { dispose: () => { readerListeners.delete(listener) } }
    },
  } as never)
  ctx.provide('blueSessionActions', {
    childFollowup: async (id: string, blocks: unknown) => {
      followups.push({ id, blocks })
      if (harness.throwFollowup) throw new Error('delivery exploded')
      if (harness.deferFollowup) {
        await new Promise<void>(resolve => {
          harness.resolveFollowup = () => {
            harness.resolveFollowup = undefined
            resolve()
          }
        })
      }
      return harness.failFollowup
        ? { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'child is busy' }
        : { ok: true, value: { messageId: 'm-1' } }
    },
    interruptChild: (id: string) => {
      interrupts.push(id)
      return harness.failInterrupt
        ? { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'cannot interrupt' }
        : { ok: true, value: undefined }
    },
  } as never)
  ctx.provide('blueSessionProjections', {
    childCut: async (id: string, keys: readonly string[]) => {
      cuts.push({ id, keys })
      if (harness.cutReject) throw new Error('cut went away')
      return harness.cutError
        ? { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'unknown child' }
        : { ok: true, value: { id, live: true, asOfSeq: harness.cutSeq, values: harness.cutValues } }
    },
    subscribeChild: (id: string, listener: (key: string, value: unknown, seq: number) => void) => {
      const bucket = childListeners.get(id) ?? new Set()
      bucket.add(listener)
      childListeners.set(id, bucket)
      return () => {
        bucket.delete(listener)
        unsubscribed.push(id)
      }
    },
  } as never)
  if (options.tools !== false) ctx.provide('blueToolPresentations', { get: harness.presenterGet } as never)
  const fiber = await ctx.plugin(attachViewPlugin)
  harness.service = ctx.blueChildAttach
  harness.fiber = fiber
  return harness
}

/** The attach panel mounted above the editor, if one is live; `overlay.hidden` stays live. */
function attachPanel(harness: Harness): { readonly component: ChildAttachView, readonly overlay: { hidden: boolean } } {
  const overlay = harness.screen.overlays.at(-1)
  expect(overlay).toBeDefined()
  return { component: overlay!.component as ChildAttachView, overlay: overlay! }
}

const continuable: BlueChildAttachTarget = { id: 'c1', label: 'explore', mode: 'continuable' }

describe('metrics helpers', () => {
  it('formats seconds, minutes, and clamps negatives', () => {
    expect(formatAttachElapsed(45_000)).toBe('45s')
    expect(formatAttachElapsed(130_000)).toBe('2m 10s')
    expect(formatAttachElapsed(-5)).toBe('0s')
  })

  it('joins tokens and elapsed, preferring the live clock over the settled one', () => {
    expect(attachMetricsText({}, 1000)).toBe('')
    expect(attachMetricsText({ tokens: 2048 }, 1000)).toBe('2k tok')
    expect(attachMetricsText({ settledMs: 65_000 }, 1000)).toBe('1m 5s')
    expect(attachMetricsText({ tokens: 100, settledMs: 5000, activeSince: 500 }, 3500)).toBe('100 tok · 3s')
  })
})

describe('blueChildAttach service', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens into the editor slot, closes back to the pre-attach editor', async () => {
    const harness = await mount()
    expect(harness.service.active).toBe(false)
    harness.service.open(continuable)
    expect(harness.service.active).toBe(true)
    const panel = attachPanel(harness)
    expect(harness.screen.focused).toBe(panel.component)
    expect(harness.cuts).toEqual([{
      id: 'c1',
      keys: ['blueConversation', 'blueConversationFacts', 'subagentTiming'],
    }])
    await vi.waitFor(() => {
      expect(plain(panel.component.render(80)).some(row => row.includes('child reply'))).toBe(true)
    })
    const rows = plain(panel.component.render(80))
    expect(rows[0]).toContain('Subagent · explore')
    expect(rows[0]).toContain('○ idle')

    harness.service.close()
    expect(harness.service.active).toBe(false)
    expect(panel.overlay.hidden).toBe(true)
    // The pre-attach editor slot state is restored: dock focus returns.
    expect(harness.screen.focused).toBe(harness.editor)
    expect(harness.unsubscribed).toEqual(['c1'])
    // A second close is a no-op.
    harness.service.close()
    expect(harness.unsubscribed).toEqual(['c1'])
  })

  it('closes the previous attach when a second open arrives', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const first = attachPanel(harness)
    harness.service.open({ id: 'c2', mode: 'one-shot' })
    expect(first.overlay.hidden).toBe(true)
    expect(harness.unsubscribed).toEqual(['c1'])
    expect(harness.service.active).toBe(true)
    expect(attachPanel(harness).overlay.hidden).toBe(false)
    await vi.waitFor(() => expect(harness.cuts.map(cut => cut.id)).toEqual(['c1', 'c2']))
    harness.service.close()
  })

  it('degrades to a no-op without the display services, noticing through a live editor', async () => {
    const quiet = await mount({ display: false })
    quiet.service.open(continuable)
    expect(quiet.service.active).toBe(false)
    expect(quiet.screen.overlays).toEqual([])

    const noticing = await mount({ display: false })
    const notice = vi.fn()
    setSharedEditor(noticing.ctx, { editor: {} as never, submitPrompt: () => {}, notice })
    noticing.service.open(continuable)
    expect(noticing.service.active).toBe(false)
    expect(notice).toHaveBeenCalledWith(ATTACH_CHROME.unavailable)
  })

  it('force-closes on a main-session switch or unload', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    harness.switchSession('agent-2')
    expect(harness.service.active).toBe(false)
    expect(panel.overlay.hidden).toBe(true)
    expect(harness.unsubscribed).toEqual(['c1'])

    // A session unload (null snapshot) strands the view the same way.
    harness.service.open(continuable)
    harness.switchSession(null)
    expect(harness.service.active).toBe(false)
    expect(attachPanel(harness).overlay.hidden).toBe(true)
  })

  it('tracks the session from plugin start, including a null initial snapshot', async () => {
    const harness = await mount({ session: null })
    harness.service.open(continuable)
    expect(harness.service.active).toBe(true)
    // The first session arriving while attached is still a switch away from
    // the (absent) session the child id addressed.
    harness.switchSession('agent-1')
    expect(harness.service.active).toBe(false)
  })

  it('force-closes the attach view when the fiber unloads', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    await harness.fiber.dispose()
    expect(harness.service.active).toBe(false)
    expect(panel.overlay.hidden).toBe(true)
    expect(harness.unsubscribed).toEqual(['c1'])
  })
})

describe('ChildAttachView through the service', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders title status and metrics from the initial cut', async () => {
    const harness = await mount({
      cut: {
        asOfSeq: 4,
        values: {
          blueConversation: conversation('initial reply', 4),
          blueConversationFacts: { epochTokens: 512 },
          subagentTiming: { settledMs: 2000 },
        },
      },
    })
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(80)).some(row => row.includes('initial reply'))).toBe(true)
    })
    const title = plain(panel.component.render(80))[0]!
    expect(title).toContain('Subagent · explore')
    expect(title).toContain('○ idle')
    expect(title).toContain('512 tok')
    expect(title).toContain('2s')
    // The continuable footer: an empty buffer shows the placeholder.
    const rows = plain(panel.component.render(80))
    expect(rows.some(row => row.includes(ATTACH_CHROME.placeholder))).toBe(true)
    expect(rows.some(row => row.includes(`continuable · ${ATTACH_CHROME.guidanceFollowup}`))).toBe(true)
    harness.service.close()
  })

  it('contains every row within the render width and degenerates cleanly', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(80)).some(row => row.includes('child reply'))).toBe(true)
    })
    for (const width of [100, 80, 40, 20, 10, 5]) {
      expectLinesFit('attach-view', panel.component.render(width), width)
    }
    // Below the frame-furniture floor the view renders nothing at all.
    expect(panel.component.render(4)).toEqual([])
    expect(panel.component.render(3)).toEqual([])

    // An unknown or non-positive terminal height falls back to the floor budget.
    harness.screen.rows = Number.POSITIVE_INFINITY
    expect(panel.component.render(40)).toHaveLength(1 + 3 + 2)
    harness.screen.rows = 0
    expect(panel.component.render(40)).toHaveLength(1 + 3 + 2)
    harness.service.close()
  })

  it('degrades a one-shot child to read-only and ignores editing input', async () => {
    const harness = await mount()
    harness.service.open({ id: 'c1', mode: 'one-shot' })
    const panel = attachPanel(harness)
    await vi.waitFor(() => expect(harness.screen.renderRequests).toBeGreaterThan(0))
    const rows = plain(panel.component.render(60))
    // Without a label the title falls back to the child id.
    expect(rows[0]).toContain('Subagent · c1')
    expect(rows.some(row => row.includes(ATTACH_CHROME.oneShotReadonly))).toBe(true)
    expect(rows.some(row => row.includes(`one-shot · ${ATTACH_CHROME.guidanceBack}`))).toBe(true)
    panel.component.handleInput('x')
    panel.component.handleInput('\r')
    panel.component.handleInput('\x7f')
    expect(harness.followups).toEqual([])
    expect(plain(panel.component.render(60)).some(row => row.includes('x▌'))).toBe(false)
    harness.service.close()
  })

  it('posts a follow-up on Enter, clears the buffer, and surfaces failures', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    panel.component.handleInput('h')
    panel.component.handleInput('i')
    expect(plain(panel.component.render(60)).some(row => row.includes('hi▌'))).toBe(true)
    panel.component.handleInput('\x7f')
    panel.component.handleInput('!')
    panel.component.handleInput('\r')
    await vi.waitFor(() => expect(harness.followups).toEqual([{ id: 'c1', blocks: [{ type: 'text', text: 'h!' }] }]))
    expect(plain(panel.component.render(60)).some(row => row.includes(ATTACH_CHROME.placeholder))).toBe(true)

    // A whitespace-only buffer submits nothing.
    panel.component.handleInput(' ')
    panel.component.handleInput('\r')
    expect(harness.followups).toHaveLength(1)

    // q with a pending buffer types instead of closing; escape sequences and
    // control bytes never enter the buffer.
    panel.component.handleInput('q')
    expect(harness.service.active).toBe(true)
    panel.component.handleInput(KEY.up)
    panel.component.handleInput('\x01')
    expect(plain(panel.component.render(60)).some(row => row.includes(' q▌'))).toBe(true)
    panel.component.handleInput('\x7f')
    panel.component.handleInput('\x7f')
    expect(plain(panel.component.render(60)).some(row => row.includes(ATTACH_CHROME.placeholder))).toBe(true)

    // A failed follow-up keeps the host's message in the footer.
    harness.failFollowup = true
    panel.component.handleInput('a')
    panel.component.handleInput('\r')
    await vi.waitFor(() => {
      expect(plain(panel.component.render(60)).some(row => row.includes('child is busy'))).toBe(true)
    })

    // A rejecting follow-up is swallowed without taking the panel down.
    harness.failFollowup = false
    harness.throwFollowup = true
    panel.component.handleInput('b')
    panel.component.handleInput('\r')
    await vi.waitFor(() => expect(harness.followups).toHaveLength(3))
    expect(harness.service.active).toBe(true)
    harness.service.close()
  })

  it('ignores a follow-up that resolves after the view closed', async () => {
    const harness = await mount()
    harness.deferFollowup = true
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    panel.component.handleInput('z')
    panel.component.handleInput('\r')
    await vi.waitFor(() => expect(harness.followups).toHaveLength(1))
    harness.service.close()
    harness.resolveFollowup?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(harness.service.active).toBe(false)
    harness.service.open(continuable)
    harness.service.close()
  })

  it('Ctrl+C clears the input first and otherwise interrupts the child', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    panel.component.handleInput('a')
    panel.component.handleInput('b')
    expect(plain(panel.component.render(60)).some(row => row.includes('ab▌'))).toBe(true)
    panel.component.handleInput(KEY.ctrlC)
    expect(harness.interrupts).toEqual([])
    expect(plain(panel.component.render(60)).some(row => row.includes('ab▌'))).toBe(false)
    panel.component.handleInput(KEY.ctrlC)
    expect(harness.interrupts).toEqual(['c1'])

    harness.failInterrupt = true
    panel.component.handleInput(KEY.ctrlC)
    expect(plain(panel.component.render(60)).some(row => row.includes('cannot interrupt'))).toBe(true)
    harness.service.close()
  })

  it('q with an empty buffer and Escape both close; input after close is ignored', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const first = attachPanel(harness)
    first.component.handleInput('q')
    expect(harness.service.active).toBe(false)
    expect(first.overlay.hidden).toBe(true)
    expect(harness.screen.focused).toBe(harness.editor)
    first.component.handleInput('x')
    expect(harness.followups).toEqual([])

    harness.service.open(continuable)
    const second = attachPanel(harness)
    second.component.handleInput(KEY.escape)
    expect(harness.service.active).toBe(false)
    expect(second.overlay.hidden).toBe(true)
  })

  it('follows live pushes, rejecting stale seqs and malformed values', async () => {
    const harness = await mount()
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(80)).some(row => row.includes('child reply'))).toBe(true)
    })

    // A stale push is rejected by the watermark.
    harness.push('c1', 'blueConversation', conversation('stale reply', 1), 1)
    expect(plain(panel.component.render(80)).some(row => row.includes('stale reply'))).toBe(false)

    // Malformed or off-shape values are skipped without disturbing state.
    harness.push('c1', 'blueConversation', { entries: 'bogus' }, 5)
    expect(plain(panel.component.render(80)).some(row => row.includes('child reply'))).toBe(true)
    harness.push('c1', 'blueConversationFacts', { epochTokens: 'many' }, 6)
    harness.push('c1', 'subagentTiming', { settledMs: 'late', active: { since: 'soon' } }, 7)
    harness.push('c1', 'subagentTiming', null, 8)
    harness.push('c1', 'unrelated', {}, 9)
    expect(plain(panel.component.render(80)).some(row => row.includes('child reply'))).toBe(true)

    // A fresh push re-renders with the new transcript and facts.
    harness.push('c1', 'blueConversationFacts', { epochTokens: 4096 }, 10)
    harness.push('c1', 'blueConversation', conversation('live reply', 11), 11)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(80)).some(row => row.includes('live reply'))).toBe(true)
    })
    expect(plain(panel.component.render(80))[0]).toContain('4k tok')
    harness.service.close()
  })

  it('a cut resolving behind live pushes neither clobbers the model nor rewinds the watermark', async () => {
    const harness = await mount({
      cut: {
        asOfSeq: 2,
        values: {
          blueConversation: conversation('stale cut', 2),
          blueConversationFacts: { epochTokens: 512 },
        },
      },
    })
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    // A push lands synchronously while the cut's promise is still in flight.
    harness.push('c1', 'blueConversation', conversation('fresh push', 5), 5)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(80)).some(row => row.includes('fresh push'))).toBe(true)
    })
    // The late cut must not restore its older conversation state, while keys
    // no push covered still seed from it (per-key watermarks).
    const rows = plain(panel.component.render(80))
    expect(rows.some(row => row.includes('stale cut'))).toBe(false)
    expect(rows[0]).toContain('512 tok')
    // And an in-between seq stays stale after the cut resolved.
    harness.push('c1', 'blueConversation', conversation('stale reply', 3), 3)
    expect(plain(panel.component.render(80)).some(row => row.includes('stale reply'))).toBe(false)
    harness.service.close()
  })

  it('surfaces a failed initial cut in the footer and swallows a rejecting one', async () => {
    const failing = await mount()
    failing.cutError = true
    failing.service.open(continuable)
    const failedPanel = attachPanel(failing)
    await vi.waitFor(() => {
      expect(plain(failedPanel.component.render(60)).some(row => row.includes('unknown child'))).toBe(true)
    })
    failing.service.close()

    const rejecting = await mount()
    rejecting.cutReject = true
    rejecting.service.open(continuable)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rejecting.service.active).toBe(true)
    rejecting.service.close()
  })

  it('resolves tool cards through the presentation seam or its fallback', async () => {
    const harness = await mount({ cut: { values: { blueConversation: conversationWithTool() } } })
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    await vi.waitFor(() => {
      expect(harness.presenterGet).toHaveBeenCalledWith('bash')
    })
    // The generic bash card renders the presentation title and the command.
    expect(plain(panel.component.render(80)).some(row => row.includes('Running a command'))).toBe(true)
    harness.service.close()

    // Without the seam the generic fallback cards still render.
    const toolless = await mount({ tools: false, cut: { values: { blueConversation: conversationWithTool() } } })
    toolless.service.open(continuable)
    const fallbackPanel = attachPanel(toolless)
    await vi.waitFor(() => {
      expect(plain(fallbackPanel.component.render(80)).some(row => row.includes('Running a command'))).toBe(true)
    })
    toolless.service.close()
  })

  it('ticks the elapsed clock while running and disarms on settle', async () => {
    vi.useFakeTimers()
    const harness = await mount({
      cut: { values: { blueConversation: conversation('child reply'), subagentTiming: { active: { since: 1000 } } } },
    })
    harness.service.open(continuable)
    const panel = attachPanel(harness)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(80))[0]).toContain('● running')
    })
    const before = harness.screen.renderRequests
    vi.advanceTimersByTime(1000)
    expect(harness.screen.renderRequests).toBeGreaterThan(before)

    // The settle push stops the clock; the next tick disarms instead of painting.
    harness.push('c1', 'subagentTiming', { settledMs: 9000 }, 5)
    const settled = harness.screen.renderRequests
    vi.advanceTimersByTime(3000)
    expect(harness.screen.renderRequests).toBe(settled)
    expect(plain(panel.component.render(80))[0]).toContain('○ idle')
    harness.service.close()
  })

  it('re-arms the ticker when a settled child starts a new turn', async () => {
    vi.useFakeTimers()
    const harness = await mount({ cut: { values: { subagentTiming: { settledMs: 2000 } } } })
    harness.service.open(continuable)
    await vi.waitFor(() => expect(harness.cuts).toHaveLength(1))
    vi.advanceTimersByTime(2000)
    const before = harness.screen.renderRequests
    harness.push('c1', 'subagentTiming', { active: { since: 1000 } }, 5)
    const armed = harness.screen.renderRequests
    vi.advanceTimersByTime(1000)
    expect(harness.screen.renderRequests).toBeGreaterThan(armed)
    expect(armed).toBeGreaterThan(before)
    harness.service.close()
  })
})

describe('ChildAttachView scrolling', () => {
  const pageUp = '\x1b[5~'
  const pageDown = '\x1b[6~'

  /** Open one attach over a 12-turn cut and wait for the tail frame. */
  async function openLong(target: BlueChildAttachTarget = continuable): Promise<{ harness: Harness, panel: ReturnType<typeof attachPanel> }> {
    const harness = await mount({
      cut: { asOfSeq: 24, values: { blueConversation: longConversation(12) } },
    })
    harness.service.open(target)
    const panel = attachPanel(harness)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(40)).some(row => row.includes('reply 11'))).toBe(true)
    })
    expect(plain(panel.component.render(40)).some(row => row.includes('line 0'))).toBe(false)
    return { harness, panel }
  }

  it('scrolls the transcript window by line and page, clamped at both bounds', async () => {
    const { harness, panel } = await openLong()
    // The editor left the dock slot when the panel mounted: it is unfocused
    // and no scroll key can reach its history while the panel is attached.
    expect(harness.editor.focused).toBe(false)
    // The wheel arrives as these same arrow sequences through core's dock
    // route, so keyboard and wheel share this path.
    const following = plain(panel.component.render(40))
    panel.component.handleInput(KEY.up)
    expect(plain(panel.component.render(40))).not.toEqual(following)
    expect(harness.editor.handleInput).not.toHaveBeenCalled()

    // A page up drops the tail row; repeated pages reach the top and clamp.
    panel.component.handleInput(pageUp)
    expect(plain(panel.component.render(40)).some(row => row.includes('reply 11'))).toBe(false)
    for (let count = 0; count < 10; count += 1) panel.component.handleInput(pageUp)
    const topRows = plain(panel.component.render(40))
    expect(topRows.some(row => row.includes('line 0'))).toBe(true)
    const pinned = harness.screen.renderRequests
    for (let count = 0; count < 30; count += 1) panel.component.handleInput(KEY.up)
    expect(harness.screen.renderRequests).toBe(pinned)
    expect(plain(panel.component.render(40)).some(row => row.includes('line 0'))).toBe(true)

    // Pages and lines back down restore the tail; Down at the bottom is inert.
    panel.component.handleInput(pageDown)
    panel.component.handleInput(pageDown)
    panel.component.handleInput(pageDown)
    for (let count = 0; count < 200; count += 1) panel.component.handleInput(KEY.down)
    expect(plain(panel.component.render(40)).some(row => row.includes('reply 11'))).toBe(true)
    const bottom = harness.screen.renderRequests
    panel.component.handleInput(KEY.down)
    expect(harness.screen.renderRequests).toBe(bottom)
    harness.service.close()
  })

  it('holds a scrolled viewport on live pushes and follows again at the tail', async () => {
    const { harness, panel } = await openLong()
    for (let count = 0; count < 10; count += 1) panel.component.handleInput(pageUp)
    const parked = plain(panel.component.render(40))
    expect(parked.some(row => row.includes('line 0'))).toBe(true)

    // A live push below a scrolled-away viewport keeps its rows stable.
    harness.push('c1', 'blueConversation', longConversation(13), 26)
    expect(plain(panel.component.render(40))).toEqual(parked)

    // Scrolled back to the tail, the next push follows it.
    for (let count = 0; count < 200; count += 1) panel.component.handleInput(KEY.down)
    expect(plain(panel.component.render(40)).some(row => row.includes('reply 12'))).toBe(true)
    harness.push('c1', 'blueConversation', longConversation(14), 28)
    await vi.waitFor(() => {
      expect(plain(panel.component.render(40)).some(row => row.includes('reply 13'))).toBe(true)
    })
    harness.service.close()
  })

  it('scrolls the one-shot read-only form without touching the footer', async () => {
    const { harness, panel } = await openLong({ id: 'c1', mode: 'one-shot' })
    for (let count = 0; count < 10; count += 1) panel.component.handleInput(pageUp)
    const rows = plain(panel.component.render(40))
    expect(rows.some(row => row.includes('line 0'))).toBe(true)
    expect(rows.some(row => row.includes(ATTACH_CHROME.oneShotReadonly))).toBe(true)
    harness.service.close()
  })
})

describe('ChildAttachView guards', () => {
  /** Mount one view directly over in-memory seams. */
  function viewHarness(target: BlueChildAttachTarget): {
    readonly view: ChildAttachView
    readonly closed: () => boolean
    readonly unsubscribed: () => boolean
  } {
    const screen = new FakeScreen()
    let closedFlag = false
    let unsubscribedFlag = false
    const view = new ChildAttachView({
      target,
      screen: screen as never,
      components: new FakeBlueComponents() as never,
      colors: new FakeTheme().colors,
      t: key => key,
      projections: {
        childCut: async () => ({ ok: true, value: { id: target.id, live: true, asOfSeq: 0, values: {} } }),
        subscribeChild: () => () => {
          unsubscribedFlag = true
        },
      } as never,
      actions: {
        childFollowup: async () => ({ ok: true, value: { messageId: 'm-1' } }),
        interruptChild: () => ({ ok: true, value: undefined }),
      } as never,
      tools: { get: () => undefined },
      onClose: () => {
        closedFlag = true
      },
    })
    return { view, closed: () => closedFlag, unsubscribed: () => unsubscribedFlag }
  }

  it('keeps open idempotent and disposal safe at every point', async () => {
    const harness = viewHarness(continuable)
    // Disposal before open is safe; a later open is rejected.
    harness.view.dispose()
    harness.view.open()
    expect(harness.unsubscribed()).toBe(false)

    const live = viewHarness(continuable)
    live.view.open()
    live.view.open()
    await vi.waitFor(() => expect(live.view.render(60).length).toBeGreaterThan(0))
    // Disposal is idempotent and unsubscribes exactly once.
    live.view.dispose()
    live.view.dispose()
    expect(live.unsubscribed()).toBe(true)
    // Input after dispose is ignored.
    live.view.handleInput('q')
    expect(live.closed()).toBe(false)
  })

  it('drops a cut that resolves after the view closed', async () => {
    const harness = viewHarness(continuable)
    harness.view.open()
    harness.view.dispose()
    await Promise.resolve()
    await Promise.resolve()
    expect(plain(harness.view.render(60)).some(row => row.includes('child reply'))).toBe(false)
  })
})
