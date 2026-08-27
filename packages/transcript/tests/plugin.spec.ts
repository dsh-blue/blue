/**
 * REAL-composition test: boot the blue-transcript plugin — plus the
 * `blue-status-basic` subpath plugin and, for the acceptance case, a
 * downstream fixture plugin registering its own `blueStatus` entry — through
 * the real Loader from a cordis.yml in a temp directory, over fake
 * `blueScreen` / `blueTheme` / `blueComponents` / `blueSession` services,
 * then drive it with `'test/session-changed'` and `'session/event'` exactly
 * as the app package and session service will.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type {
  BlueComponent,
  BlueKeyAction,
  BlueKeymap,
  BlueOverlayHandle,
  BlueScreen,
} from '@dsh-blue/blue-core'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { StatusModel } from '@dsh-blue/blue-frontend'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  ACTION_TOGGLE_COLLAPSE,
  apply,
} from '../src/index.ts'
import { createTranscriptModel, type TranscriptModelService } from '../src/transcript-model.ts'
import * as statusBasicModel from '../src/status-basic-model.ts'
import * as officialModel from '../src/official-model.ts'
import { setThinkingTimers, type ThinkingTimers } from '../src/thinking.ts'
import {
  assistantEvent,
  fakeBlueComponents,
  imageBlock,
  reasoningDelta,
  retractionEvent,
  resetSeq,
  stepStart,
  subagentCallEvent,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  turnEnd,
  turnStart,
  userEvent,
} from './helpers.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { FakeProjectionService } from './pane-fakes.ts'

registerTempDirCleanup()

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  setThinkingTimers(undefined)
})

/** Identity colors so rendered assertions see structure, not escape codes. */
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
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Records mounts and render requests; renders nothing anywhere real. */
class FakeScreen implements BlueScreen {
  readonly children: BlueComponent[] = []
  readonly bottomChildren: BlueComponent[] = []
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80
  readonly rows = 24

  addChild(component: BlueComponent): () => void {
    this.children.push(component)
    return () => {
      this.removeChild(component)
    }
  }

  addBottomChild(component: BlueComponent): () => void {
    this.bottomChildren.push(component)
    return () => {
      const index = this.bottomChildren.indexOf(component)
      if (index !== -1) this.bottomChildren.splice(index, 1)
    }
  }

  removeChild(component: BlueComponent): void {
    const index = this.children.indexOf(component)
    if (index !== -1) this.children.splice(index, 1)
  }

  setFocus(): void {}

  showOverlay(): BlueOverlayHandle {
    throw new Error('overlays are out of scope for the transcript')
  }

  requestRender(force?: boolean): void {
    this.renderRequests.push(force)
  }

  contentChanged(): boolean {
    this.requestRender()
    return false
  }

  /** S31 seam: pass-through; the transcript suite never suspends the screen. */
  suspend<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  setTitle(): void {}
}

/** Records keymap registrations; handlers are invoked manually by specs. */
class FakeKeymap implements BlueKeymap {
  readonly actions: BlueKeyAction[] = []
  readonly unregistered: BlueKeyAction[][] = []

  register(actions: BlueKeyAction[]): () => void {
    this.actions.push(...actions)
    let done = false
    return () => {
      if (done) return
      done = true
      this.unregistered.push(actions)
    }
  }

  matches(): boolean {
    throw new Error('fake matches is out of scope for transcript tests')
  }

  dispatch(): boolean {
    throw new Error('fake dispatch is out of scope for transcript tests')
  }

  getKeys(): string[] {
    throw new Error('fake getKeys is out of scope for transcript tests')
  }

  list(): readonly BlueKeyAction[] {
    throw new Error('fake list is out of scope for transcript tests')
  }
}

/** Structural stand-in for the real `Agent`; cast at the typed emit sites. */
interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  options: { model?: string }
  session: {
    id: string
    events: SessionEvent[]
    header: { cwd?: string }
    requestHeader(): { config: { model: string } } | undefined
  }
}

/** A fake agent whose session is a plain event-log object. */
function fakeAgent(events: SessionEvent[], model = 'deepseek-chat'): FakeAgent {
  return {
    id: 'parent-1',
    status: 'idle',
    options: { model },
    session: {
      id: 'parent-1',
      events,
      header: {},
      requestHeader: () => undefined,
    },
  }
}

/** Narrow a fake to the app-owned event payload type. */
function asAgent(fake: FakeAgent): Agent {
  return fake as unknown as Agent
}

interface Harness {
  ctx: Context
  screen: FakeScreen
  keymap: FakeKeymap
}

/** The downstream fixture's apply: registers one custom footer entry. */
function fixtureApply(ctx: Context): void {
  ctx.effect(() => ctx.blueStatusModels.register({
    kind: 'status', id: 'blue.status.fixture', priority: 30,
    view: { kind: 'text', text: 'fixture-entry', tone: 'muted' }, visible: true,
  } satisfies StatusModel))
}

/**
 * Boot a real Loader tree whose entry rows delegate to the source-plane
 * plugins already imported by this test (the Loader imports through Node's
 * resolver, which cannot reach tsconfig paths): blue-transcript,
 * blue-status-basic, and — with `fixture` — a downstream plugin registering
 * a custom `blueStatus` entry.
 * @param current - agent preloaded into the test reader, if any.
 * @param options.fixture - append the downstream status-entry fixture row.
 * @param options.settings - fake settings sections keyed by namespace.
 */
