/**
 * REAL-composition test: boot the blue-transcript plugin — plus the
 * `blue-status-basic` subpath plugin and, for the acceptance case, a
 * downstream fixture plugin registering its own `blueStatus` entry — through
 * the real Loader from a cordis.yml in a temp directory, over fake
 * `blueScreen` / `blueTheme` / `blueComponents` / `blueSession` services,
 * then drive it with `'blue/session-changed'` and `'session/event'` exactly
 * as the app package and session service will.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
} from '@deepseek-ai/dsh-blue-core'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueSessionRef } from '@deepseek-ai/dsh-blue-app'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { ACTION_TOGGLE_COLLAPSE, apply, setWindowTurns } from '../src/index.ts'
import * as statusBasic from '../src/status-basic.ts'
import type { BlueIntentEntry } from '../src/types.ts'
import {
  assistantEvent,
  fakeBlueComponents,
  resetSeq,
  stepStart,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  turnEnd,
  turnStart,
  userEvent,
} from './helpers.ts'

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
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
  status: 'idle' | 'running'
  options: { model?: string }
  session: {
    events: SessionEvent[]
    header: { cwd?: string }
    requestHeader(): { config: { model: string } } | undefined
  }
}

/** A fake agent whose session is a plain event-log object. */
function fakeAgent(events: SessionEvent[], model = 'deepseek-chat'): FakeAgent {
  return {
    status: 'idle',
    options: { model },
    session: {
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
  blueSession: BlueSessionRef
}

/** The downstream fixture's apply: registers one custom footer entry. */
function fixtureApply(ctx: Context): void {
  ctx.effect(() => ctx.blueStatus.register({
    id: 'blue.status.fixture',
    priority: 30,
    render: () => 'fixture-entry',
  }))
}

/**
 * Boot a real Loader tree whose entry rows delegate to the source-plane
 * plugins already imported by this test (the Loader imports through Node's
 * resolver, which cannot reach tsconfig paths): blue-transcript,
 * blue-status-basic, and — with `fixture` — a downstream plugin registering
 * a custom `blueStatus` entry.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 * @param options.fixture - append the downstream status-entry fixture row.
 */
async function bootTranscript(
  current: FakeAgent | null = null,
  options: { fixture?: boolean, tools?: Record<string, unknown> } = {},
): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-blue-transcript-'))
  writeFileSync(join(dir, 'blue-transcript.mjs'), `
export const name = 'blue-transcript'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'tools']
export const apply = ctx => globalThis.__blueTranscriptApply(ctx)
`)
  writeFileSync(join(dir, 'blue-status-basic.mjs'), `
export const name = 'blue-status-basic'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueStatusBasicApply(ctx)
`)
  writeFileSync(join(dir, 'blue-status-fixture.mjs'), `
export const name = 'blue-status-fixture'
export const inject = ['blueStatus']
export const apply = ctx => globalThis.__blueStatusFixtureApply(ctx)
`)
  const rows = [
    '- id: blue-transcript',
    `  name: ${pathToFileURL(join(dir, 'blue-transcript.mjs')).href}`,
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
    __blueStatusBasicApply: typeof statusBasic.apply
    __blueStatusFixtureApply: typeof fixtureApply
  }
  globals.__blueTranscriptApply = apply
  globals.__blueStatusBasicApply = statusBasic.apply
  globals.__blueStatusFixtureApply = fixtureApply

  const ctx = new Context()
  const screen = new FakeScreen()
  const keymap = new FakeKeymap()
  const blueSession: BlueSessionRef = { current: current === null ? null : asAgent(current) }
  const serviceNames: Record<string, unknown> = {
    blueScreen: screen,
    blueTheme: { colors: COLORS },
    blueComponents: fakeBlueComponents(),
    blueKeymap: keymap,
    blueSession,
    tools: { get: (name: string) => options.tools?.[name] },
  }
  for (const [serviceName, value] of Object.entries(serviceNames)) {
    ctx.reflect.provide(serviceName, value)
  }

  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, screen, keymap, blueSession }
}

/** The transcript's content components (the footer lives in bottomChildren). */
function contentLines(screen: FakeScreen): string[] {
  return screen.children.flatMap(component => component.render(80))
}

/** The footer shell's rendered rows. */
function footerLines(screen: FakeScreen): string[] {
  return screen.bottomChildren.flatMap(component => component.render(80))
}

