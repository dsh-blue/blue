/**
 * REAL-composition test: boot the blue-transcript plugin through the real
 * Loader from a cordis.yml in a temp directory, over fake `blueScreen` /
 * `blueTheme` / `blueSession` services, then drive it with
 * `'blue/session-changed'` and `'session/event'` exactly as the app package
 * and session service will.
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
  BlueOverlayHandle,
  BlueScreen,
} from '@deepseek-ai/dsh-blue-core'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueSessionRef } from '@deepseek-ai/dsh-blue-app'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.ts'
import {
  assistantEvent,
  resetSeq,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  userEvent,
} from './helpers.ts'

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/** Identity colors so rendered assertions see structure, not escape codes. */
const id = (text: string): string => text
const COLORS = {
  text: id, muted: id, accent: id, border: id, success: id, error: id, warning: id,
  selectedBg: id, mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Records mounts and render requests; renders nothing anywhere real. */
class FakeScreen implements BlueScreen {
  readonly children: BlueComponent[] = []
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80

  addChild(component: BlueComponent): () => void {
    this.children.push(component)
    return () => {
      this.removeChild(component)
    }
  }

  // The transcript never bottom-pins; the method exists only to satisfy the
  // BlueScreen contract.
  addBottomChild(component: BlueComponent): () => void {
    return this.addChild(component)
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

/** Structural stand-in for the real `Agent`; cast at the typed emit sites. */
interface FakeAgent {
  status: 'idle' | 'running'
  options: { model?: string }
  session: { events: SessionEvent[] }
}

/** A fake agent whose session is a plain event-log object. */
function fakeAgent(events: SessionEvent[], model = 'deepseek-chat'): FakeAgent {
  return {
    status: 'idle',
    options: { model },
    session: { events },
  }
}

/** Narrow a fake to the app-owned event payload type. */
function asAgent(fake: FakeAgent): Agent {
  return fake as unknown as Agent
}

interface Harness {
  ctx: Context
  screen: FakeScreen
  blueSession: BlueSessionRef
}

/**
 * Boot a real Loader tree whose single entry delegates to the source-plane
 * plugin already imported by this test (the Loader imports through Node's
 * resolver, which cannot reach tsconfig paths).
 * @param current - agent preloaded onto `blueSession.current`, if any.
 */
async function bootTranscript(current: FakeAgent | null = null): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-blue-transcript-'))
  writeFileSync(join(dir, 'blue-transcript.mjs'), `
export const name = 'blue-transcript'
export const inject = ['blueScreen', 'blueTheme']
export const apply = ctx => globalThis.__blueTranscriptApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: blue-transcript',
    `  name: ${pathToFileURL(join(dir, 'blue-transcript.mjs')).href}`,
    '',
  ].join('\n'))
  ;(globalThis as unknown as { __blueTranscriptApply: typeof apply }).__blueTranscriptApply = apply

  const ctx = new Context()
  const screen = new FakeScreen()
  const blueSession: BlueSessionRef = { current: current === null ? null : asAgent(current) }
  const serviceNames: Record<string, unknown> = {
    blueScreen: screen,
    blueTheme: { colors: COLORS },
    blueSession,
  }
  for (const [serviceName, value] of Object.entries(serviceNames)) {
    ctx.reflect.provide(serviceName, value)
  }

  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, screen, blueSession }
}

/** The transcript's content components (everything past the status bar). */
function contentLines(screen: FakeScreen): string[] {
  return screen.children.slice(1).flatMap(component => component.render(80))
}

describe('blue-transcript plugin through the real Loader', () => {
  it('mounts nothing before any session exists', async () => {
    const { screen } = await bootTranscript()
    expect(screen.children).toHaveLength(0)
  })

  it('renders history and the status bar on blue/session-changed', async () => {
    resetSeq()
    const { ctx, screen, blueSession } = await bootTranscript()
    // Simulate the app emitting after create: with no listener-visible
    // history the plugin still mounts from the service reference.
    const agent = fakeAgent([userEvent('hi'), assistantEvent(1, 1, [{ type: 'text', text: 'answer' }])])
    ctx.emit('blue/session-changed', asAgent(agent))
    expect(screen.children).toHaveLength(3)
    expect(screen.children[0]!.render(80)[0]).toContain('deepseek-chat · idle')
    expect(contentLines(screen)).toEqual(['', '❯ hi', '', 'answer'])
    expect(screen.renderRequests).toContain(true)
    expect(blueSession.current).toBeNull()
  })

  it('renders a pre-existing current agent without waiting for the event', async () => {
    resetSeq()
    const { screen } = await bootTranscript(fakeAgent([userEvent('remember me')]))
    expect(screen.children).toHaveLength(2)
    expect(contentLines(screen)).toEqual(['', '❯ remember me'])
  })

  it('streams chunks, pairs tool calls, and dedupes by snapshot seq', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    const seeded = [userEvent('work'), toolCallEvent(1, 1, 'c1', 'bash', '{"command":"ls"}')]
    const agent = fakeAgent(seeded)
    ctx.emit('blue/session-changed', asAgent(agent))
    expect(screen.children).toHaveLength(3)
    const renderBaseline = screen.renderRequests.length

    // Stale replay at or below the snapshot's last seq is dropped.
    ctx.emit('session/event', agent.session as unknown as Session, { ...textDelta(1, 1, 'stale'), seq: 1 })
    const stale = seeded[seeded.length - 1]!
    ctx.emit('session/event', agent.session as unknown as Session, { ...stale })
    expect(screen.children).toHaveLength(3)
    expect(screen.renderRequests.length).toBe(renderBaseline)

    // Events for another session are ignored.
    const other = fakeAgent([])
    ctx.emit('session/event', other.session as unknown as Session, textDelta(9, 9, 'foreign'))
    expect(screen.children).toHaveLength(3)

    // Live chunk: mounts a streaming assistant component and re-renders.
    agent.status = 'running'
    ctx.emit('session/event', agent.session as unknown as Session, textDelta(2, 1, 'partial'))
    expect(screen.children).toHaveLength(4)
    expect(screen.renderRequests.length).toBe(renderBaseline + 1)
    expect(contentLines(screen)).toContain('partial▌')
    expect(screen.children[0]!.render(80)[0]).toContain('running')

    // Finalization rewrites the streaming item in place.
    ctx.emit('session/event', agent.session as unknown as Session, assistantEvent(2, 1, [{ type: 'text', text: 'final' }]))
    expect(screen.children).toHaveLength(4)
    expect(contentLines(screen)).toContain('final')

    // The seeded tool call pairs with its live result.
    ctx.emit('session/event', agent.session as unknown as Session, toolResultEvent(2, 1, 'c1', 'file.txt'))
    expect(screen.children).toHaveLength(4)
    expect(contentLines(screen).join('\n')).toContain('file.txt')
  })

  it('remounts on the next blue/session-changed and unmounts everything on dispose', async () => {
    resetSeq()
    const { ctx, screen } = await bootTranscript()
    ctx.emit('blue/session-changed', asAgent(fakeAgent([userEvent('first')])))
    expect(contentLines(screen)).toEqual(['', '❯ first'])

    resetSeq()
    ctx.emit('blue/session-changed', asAgent(fakeAgent([userEvent('second')])))
    expect(screen.children).toHaveLength(2)
    expect(contentLines(screen)).toEqual(['', '❯ second'])

    // The old session's listener went away with its components.
    const staleAgent = fakeAgent([])
    ctx.emit('session/event', staleAgent.session as unknown as Session, textDelta(1, 1, 'x'))
    expect(screen.children).toHaveLength(2)

    await ctx.fiber.dispose()
    expect(screen.children).toHaveLength(0)
    disposers.length = 0
  })
})