async function bootTranscript(
  current: FakeAgent | null = null,
  options: { fixture?: boolean, tools?: Record<string, unknown>, sessionEpoch?: number, settings?: Record<string, unknown>, attachments?: unknown } = {},
): Promise<Harness> {
  const dir = mkdtempTracked('dsh-blue-transcript-')
  writeFileSync(join(dir, 'blue-transcript.mjs'), `
export const name = 'blue-transcript'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'blueSessionReader', 'blueSessionProjections']
export const apply = ctx => globalThis.__blueTranscriptApply(ctx)
`)
  writeFileSync(join(dir, 'blue-status-basic.mjs'), `
export const name = 'blue-status-basic-model'
export const inject = ['blueStatusModels', 'blueSessionFacts']
export const apply = ctx => globalThis.__blueStatusBasicApply(ctx)
`)
  writeFileSync(join(dir, 'blue-transcript-official.mjs'), `
export const name = 'blue-transcript-official'
export const inject = ['blueConversationProjection', 'blueSessionProjections', 'blueSessionReader', 'blueTranscriptModels', 'blueToolPresentations']
export const apply = ctx => globalThis.__blueTranscriptOfficialApply(ctx)
`)
  writeFileSync(join(dir, 'blue-status-fixture.mjs'), `
export const name = 'blue-status-fixture'
export const inject = ['blueStatusModels']
export const apply = ctx => globalThis.__blueStatusFixtureApply(ctx)
`)
  const rows = [
    '- id: blue-transcript',
    `  name: ${pathToFileURL(join(dir, 'blue-transcript.mjs')).href}`,
    '- id: blue-transcript-official',
    `  name: ${pathToFileURL(join(dir, 'blue-transcript-official.mjs')).href}`,
    '- id: blue-status-basic',
    `  name: ${pathToFileURL(join(dir, 'blue-status-basic.mjs')).href}`,
  ]
  if (options.fixture === true) {
    rows.push(
      '- id: blue-status-fixture',
    `  name: ${pathToFileURL(join(dir, 'blue-status-fixture.mjs')).href}`,
    )
  }
  writeFileSync(join(dir, 'cordis.yml'), [...rows, ''].join('\n'))
  const globals = globalThis as unknown as {
    __blueTranscriptApply: typeof apply
    __blueTranscriptOfficialApply: typeof officialModel.apply
    __blueStatusBasicApply: typeof statusBasicModel.apply
    __blueStatusFixtureApply: typeof fixtureApply
  }
  globals.__blueTranscriptApply = apply
  globals.__blueTranscriptOfficialApply = officialModel.apply
  globals.__blueStatusBasicApply = statusBasicModel.apply
  globals.__blueStatusFixtureApply = fixtureApply

  const ctx = new Context()
  const screen = new FakeScreen()
  const keymap = new FakeKeymap()
  const projections = new FakeProjectionService()
  let active = current
  const sessionListeners = new Set<(session: { id: string, cwd: string, status: 'idle' | 'running', mode: 'normal', model: { id: string } } | null) => void>()
  const projectionListeners = new Set<(key: string, value: unknown, seq: number) => void>()
  const sessionSnapshot = () => active === null ? null : {
    id: active.id,
    cwd: active.session.header.cwd ?? process.cwd(),
    status: active.status,
    mode: 'normal' as const,
    model: { id: active.options.model ?? 'deepseek-chat' },
  }
  const blueSessionReader = {
    current: sessionSnapshot,
    subscribe(listener: (session: ReturnType<typeof sessionSnapshot>) => void) {
      sessionListeners.add(listener)
      listener(sessionSnapshot())
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() { disposed = true; sessionListeners.delete(listener) },
      }
    },
  }
  const blueSessionProjections = {
    current(key: string) {
      if (active === null) return undefined
      const snapshot = projections.snapshot(active.session)
      return { asOfSeq: snapshot.asOfSeq, value: snapshot.values[key] }
    },
    currentMany(keys: readonly string[]) {
      if (active === null) return undefined
      const snapshot = projections.snapshot(active.session)
      return { asOfSeq: snapshot.asOfSeq, values: Object.fromEntries(keys.map(key => [key, snapshot.values[key]])) }
    },
    subscribe(listener: (key: string, value: unknown, seq: number) => void) {
      projectionListeners.add(listener)
      return () => { projectionListeners.delete(listener) }
    },
    children: () => [],
    subscribeChildren: () => () => {},
  }
  const serviceNames: Record<string, unknown> = {
    blueScreen: screen,
    blueTheme: { colors: COLORS },
    blueComponents: fakeBlueComponents(),
    blueKeymap: keymap,
    blueSessionReader,
    blueSessionProjections,
    sessionProjections: projections,
    blueConversationProjection: { key: 'blueConversation' },
    tools: { get: (name: string) => options.tools?.[name] },
    blueToolPresentations: { bind: () => {}, get: (name: string) => options.tools?.[name] },
    ...(options.sessionEpoch === undefined ? {} : { blueRequests: { sessionEpoch: options.sessionEpoch } }),
    ...(options.settings === undefined ? {} : { settings: { get: (ns: string) => options.settings?.[ns] } }),
    ...(options.attachments === undefined ? {} : { attachments: options.attachments }),
  }
  for (const [serviceName, value] of Object.entries(serviceNames)) {
    ctx.reflect.provide(serviceName, value)
  }
  ctx.on('test/session-changed', (next) => {
    active = next as unknown as FakeAgent
    for (const listener of sessionListeners) listener(sessionSnapshot())
  })
  ctx.on('session/event', (session, event) => projections.emit(session, event))
  projections.onChanged((session, key, value, seq) => {
    if (session !== active?.session) return
    for (const listener of projectionListeners) listener(key, value, seq)
  })

  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, screen, keymap }
}

/**
 * The transcript's content components (the footer lives in bottomChildren),
 * with the kimi gutter column the mount layer wraps every surface in
 * stripped — the gutter itself is asserted by its dedicated case below.
 */
function contentLines(screen: FakeScreen): string[] {
  return stripGutter(screen.children.flatMap(component => component.render(80)))
}

/** The footer shell's rendered rows, gutter-stripped like {@link contentLines}. */
function footerLines(screen: FakeScreen): string[] {
  return stripGutter(screen.bottomChildren.flatMap(component => component.render(80)))
}

/** Remove the mount layer's one-column kimi gutter from rendered rows. */
function stripGutter(lines: string[]): string[] {
  return lines.map(line => line === ' ' ? '' : line.slice(1))
}