describe('blue-transcript plugin through the real Loader', () => {
  it('mounts only the empty footer before any session exists', async () => {
    const { screen } = await bootTranscript()
    expect(screen.children).toHaveLength(0)
    expect(screen.bottomChildren).toHaveLength(1)
    expect(footerLines(screen)).toEqual([])
  })

  it('renders history and the footer status on blue/session-changed', async () => {
    resetSeq()
    const { ctx, screen, blueSession } = await bootTranscript()
    // Simulate the app emitting after create: with no listener-visible
    // history the plugin still mounts from the service reference.
    const agent = fakeAgent([userEvent('hi'), assistantEvent(1, 1, [{ type: 'text', text: 'answer' }])])
    ctx.emit('blue/session-changed', asAgent(agent))
    expect(screen.children).toHaveLength(2)
    expect(footerLines(screen)).toEqual([`deepseek-chat${' '.repeat(67)}`])
    expect(contentLines(screen)).toEqual(['', '❯ hi', '', 'answer'])
    expect(screen.renderRequests).toContain(true)
    expect(blueSession.current).toBeNull()
  })

  it('renders a pre-existing current agent without waiting for the event', async () => {
    resetSeq()
    const { screen } = await bootTranscript(fakeAgent([userEvent('remember me')]))
    expect(screen.children).toHaveLength(1)
    expect(contentLines(screen)).toEqual(['', '❯ remember me'])
    expect(footerLines(screen)[0]).toContain('deepseek-chat')
  })

  it('lets a downstream plugin register its own footer entry', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, { fixture: true })
    ctx.emit('blue/session-changed', asAgent(fakeAgent([])))
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
    ctx.emit('blue/session-changed', asAgent(agent))
    expect(screen.children).toHaveLength(2)
    const renderBaseline = screen.renderRequests.length

    // Stale replay at or below the snapshot's last seq is dropped.
    ctx.emit('session/event', agent.session as unknown as Session, { ...textDelta(1, 1, 'stale'), seq: 1 })
    const stale = seeded[seeded.length - 1]!
    ctx.emit('session/event', agent.session as unknown as Session, { ...stale })
    expect(screen.children).toHaveLength(2)
    expect(screen.renderRequests.length).toBe(renderBaseline)

    // Events for another session are ignored.
    const other = fakeAgent([])
    ctx.emit('session/event', other.session as unknown as Session, textDelta(9, 9, 'foreign'))
    expect(screen.children).toHaveLength(2)

    // Live chunk: mounts a streaming assistant component and re-renders. The
    // footer's model text is untouched — no agent-status noise any more.
    agent.status = 'running'
    ctx.emit('session/event', agent.session as unknown as Session, textDelta(2, 1, 'partial'))
    expect(screen.children).toHaveLength(3)
    expect(screen.renderRequests.length).toBe(renderBaseline + 1)
    expect(contentLines(screen)).toContain('partial▌')
    expect(footerLines(screen)[0]).toContain('deepseek-chat')

    // Finalization rewrites the streaming item in place.
    ctx.emit('session/event', agent.session as unknown as Session, assistantEvent(2, 1, [{ type: 'text', text: 'final' }]))
    expect(screen.children).toHaveLength(3)
    expect(contentLines(screen)).toContain('final')

    // The seeded tool call pairs with its live result.
    ctx.emit('session/event', agent.session as unknown as Session, toolResultEvent(2, 1, 'c1', 'file.txt'))
    expect(screen.children).toHaveLength(3)
    expect(contentLines(screen).join('\n')).toContain('file.txt')
  })

  it('remounts on the next blue/session-changed and unmounts everything on dispose', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.emit('blue/session-changed', asAgent(fakeAgent([userEvent('first')])))
    expect(contentLines(screen)).toEqual(['', '❯ first'])

    resetSeq()
    ctx.emit('blue/session-changed', asAgent(fakeAgent([userEvent('second')])))
    expect(screen.children).toHaveLength(1)
    expect(contentLines(screen)).toEqual(['', '❯ second'])

    // The old session's listener went away with its components.
    const staleAgent = fakeAgent([])
    ctx.emit('session/event', staleAgent.session as unknown as Session, textDelta(1, 1, 'x'))
    expect(screen.children).toHaveLength(1)

    await ctx.fiber.dispose()
    expect(screen.children).toHaveLength(0)
    expect(screen.bottomChildren).toHaveLength(0)
    disposers.length = 0
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

  it('toggles tool output between the summary and the full text', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    const full = `first line\nsecond line\n${'x'.repeat(300)}`
    const agent = fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{"command":"ls"}'),
      toolResultEvent(1, 1, 'c1', full),
    ])
    ctx.emit('blue/session-changed', asAgent(agent))

    // Collapsed by default: the flattened summary carries the ellipsis and
    // joins the full text's own lines into wrapped rows.
    const collapsed = contentLines(screen)
    expect(collapsed.join('\n')).toContain('…')
    expect(collapsed).toContain('  ⎿ first line second line')
    expect(collapsed).not.toContain('  ⎿ first line')

    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)
    const renderBaseline = screen.renderRequests.length
    action?.handler?.()
    expect(screen.renderRequests.length).toBe(renderBaseline + 1)
    expect(screen.renderRequests.at(-1)).toBe(true)
    const expanded = contentLines(screen)
    expect(expanded.length).toBeGreaterThan(collapsed.length)
    expect(expanded).toContain('  ⎿ first line')
    expect(expanded).toContain('  ⎿ second line')
    expect(expanded.join('\n')).not.toContain('…')

    action?.handler?.()
    expect(contentLines(screen).join('\n')).toContain('…')
    expect(contentLines(screen)).not.toContain('  ⎿ first line')
  })

  it('resets the toggle to collapsed when the session changes', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript()
    ctx.emit('blue/session-changed', asAgent(fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', `alpha\nbeta\n${'x'.repeat(200)}`),
    ])))
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)
    action?.handler?.()
    expect(contentLines(screen)).toContain('  ⎿ alpha')

    // The remount clears the collection and the expansion state: the next
    // session's tool output starts collapsed again.
    resetSeq()
    ctx.emit('blue/session-changed', asAgent(fakeAgent([
      toolCallEvent(1, 1, 'c2', 'bash', '{}'),
      toolResultEvent(1, 1, 'c2', `gamma\ndelta\n${'y'.repeat(200)}`),
    ])))
    expect(contentLines(screen).join('\n')).toContain('…')
    expect(contentLines(screen)).toContain('  ⎿ gamma delta')
    expect(contentLines(screen)).not.toContain('  ⎿ gamma')

    // The handler now reaches the new session's components.
    action?.handler?.()
    expect(contentLines(screen)).toContain('  ⎿ gamma')
  })

  it('creates tool cards through the blueIntents registry', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript(null, {
      tools: { bash: { presentCall: () => ({ card: 'stub-card' }) } },
    })
    const seen: { item: { name: string }, expanded: boolean }[] = []
    const stub: BlueIntentEntry = {
      intent: 'stub-card',
      create: (props) => {
        seen.push({ item: props.item, expanded: props.expanded })
        return { render: () => ['STUB CARD'] }
      },
    }
    ctx.effect(() => ctx.blueIntents.register(stub))
    ctx.emit('blue/session-changed', asAgent(fakeAgent([
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
    ])))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.item.name).toBe('bash')
    expect(seen[0]?.expanded).toBe(false)
    expect(contentLines(screen)).toContain('STUB CARD')
  })

  it('evicts old turns once the window overflows', async () => {
    resetSeq()
    setWindowTurns(2)
    try {
      const { ctx, screen } = await bootTranscript()
      const events: SessionEvent[] = []
      for (let turn = 1; turn <= 4; turn += 1) {
        events.push(turnStart(turn), userEvent(`t${turn}`), turnEnd(turn))
      }
      ctx.emit('blue/session-changed', asAgent(fakeAgent(events)))
      // Window 2 keeps turns 3 and 4 (2 user components).
      expect(screen.children).toHaveLength(2)
      expect(contentLines(screen).join('\n')).toContain('t3')
      expect(contentLines(screen).join('\n')).not.toContain('t1')
    } finally {
      setWindowTurns(undefined)
    }
  })

  it('mounts the step summary and disposes the folded tool components', async () => {
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
    ctx.emit('blue/session-changed', asAgent(fakeAgent(events)))
    const lines = contentLines(screen).join('\n')
    expect(lines).toContain('… step 1 · Read ×2')
    expect(lines).not.toContain('○ Read')
    expect(screen.children).toHaveLength(2)
  })

  it('toggles intent components that expose setExpanded', async () => {
    resetSeq()
    const { ctx, screen, keymap } = await bootTranscript(null, {
      tools: { bash: { presentCall: () => ({ card: 'flippy' }) } },
    })
    const flips: boolean[] = []
    ctx.effect(() => ctx.blueIntents.register({
      intent: 'flippy',
      create: () => ({
        render: () => ['flip card'],
        setExpanded: (expanded: boolean) => { flips.push(expanded) },
      }),
    }))
    ctx.emit('blue/session-changed', asAgent(fakeAgent([toolCallEvent(1, 1, 'c1', 'bash', '{}')])))
    const action = keymap.actions.find(a => a.id === ACTION_TOGGLE_COLLAPSE)
    action?.handler?.()
    action?.handler?.()
    expect(flips).toEqual([true, false])
    expect(contentLines(screen)).toContain('flip card')
  })

  it('loads user-message images through the attachments service', async () => {
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
    ctx.emit('blue/session-changed', asAgent(agent))
    // First render kicks the load; the settle nudges requestRender and the
    // loaded image's fake rows replace the placeholder.
    const before = contentLines(screen)
    expect(before).toContain('  [image]')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(renderRequests.length).toBeGreaterThan(0)
    expect(contentLines(screen)).toContain('<image 3B>')
    disposers.length = 0
    await ctx.fiber.dispose()
  })

  it('keeps the placeholder when readImage rejects', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.reflect.provide('attachments', {
      readImage: async () => { throw new Error('missing') },
    })
    ctx.emit('blue/session-changed', asAgent(fakeAgent([
      userEvent('pic', [{ type: 'image', attachment: { id: 'a1' } as never }]),
    ])))
    contentLines(screen)
    await new Promise(resolve => setTimeout(resolve, 10))
    // One placeholder from the message text plus one from the failed load.
    expect(contentLines(screen)).toEqual(['', '❯ pic', '  [image]', '  [image]'])
    disposers.length = 0
    await ctx.fiber.dispose()
  })

  it('keeps image placeholders when no attachments service exists', async () => {    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.emit('blue/session-changed', asAgent(fakeAgent([
      userEvent('pic', [{ type: 'image', attachment: { id: 'a1' } as never }]),
    ])))
    expect(contentLines(screen)).toEqual(['', '❯ pic', '  [image]'])
    disposers.length = 0
    await ctx.fiber.dispose()
  })
})