describe('blue-transcript plugin through the real Loader', () => {
  it('applies model settings and exposes the live expansion range', async () => {
    const { ctx } = await bootTranscript(null, { settings: { blue: { collapseToolCalls: false } } })
    expect(ctx.blueTranscriptModels.presentationPolicy().expandTurns).toBe(3)
    expect(ctx.blueTranscriptModels.presentationPolicy().toolsExpanded).toBe(true)
    ctx.emit('settings/updated', 'blue' as SettingsNamespace, { expandTurns: 2, userFoldLines: 12 }, {}, 'provider')
    expect(ctx.blueTranscriptModels.presentationPolicy().expandTurns).toBe(2)
  })

  it('keeps projected image placeholders when the attachment loader fails', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, {
      attachments: { readImage: async () => { throw new Error('missing image') } },
    })
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      userEvent('pic', [imageBlock({ attachmentId: 'a1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } as never)]),
    ])))
    expect(contentLines(screen).some(line => line.includes('[image]'))).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(contentLines(screen).some(line => line.includes('[image]'))).toBe(true)
  })

  it('mounts only the empty footer before any session exists', async () => {
    const { screen } = await bootTranscript()
    expect(screen.children).toHaveLength(1)
    expect(screen.bottomChildren).toHaveLength(1)
    expect(footerLines(screen)).toEqual([])
  })

  it('insets every mounted surface by the kimi one-column gutter (D29)', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      userEvent('hi'),
      assistantEvent(1, 1, [{ type: 'text', text: 'answer' }]),
    ])))
    // Every transcript row gains the leading gutter column; the footer
    // shell's full-width rows do too (the wrapper squeezes the child to
    // `width - 2`, the squeeze being the right margin).
    const rawContent = screen.children.flatMap(component => component.render(80))
    expect(rawContent).toEqual([' ', ' \x1b[1m» \x1b[22m\x1b[1mhi\x1b[22m', ' ', ' ● answer'])
    const rawFooter = screen.bottomChildren.flatMap(component => component.render(80))
    expect(rawFooter).toEqual([` deepseek-chat${' '.repeat(65)}`])
  })

  it('renders history and the footer status on test/session-changed', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    // Simulate the app emitting after create: with no listener-visible
    // history the plugin still mounts from the service reference.
    const agent = fakeAgent([userEvent('hi'), assistantEvent(1, 1, [{ type: 'text', text: 'answer' }])])
    ctx.emit('test/session-changed', asAgent(agent))
    expect(screen.children).toHaveLength(1)
    expect(footerLines(screen)).toEqual([`deepseek-chat${' '.repeat(65)}`])
    expect(contentLines(screen)).toEqual(['', '\x1b[1m» \x1b[22m\x1b[1mhi\x1b[22m', '', '● answer'])
    expect(screen.renderRequests.length).toBeGreaterThan(0)
    expect(ctx.blueSessionReader.current()?.id).toBe(agent.id)
  })

  it('renders a pre-existing current agent without waiting for the event', async () => {
    resetSeq()
    const { screen } = await bootTranscript(fakeAgent([userEvent('remember me')]))
    expect(screen.children).toHaveLength(1)
    expect(contentLines(screen)).toEqual(['', '\x1b[1m» \x1b[22m\x1b[1mremember me\x1b[22m'])
    expect(footerLines(screen)[0]).toContain('deepseek-chat')
  })

  it('lets a downstream plugin register its own footer entry', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { fixture: true })
    ctx.emit('test/session-changed', asAgent(fakeAgent([])))
    const footer = footerLines(screen)
    expect(footer).toHaveLength(1)
    expect(footer[0]).toContain('deepseek-chat')
    expect(footer[0]).toContain('fixture-entry')
  })

  it('streams chunks, pairs tool calls, and dedupes by snapshot seq', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    const seeded = [userEvent('work'), toolCallEvent(1, 1, 'c1', 'bash', '{"command":"ls"}')]
    const agent = fakeAgent(seeded)
    ctx.emit('test/session-changed', asAgent(agent))
    expect(screen.children).toHaveLength(1)
    const renderBaseline = screen.renderRequests.length

    // Stale replay at or below the snapshot's last seq is dropped.
    ctx.emit('session/event', agent.session as unknown as Session, { ...textDelta(1, 1, 'stale'), seq: 1 })
    const stale = seeded[seeded.length - 1]!
    ctx.emit('session/event', agent.session as unknown as Session, { ...stale })
    expect(screen.children).toHaveLength(1)
    expect(screen.renderRequests.length).toBe(renderBaseline)

    // Events for another session are ignored.
    const other = fakeAgent([])
    ctx.emit('session/event', other.session as unknown as Session, textDelta(9, 9, 'foreign'))
    expect(screen.children).toHaveLength(1)

    // Live chunk: mounts a streaming assistant component and re-renders. The
    // footer's model text is untouched — no agent-status noise any more.
    agent.status = 'running'
    ctx.emit('session/event', agent.session as unknown as Session, textDelta(2, 1, 'partial'))
    expect(screen.children).toHaveLength(1)
    expect(screen.renderRequests.length).toBeGreaterThan(renderBaseline)
    expect(contentLines(screen)).toContain('● partial')
    expect(footerLines(screen)[0]).toContain('deepseek-chat')

    // Finalization rewrites the streaming item in place.
    ctx.emit('session/event', agent.session as unknown as Session, assistantEvent(2, 1, [{ type: 'text', text: 'final' }]))
    expect(screen.children).toHaveLength(1)
    expect(contentLines(screen)).toContain('● final')

    // The seeded tool call pairs with its live result.
    ctx.emit('session/event', agent.session as unknown as Session, toolResultEvent(2, 1, 'c1', 'file.txt'))
    expect(screen.children).toHaveLength(1)
    expect(contentLines(screen).join('\n')).toContain('Ran a command')
    expect(contentLines(screen).join('\n')).toContain('$ ls')
  })

  it.skip('rejects an interrupted lifecycle event from a stale session epoch', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { sessionEpoch: 2 })
    const agent = fakeAgent([])
    ctx.emit('test/session-changed', asAgent(agent))
    const baseline = screen.renderRequests.length
    ctx.emit('blue/request-state-changed', {
      ref: { sessionEpoch: 1, requestEpoch: 1, scope: 'main' },
      state: 'interrupted',
    })
    expect(screen.children).toHaveLength(1)
    expect(screen.renderRequests).toHaveLength(baseline)
  })

  it.skip('projects an interrupted lifecycle event from the current session epoch', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { sessionEpoch: 2 })
    ctx.emit('test/session-changed', asAgent(fakeAgent([])))
    const baseline = screen.renderRequests.length
    ctx.emit('blue/request-state-changed', {
      ref: { sessionEpoch: 2, requestEpoch: 1, scope: 'main' },
      state: 'interrupted',
    })
    expect(contentLines(screen)).toContain('■ interrupted')
    expect(screen.renderRequests).toHaveLength(baseline + 1)
  })

  it.skip('removes a safely retracted live turn without an Interrupted tombstone', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { sessionEpoch: 2 })
    const agent = fakeAgent([])
    ctx.emit('test/session-changed', asAgent(agent))
    ctx.emit('session/event', agent.session as unknown as Session, turnStart(4))
    ctx.emit('session/event', agent.session as unknown as Session, userEvent('bring this back'))
    ctx.emit('session/event', agent.session as unknown as Session, stepStart(4, 1))
    ctx.emit('session/event', agent.session as unknown as Session, reasoningDelta(4, 1, 'discard me'))
    expect(contentLines(screen).join('\n')).toContain('bring this back')

    ctx.emit('blue/turn-retracted', { sessionEpoch: 2, requestEpoch: 1, turn: 4 })
    expect(contentLines(screen).join('\n')).not.toContain('bring this back')
    expect(contentLines(screen).join('\n')).not.toContain('discard me')
    ctx.emit('session/event', agent.session as unknown as Session, turnEnd(4, { kind: 'aborted' }))
    expect(contentLines(screen)).not.toContain('■ interrupted')
  })

  it.skip('rejects a retraction signal from a stale session epoch', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { sessionEpoch: 3 })
    const agent = fakeAgent([turnStart(1), userEvent('still visible')])
    ctx.emit('test/session-changed', asAgent(agent))
    ctx.emit('blue/turn-retracted', { sessionEpoch: 2, requestEpoch: 1, turn: 1 })
    expect(contentLines(screen).join('\n')).toContain('still visible')
  })

  it.skip('hides a durably retracted turn on the initial session snapshot', async () => {
    resetSeq()
    const start = turnStart(1)
    const user = userEvent('withdrawn snapshot')
    const end = turnEnd(1, { kind: 'aborted' })
    const marker = retractionEvent(1, 0, user.seq, user.seq)
    const { ctx, screen } = await bootTranscript(null)
    ctx.emit('test/session-changed', asAgent(fakeAgent([start, user, end, marker])))
    expect(contentLines(screen).join('\n')).not.toContain('withdrawn snapshot')
    expect(contentLines(screen)).not.toContain('■ interrupted')
  })

  it('mounts live thinking above the answer, finalizes it in place, and joins ctrl+o', async () => {
    resetSeq()
    const timers = new (class implements ThinkingTimers {
      readonly ticks: (() => void)[] = []
      cleared = 0
      setInterval(callback: () => void): ReturnType<typeof setInterval> {
        this.ticks.push(callback)
        return this.ticks.length as unknown as ReturnType<typeof setInterval>
      }
      clearInterval(): void {
        this.cleared += 1
      }
    })()
    setThinkingTimers(timers)
    const { ctx, screen, keymap } = await bootTranscript()
    const agent = fakeAgent([])
    ctx.emit('test/session-changed', asAgent(agent))

    // The reasoning stream mounts its own live block: spinner row plus the
    // tail window, and the spinner timer is running.
    const SIX_LINES = 'one\ntwo\nthree\nfour\nfive\nsix'
    ctx.emit('session/event', agent.session as unknown as Session, reasoningDelta(1, 1, SIX_LINES))
    expect(screen.children).toHaveLength(1)
    let lines = contentLines(screen)
    expect(lines[1]).toBe('⠋ thinking...')
    expect(lines.at(-1)).toBe(`  \x1b[3msix\x1b[23m`)
    expect(timers.ticks).toHaveLength(1)

    // While still live, a tick advances the frame and requests a redraw
    // through the mounter's injected nudge.
    const renderBaseline = screen.renderRequests.length
    timers.ticks[0]!()
    expect(contentLines(screen)[1]).toBe('⠙ thinking...')
    expect(screen.renderRequests.length).toBe(renderBaseline + 1)

    // The answer streams in below the thinking block.
    ctx.emit('session/event', agent.session as unknown as Session, textDelta(1, 1, 'answer'))
    expect(screen.children).toHaveLength(1)

    // Finalization settles the thinking block in place — no remount — and
    // folds the body to the preview plus the expansion hint.
    ctx.emit('session/event', agent.session as unknown as Session, assistantEvent(1, 1, [
      { type: 'reasoning', text: SIX_LINES },
      { type: 'text', text: 'answer' },
    ]))
    expect(screen.children).toHaveLength(1)
    lines = contentLines(screen)
    expect(lines[1]).toBe('● \x1b[3mone\x1b[23m')
    expect(lines.join('\n')).toContain('more lines, ctrl+o to expand')

    // The shared Ctrl-O toggle opens the thinking body.
    const toggle = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)?.handler
    expect(typeof toggle).toBe('function')
    toggle!()
    expect(contentLines(screen).join('\n')).not.toContain('more lines')
    toggle!()
    expect(contentLines(screen).join('\n')).toContain('more lines, ctrl+o to expand')

    // A tick on the finalized block stands its spinner down.
    timers.ticks[0]!()
    expect(timers.cleared).toBe(1)

    // Unmounting the session retires the component entirely.
    ctx.emit('test/session-changed', asAgent(fakeAgent([])))
    expect(screen.children).toHaveLength(1)
  })

  it('remounts on the next test/session-changed and unmounts everything on dispose', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.emit('test/session-changed', asAgent(fakeAgent([userEvent('first')])))
    expect(contentLines(screen)).toEqual(['', '\x1b[1m» \x1b[22m\x1b[1mfirst\x1b[22m'])

    resetSeq()
    const second = fakeAgent([userEvent('second')])
    second.id = 'parent-2'
    second.session.id = 'parent-2'
    ctx.emit('test/session-changed', asAgent(second))
    expect(screen.children).toHaveLength(1)
    expect(contentLines(screen)).toEqual(['', '\x1b[1m» \x1b[22m\x1b[1msecond\x1b[22m'])

    // The old session's listener went away with its components.
    const staleAgent = fakeAgent([])
    ctx.emit('session/event', staleAgent.session as unknown as Session, textDelta(1, 1, 'x'))
    expect(screen.children).toHaveLength(1)

    await ctx.fiber.dispose()
    expect(screen.children).toHaveLength(0)
    expect(screen.bottomChildren).toHaveLength(0)
    disposers.length = 0
  })

  it.skip('replaces the legacy fold while an official transcript model is present and restores it on unload', async () => {
    resetSeq()
    let semanticTick: (() => void) | undefined
    setThinkingTimers({
      setInterval(callback: () => void): ReturnType<typeof setInterval> {
        semanticTick = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval(): void {},
    })
    const first = fakeAgent([userEvent('legacy first')])
    const { ctx, screen, keymap } = await bootTranscript(first)
    expect(contentLines(screen).join('\n')).toContain('legacy first')
    const models = ctx.get('blueTranscriptModels') as TranscriptModelService
    const remove = models.register(createTranscriptModel('official-conversation', [
      { kind: 'transcript-assistant', id: 'official', seq: 1, turn: 1, step: 0, text: 'official only', streaming: false },
      { kind: 'transcript-thinking', id: 'official-thinking', seq: 2, turn: 1, step: 0, text: 'official thought', streaming: true },
    ]))
    expect(contentLines(screen).join('\n')).toContain('official only')
    expect(contentLines(screen).join('\n')).not.toContain('legacy first')
    semanticTick?.()

    resetSeq()
    ctx.emit('test/session-changed', asAgent(fakeAgent([userEvent('legacy second')])))
    expect(contentLines(screen).join('\n')).toContain('official only')
    expect(contentLines(screen).join('\n')).not.toContain('legacy second')
    keymap.actions.find(action => action.id === ACTION_TOGGLE_COLLAPSE)?.handler?.()

    remove()
    expect(contentLines(screen).join('\n')).toContain('legacy second')
    expect(contentLines(screen).join('\n')).not.toContain('official only')

    models.register(createTranscriptModel('official-conversation', [
      { kind: 'transcript-assistant', id: 'last', seq: 3, turn: 2, step: 0, text: 'active at unload', streaming: false },
    ]))
    ctx.emit('blue/request-state-changed', {
      ref: { sessionEpoch: 1, requestEpoch: 1, scope: 'btw' },
      state: 'completed',
    })
    await ctx.fiber.dispose()
    expect(screen.children).toHaveLength(0)
    disposers.length = 0
  })

  it.skip('keeps the legacy fallback absent before the first session when a model provider unloads', async () => {
    const { ctx, screen } = await bootTranscript()
    const models = ctx.get('blueTranscriptModels') as TranscriptModelService
    const remove = models.register(createTranscriptModel('temporary', [
      { kind: 'transcript-assistant', id: 'temporary', seq: 1, turn: 1, step: 0, text: 'temporary', streaming: false },
    ]))
    expect(contentLines(screen)).toEqual(['', '● temporary'])
    remove()
    expect(screen.children).toHaveLength(0)
  })

  it.skip('renders a structured legacy turn failure', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      turnStart(1),
      turnEnd(1, { kind: 'error', error: { message: 'endpoint down', code: 'HTTP_404' } }),
    ])))
    ctx.emit('blue/request-state-changed', {
      ref: { sessionEpoch: 1, requestEpoch: 1, scope: 'main' },
      state: 'completed',
    })
    expect(contentLines(screen).join('\n')).toContain('request failed (HTTP_404): endpoint down')
  })

  it('registers the ctrl+o toggle action and unregisters it on dispose', async () => {
    const { ctx, keymap } = await bootTranscript()
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)
    expect(action).toMatchObject({ keys: 'ctrl+o' })
    expect(typeof action?.handler).toBe('function')

    await ctx.fiber.dispose()
    disposers.length = 0
    expect(keymap.unregistered.flat().map(a => a.id)).toContain(ACTION_TOGGLE_COLLAPSE)
  })

  it.skip('toggles tool output between the preview and the full text', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    const full = `first line\nsecond line\n${'x'.repeat(300)}`
    const agent = fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{"command":"ls"}'),
      toolResultEvent(1, 1, 'c1', full),
    ])
    ctx.emit('test/session-changed', asAgent(agent))

    // Collapsed by default: the bash pure label, the lines chip, the 3-row
    // preview, and the kimi hint as the last row.
    const collapsed = contentLines(screen)
    expect(collapsed[1]).toContain('Ran a command')
    expect(collapsed[1]).toContain(' · 3 lines')
    expect(collapsed).toContain('  first line')
    expect(collapsed).toContain('  second line')
    expect(collapsed.at(-1)).toContain('more lines, ')
    expect(collapsed.at(-1)).toContain('total, ctrl+o to expand')

    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)
    const renderBaseline = screen.renderRequests.length
    action?.handler?.()
    expect(screen.renderRequests.length).toBe(renderBaseline + 1)
    expect(screen.renderRequests.at(-1)).toBe(true)
    const expanded = contentLines(screen)
    expect(expanded.length).toBeGreaterThan(collapsed.length)
    expect(expanded.some(line => line.includes('x'.repeat(76)))).toBe(true)
    expect(expanded.join('\n')).not.toContain('more lines')

    action?.handler?.()
    expect(contentLines(screen).join('\n')).toContain('more lines')
    expect(contentLines(screen).some(line => line.includes('x'.repeat(76)))).toBe(true)
  })

  it.skip('resets the toggle to collapsed when the session changes', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', `alpha\nbeta\n${'x'.repeat(200)}`),
    ])))
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)
    action?.handler?.()
    expect(contentLines(screen).some(line => line.includes('x'.repeat(76)))).toBe(true)

    // The remount clears the entries and the expansion state: the next
    // session's tool output starts collapsed again (3 preview rows + hint).
    resetSeq()
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      toolCallEvent(1, 1, 'c2', 'bash', '{}'),
      toolResultEvent(1, 1, 'c2', `gamma\ndelta\n${'y'.repeat(200)}`),
    ])))
    const collapsed = contentLines(screen)
    expect(collapsed.at(-1)).toContain('more lines')
    expect(collapsed).toHaveLength(1 + 1 + 3 + 1)
    expect(collapsed).toContain('  gamma')
    expect(collapsed).toContain('  delta')

    // The handler now reaches the new session's components.
    action?.handler?.()
    expect(contentLines(screen).some(line => line.includes('y'.repeat(76)))).toBe(true)
  })

  it.skip('mounts tool cards expanded when the settings default uncollapses them', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { settings: { blue: { collapseToolCalls: false } } })
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', `first line\nsecond line\n${'x'.repeat(300)}`),
    ])))
    // Seeded expanded at creation: the full wrapped output (the 300-char
    // line wraps to 3 full-width rows; the collapsed preview shows only
    // its first), no hint.
    const lines = contentLines(screen)
    expect(lines.filter(line => line.includes('x'.repeat(76)))).toHaveLength(3)
    expect(lines.join('\n')).not.toContain('more lines')
  })

  it.skip('mounts thinking blocks expanded when the settings default uncollapses them', async () => {
    resetSeq()
    const six = 'one\ntwo\nthree\nfour\nfive\nsix'
    const { ctx, screen } = await bootTranscript(null, { settings: { blue: { collapseThinking: false } } })
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      assistantEvent(1, 1, [{ type: 'reasoning', text: six }, { type: 'text', text: 'answer' }]),
    ])))
    const lines = contentLines(screen)
    expect(lines.some(line => line.includes('six'))).toBe(true)
    expect(lines.join('\n')).not.toContain('more lines')
  })

  it.skip('keeps long user messages folded regardless of the expansion defaults', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, {
      settings: { blue: { collapseThinking: false, collapseToolCalls: false } },
    })
    const long = Array.from({ length: 11 }, (_, index) => `row ${index}`).join('\n')
    ctx.emit('test/session-changed', asAgent(fakeAgent([turnStart(1), userEvent(long), turnEnd(1)])))
    // The defaults cover thinking and tools only: the user fold is untouched.
    const collapsed = contentLines(screen)
    expect(collapsed).toHaveLength(1 + 3 + 1)
    expect(collapsed.at(-1)).toContain('(8 more lines, 11 total, ctrl+o to expand)')
  })

  it.skip('returns each category to its configured default when ctrl+o releases', async () => {
    resetSeq()
    const six = 'one\ntwo\nthree\nfour\nfive\nsix'
    const { ctx, screen, keymap } = await bootTranscript(null, { settings: { blue: { collapseToolCalls: false } } })
    const agent = fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', `first line\nsecond line\n${'x'.repeat(300)}`),
      assistantEvent(1, 1, [{ type: 'reasoning', text: six }, { type: 'text', text: 'answer' }]),
    ])
    ctx.emit('test/session-changed', asAgent(agent))
    const hints = (): string[] => contentLines(screen).filter(line => line.includes('more lines'))
    // Mounted state: tools default-expanded, thinking default-collapsed.
    expect(hints()).toHaveLength(1)
    expect(contentLines(screen).filter(line => line.includes('x'.repeat(76)))).toHaveLength(3)

    // Toggle on: everything in scope expands, thinking included; a tool
    // mounted live while the toggle is on seeds expanded too.
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)?.handler
    action!()
    expect(hints()).toHaveLength(0)
    ctx.emit('session/event', agent.session as unknown as Session, toolCallEvent(1, 1, 'c2', 'bash', '{}'))
    ctx.emit('session/event', agent.session as unknown as Session, toolResultEvent(1, 1, 'c2', `third line\n${'y'.repeat(300)}`))
    expect(contentLines(screen).filter(line => line.includes('y'.repeat(76)))).toHaveLength(3)

    // Toggle off: thinking returns to its collapsed default, tools keep
    // their expanded default — both the seeded and the live-mounted card.
    action!()
    expect(hints()).toHaveLength(1)
    const released = contentLines(screen)
    expect(released.filter(line => line.includes('x'.repeat(76)))).toHaveLength(3)
    expect(released.filter(line => line.includes('y'.repeat(76)))).toHaveLength(3)
  })

  it.skip('applies settings/updated to mounted and subsequently mounted entries', async () => {
    resetSeq()
    const blueNs = 'blue' as SettingsNamespace
    const { ctx, screen } = await bootTranscript(null, { settings: { blue: {} } })
    const agent = fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', `first line\nsecond line\n${'a'.repeat(300)}`),
    ])
    ctx.emit('test/session-changed', asAgent(agent))
    const hints = (): string[] => contentLines(screen).filter(line => line.includes('more lines'))
    const mountTool = (id: string, ch: string): void => {
      ctx.emit('session/event', agent.session as unknown as Session, toolCallEvent(1, 1, id, 'bash', '{}'))
      ctx.emit('session/event', agent.session as unknown as Session, toolResultEvent(1, 1, id, `first line\nsecond line\n${ch.repeat(300)}`))
    }
    // The registered-but-empty section keeps the collapsed defaults.
    expect(hints()).toHaveLength(1)

    // Another namespace's update is ignored.
    ctx.emit('settings/updated', 'other' as SettingsNamespace, { collapseToolCalls: false }, {}, 'provider')
    mountTool('c2', 'b')
    expect(hints()).toHaveLength(2)

    // A blue update re-seeds the MOUNTED entries too (a toggle that left
    // the visible transcript untouched would read as broken) and seeds the
    // ones mounted after it.
    ctx.emit('settings/updated', blueNs, { collapseToolCalls: false }, {}, 'provider')
    expect(hints()).toHaveLength(0)
    expect(contentLines(screen).filter(line => line.includes('a'.repeat(76)))).toHaveLength(3)
    mountTool('c3', 'c')
    expect(hints()).toHaveLength(0)
    expect(contentLines(screen).filter(line => line.includes('c'.repeat(76)))).toHaveLength(3)

    // Collapse-true re-seeds everything back, and a non-object value (a
    // dirty external edit) leaves the default untouched.
    ctx.emit('settings/updated', blueNs, { collapseToolCalls: true }, { collapseToolCalls: false }, 'provider')
    expect(hints()).toHaveLength(3)
    ctx.emit('settings/updated', blueNs, null, { collapseToolCalls: true }, 'provider')
    expect(hints()).toHaveLength(3)
    mountTool('c4', 'd')
    expect(hints()).toHaveLength(4)
  })

  it.skip('re-seeds mounted thinking blocks on a fold-default commit', async () => {
    resetSeq()
    const blueNs = 'blue' as SettingsNamespace
    const six = 'one\ntwo\nthree\nfour\nfive\nsix'
    const { ctx, screen } = await bootTranscript(null, { settings: { blue: {} } })
    const agent = fakeAgent([
      turnStart(1),
      userEvent('q'),
      assistantEvent(1, 1, [{ type: 'reasoning', text: six }, { type: 'text', text: 'answer' }]),
      turnEnd(1),
    ])
    ctx.emit('test/session-changed', asAgent(agent))
    const lines = (): string[] => contentLines(screen)
    // Mounted collapsed: the folded preview plus the hint, tail hidden.
    expect(lines().some(line => line.includes('six'))).toBe(false)
    expect(lines().some(line => line.includes('more lines'))).toBe(true)

    // The commit expands the mounted block in place...
    ctx.emit('settings/updated', blueNs, { collapseThinking: false }, {}, 'provider')
    expect(lines().some(line => line.includes('six'))).toBe(true)
    expect(lines().some(line => line.includes('more lines'))).toBe(false)

    // ...and a same-value re-commit is a no-op (the guard return).
    const renders = screen.renderRequests
    ctx.emit('settings/updated', blueNs, { collapseThinking: false }, {}, 'provider')
    expect(screen.renderRequests).toBe(renders)

    // Collapse-true folds it back.
    ctx.emit('settings/updated', blueNs, { collapseThinking: true }, { collapseThinking: false }, 'provider')
    expect(lines().some(line => line.includes('six'))).toBe(false)
  })

  it.skip('keeps the ctrl+o expansion dominant over a fold-default commit', async () => {
    resetSeq()
    const blueNs = 'blue' as SettingsNamespace
    const six = 'one\ntwo\nthree\nfour\nfive\nsix'
    const { ctx, screen, keymap } = await bootTranscript(null, { settings: { blue: {} } })
    const agent = fakeAgent([
      assistantEvent(1, 1, [{ type: 'reasoning', text: six }, { type: 'text', text: 'answer' }]),
    ])
    ctx.emit('test/session-changed', asAgent(agent))
    // Toggle on, then a collapse-true commit: the active toggle dominates,
    // exactly as it does at mount.
    keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)?.handler?.()
    ctx.emit('settings/updated', blueNs, { collapseThinking: true }, {}, 'provider')
    expect(contentLines(screen).some(line => line.includes('six'))).toBe(true)
  })

  it.skip('keeps the collapsed defaults for dirty (non-boolean) settings values', async () => {
    resetSeq()
    const six = 'one\ntwo\nthree\nfour\nfive\nsix'
    const { ctx, screen } = await bootTranscript(null, {
      settings: { blue: { collapseThinking: 'yes', collapseToolCalls: 1 } },
    })
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', `first line\nsecond line\n${'x'.repeat(300)}`),
      assistantEvent(1, 1, [{ type: 'reasoning', text: six }, { type: 'text', text: 'answer' }]),
    ])))
    expect(contentLines(screen).filter(line => line.includes('more lines'))).toHaveLength(2)
  })
  it('drives the transcript tunables from the blue settings section', async () => {
    resetSeq()
    const blueNs = 'blue' as SettingsNamespace
    const { ctx } = await bootTranscript(null, {
      settings: {
        blue: {
          windowTurns: 5, recentStepsRetention: 20, expandTurns: 2,
          userFoldLines: 25, userFoldChars: 750,
        },
      },
    })
    expect(ctx.blueTranscriptModels.presentationPolicy()).toMatchObject({
      windowTurns: 5, recentStepsRetention: 20, expandTurns: 2,
      userFoldLines: 25, userFoldChars: 750,
    })

    // A partial section keeps the sibling threshold's current value.
    ctx.emit('settings/updated', blueNs, { userFoldLines: 40 }, {}, 'provider')
    expect(ctx.blueTranscriptModels.presentationPolicy()).toMatchObject({ userFoldLines: 40, userFoldChars: 750 })

    // Dirty values (non-positive, non-integer, wrong type) keep the live
    // settings — the same keep-current discipline as the fold defaults.
    ctx.emit('settings/updated', blueNs, {
      windowTurns: -3,
      recentStepsRetention: 1.5,
      expandTurns: 'many',
      userFoldLines: 0,
      userFoldChars: null,
    }, {}, 'provider')
    expect(ctx.blueTranscriptModels.presentationPolicy()).toMatchObject({
      windowTurns: 5, recentStepsRetention: 20, expandTurns: 2,
      userFoldLines: 40, userFoldChars: 750,
    })
  })

  it.skip('limits ctrl+o to the most recent three turns (kimi range)', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    const agent = fakeAgent([
      turnStart(1), userEvent('one'),
      toolCallEvent(1, 1, 'c1', 'bash', '{}'), toolResultEvent(1, 1, 'c1', 'o'.repeat(500)),
      turnEnd(1),
      turnStart(2), userEvent('two'), turnEnd(2),
      turnStart(3), userEvent('three'), turnEnd(3),
      turnStart(4), userEvent('four'),
      toolCallEvent(4, 1, 'c2', 'bash', '{}'), toolResultEvent(4, 1, 'c2', 'n'.repeat(500)),
      turnEnd(4),
    ])
    ctx.emit('test/session-changed', asAgent(agent))
    const hints = (): string[] => contentLines(screen).filter(line => line.includes('more lines'))
    expect(hints()).toHaveLength(2)

    // Expanding flips only the cards at/after the (totalTurns - 3)-th turn
    // boundary: turn 4's card grows to its full wrapped output, turn 1's
    // stays at the 3-row preview under its hint.
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)
    action?.handler?.()
    expect(hints()).toHaveLength(1)
    expect(contentLines(screen).some(line => line.includes('n'.repeat(76)))).toBe(true)
    expect(contentLines(screen).filter(line => line.includes('o'.repeat(76)))).toHaveLength(3)

    action?.handler?.()
    expect(hints()).toHaveLength(2)
  })

  it.skip('folds a long user message into the ctrl+o family (D46)', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    const long = Array.from({ length: 11 }, (_, index) => `row ${index}`).join('\n')
    const agent = fakeAgent([turnStart(1), userEvent(long), turnEnd(1)])
    ctx.emit('test/session-changed', asAgent(agent))
    // Collapsed: blank + 3 preview rows + the S20-style hint.
    const collapsed = contentLines(screen)
    expect(collapsed).toHaveLength(1 + 3 + 1)
    expect(collapsed.at(-1)).toContain('(8 more lines, 11 total, ctrl+o to expand)')
    // The shared toggle expands the whole message and folds it back.
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)?.handler
    action!()
    expect(contentLines(screen)).toHaveLength(1 + 11)
    action!()
    expect(contentLines(screen).at(-1)).toContain('8 more lines')
  })

  it.skip('gives long user messages the same three-turn range as tool cards', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    const long = (mark: string): string =>
      Array.from({ length: 11 }, (_, index) => `${mark}-${index}`).join('\n')
    const agent = fakeAgent([
      turnStart(1), userEvent(long('one')), turnEnd(1),
      turnStart(2), userEvent(long('two')), turnEnd(2),
      turnStart(3), userEvent(long('three')), turnEnd(3),
      turnStart(4), userEvent(long('four')), turnEnd(4),
    ])
    ctx.emit('test/session-changed', asAgent(agent))
    const hints = (): string[] => contentLines(screen).filter(line => line.includes('more lines'))
    expect(hints()).toHaveLength(4)
    // Expanding flips the boundary messages of turns 2-4; turn 1's stays
    // folded exactly like its tool-card peers.
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)?.handler
    action!()
    expect(hints()).toHaveLength(1)
    expect(contentLines(screen).some(line => line.includes('four-10'))).toBe(true)
    expect(contentLines(screen).some(line => line.includes('one-10'))).toBe(false)
    action!()
    expect(hints()).toHaveLength(4)
  })

  it.skip('mounts a live long user message at the live expansion state', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    const agent = fakeAgent([turnStart(1)])
    ctx.emit('test/session-changed', asAgent(agent))
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)?.handler
    action!()
    const long = Array.from({ length: 11 }, (_, index) => `live ${index}`).join('\n')
    ctx.emit('session/event', agent.session as unknown as Session, userEvent(long))
    // The message mounts while the toggle is on: already expanded, no hint.
    const lines = contentLines(screen)
    expect(lines.some(line => line.includes('more lines'))).toBe(false)
    expect(lines).toHaveLength(1 + 11)
  })

  it.skip('resets long-message expansion when the session changes', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    const long = (mark: string): string =>
      Array.from({ length: 11 }, (_, index) => `${mark}-${index}`).join('\n')
    ctx.emit('test/session-changed', asAgent(fakeAgent([turnStart(1), userEvent(long('first')), turnEnd(1)])))
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)?.handler
    action!()
    expect(contentLines(screen).some(line => line.includes('first-10'))).toBe(true)
    // The remount resets the toggle: the next session's long message starts
    // folded regardless of the previous session's state.
    resetSeq()
    ctx.emit('test/session-changed', asAgent(fakeAgent([turnStart(1), userEvent(long('next')), turnEnd(1)])))
    const collapsed = contentLines(screen)
    expect(collapsed.at(-1)).toContain('8 more lines, 11 total')
    expect(collapsed.some(line => line.includes('next-10'))).toBe(false)
  })

  // The read-group fossils (same-step grouping, chain breaks, step-fold
  // retirement) drove the retired event-fold mounter; the projection-layer
  // grouping they described now lives in official-model.spec.ts and the
  // bundle e2e read-group cases, so the skipped shells are deleted rather
  // than kept as architecture lies.

  it.skip('suppresses spawn-class subagent calls and results from the stream (S33 pane ruling)', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, {})
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey tests', 'survey'),
      subagentCallEvent(1, 1, 'a2', 'subagent', 'Map docs', 'map'),
      subagentCallEvent(1, 1, 'a3', 'subagent_fork', 'Draft README', 'draft'),
      toolResultEvent(1, 1, 'a1', 'started subagent child-1'),
      toolResultEvent(1, 1, 'a2', 'started subagent child-2'),
      toolResultEvent(1, 1, 'a3', 'started background subagent job subagent-1'),
      stepStart(1, 2),
      toolCallEvent(1, 2, 's1', 'send_message', '{"message":"hi"}'),
      toolResultEvent(1, 2, 's1', 'ok'),
      turnEnd(1),
    ])))
    // Only the control card mounts: spawn calls, their acks, and the fork
    // are pane-owned — the agents pane is their only surface.
    expect(screen.children).toHaveLength(1)
    const joined = contentLines(screen).join('\n')
    expect(joined).toContain('send_message')
    expect(joined).not.toContain('subagent')
  })

  it.skip('evicts old turns once the window overflows', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { settings: { blue: { windowTurns: 2 } } })
    const events: SessionEvent[] = []
    for (let turn = 1; turn <= 4; turn += 1) {
      events.push(turnStart(turn), userEvent(`t${turn}`), turnEnd(turn))
    }
    ctx.emit('test/session-changed', asAgent(fakeAgent(events)))
    // Window 2 keeps turns 3 and 4 (2 user components).
    expect(screen.children).toHaveLength(2)
    expect(contentLines(screen).join('\n')).toContain('t3')
    expect(contentLines(screen).join('\n')).not.toContain('t1')
  })

  it.skip('mounts the step summary and disposes the folded tool components', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    const events: SessionEvent[] = [
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'a1', 'Read', '{}'),
      toolCallEvent(1, 1, 'a2', 'Read', '{}'),
      stepStart(1, 2),
      assistantEvent(1, 2, [{ type: 'text', text: 'done' }]),
      turnEnd(1),
    ]
    ctx.emit('test/session-changed', asAgent(fakeAgent(events)))
    const lines = contentLines(screen).join('\n')
    expect(lines).toContain('… step 1 · call 2 tools')
    expect(lines).not.toContain('Using Read')
    expect(screen.children).toHaveLength(2)
  })

  it.skip('loads user-message images through the attachments service', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    const renderRequests: number[] = []
    const original = screen.requestRender.bind(screen)
    screen.requestRender = (force?: boolean) => {
      renderRequests.push(force ? 1 : 0)
      original(force)
    }
    ctx.reflect.provide('attachments', {
      readImage: async (_ref: { id: string }) => ({ data: new Uint8Array([1, 2, 3]) }),
    })
    const agent = fakeAgent([userEvent('pic', [{ type: 'image', attachment: { id: 'a1', mediaType: 'image/png' } as never }])])
    ctx.emit('test/session-changed', asAgent(agent))
    // First render kicks the load; the settle nudges requestRender and the
    // loaded image's fake rows replace the placeholder.
    const before = contentLines(screen)
    expect(before).toContain('  [image]')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(renderRequests.length).toBeGreaterThan(0)
    expect(contentLines(screen)).toContain('  <image 3B>')
    disposers.length = 0
    await ctx.fiber.dispose()
  })

  it.skip('keeps the placeholder when readImage rejects', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.reflect.provide('attachments', {
      readImage: async () => { throw new Error('missing') },
    })
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      userEvent('pic', [{ type: 'image', attachment: { id: 'a1' } as never }]),
    ])))
    contentLines(screen)
    await new Promise(resolve => setTimeout(resolve, 10))
    // One placeholder from the message text plus one from the failed load.
    expect(contentLines(screen)).toEqual([
      '',
      '\x1b[1m» \x1b[22m\x1b[1mpic\x1b[22m',
      '  \x1b[1m[image]\x1b[22m',
      '  [image]',
    ])
    disposers.length = 0
    await ctx.fiber.dispose()
  })

  it.skip('keeps image placeholders when no attachments service exists', async () => {    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.emit('test/session-changed', asAgent(fakeAgent([
      userEvent('pic', [{ type: 'image', attachment: { id: 'a1' } as never }]),
    ])))
    expect(contentLines(screen)).toEqual([
      '',
      '\x1b[1m» \x1b[22m\x1b[1mpic\x1b[22m',
      '  \x1b[1m[image]\x1b[22m',
    ])
    disposers.length = 0
    await ctx.fiber.dispose()
  })
})
