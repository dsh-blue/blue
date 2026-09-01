/** Real Loader composition coverage for the direct transcript services.
 * @module @dsh-blue/blue-transcript/tests/plugin
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { BlueStatusService, type BlueStatusEntry } from '@dsh-blue/blue-api'
import type { BlueComponent, BlueKeyAction, BlueKeymap, BlueOverlayHandle, BlueScreen } from '@dsh-blue/blue-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlueLocaleService } from '../../frontend/src/locale.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { ACTION_TOGGLE_COLLAPSE, apply } from '../src/index.ts'
import * as officialModel from '../src/official-model.ts'
import * as statusBasicModel from '../src/status-basic-model.ts'
import { createToolPresentationModel } from '../src/tool-model.ts'
import { createTranscriptModel } from '../src/transcript-model.ts'
import { setThinkingTimers } from '../src/thinking.ts'
import { assistantEvent, fakeBlueComponents, imageBlock, resetSeq, textDelta, toolCallEvent, toolResultEvent, userEvent } from './helpers.ts'
import { FakeProjectionService } from './pane-fakes.ts'

registerTempDirCleanup()

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

const id = (text: string): string => text
const COLORS = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id, success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
  diffGutter: id, diffMeta: id,
}

class FakeScreen implements BlueScreen {
  readonly children: BlueComponent[] = []
  readonly bottomChildren: BlueComponent[] = []
  readonly renderRequests: Array<boolean | undefined> = []
  readonly columns = 80
  readonly rows = 24
  addChild(component: BlueComponent): () => void {
    this.children.push(component)
    return () => { this.removeChild(component) }
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
  showOverlay(): BlueOverlayHandle { throw new Error('overlays are out of scope') }
  requestRender(force?: boolean): void { this.renderRequests.push(force) }
  contentChanged(): boolean { this.requestRender(); return false }
  suspend<T>(fn: () => Promise<T>): Promise<T> { return fn() }
  setTitle(): void {}
}

class FakeKeymap implements BlueKeymap {
  readonly actions: BlueKeyAction[] = []
  readonly unregistered: BlueKeyAction[][] = []
  register(actions: BlueKeyAction[]): () => void {
    this.actions.push(...actions)
    return () => {
      this.unregistered.push(actions)
      for (const action of actions) {
        const index = this.actions.indexOf(action)
        if (index !== -1) this.actions.splice(index, 1)
      }
    }
  }
  matches(): boolean { return false }
  dispatch(): boolean { return false }
  getKeys(): string[] { return [] }
  list(): readonly BlueKeyAction[] { return this.actions }
}

interface FakeAgent {
  id: string
  status: 'idle' | 'running'
  options: { model: string, provider: string }
  session: Session & { events: SessionEvent[] }
}

function fakeAgent(events: SessionEvent[], model = 'deepseek-chat'): FakeAgent {
  const session = {
    id: 'parent-1',
    events,
    header: {},
    requestHeader: () => undefined,
  } as unknown as FakeAgent['session']
  return { id: 'parent-1', status: 'idle', options: { model, provider: 'deepseek' }, session }
}

interface Harness {
  readonly ctx: Context
  readonly screen: FakeScreen
  readonly keymap: FakeKeymap
  readonly select: (agent: FakeAgent | null) => void
}

function fixtureApply(ctx: Context): void {
  ctx.blueStatus.register({
    id: 'fixture.status', priority: 30, visible: true,
    node: { kind: 'text', content: 'fixture-entry', tone: 'muted' },
  } satisfies BlueStatusEntry)
}

async function bootTranscript(
  initial: FakeAgent | null = null,
  options: {
    readonly fixture?: boolean
    readonly settings?: Record<string, unknown>
    readonly attachments?: { readImage(ref: unknown): Promise<{ data: Uint8Array }> }
  } = {},
): Promise<Harness> {
  const dir = mkdtempTracked('dsh-blue-transcript-')
  const entries = [
    {
      file: 'transcript.mjs', name: 'blue-transcript',
      inject: ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'blueStatus', 'blueCurrentAgent', 'sessionProjections', 'sessions'],
      global: '__blueTranscriptApply',
    },
    {
      file: 'official.mjs', name: 'blue-transcript-official',
      inject: ['blueConversationReady', 'sessionProjections', 'blueCurrentAgent', 'blueTranscriptModels', 'tools'],
      global: '__blueTranscriptOfficialApply',
    },
    {
      file: 'status.mjs', name: 'blue-status-basic-model',
      inject: ['blueStatus', 'blueSessionFacts'], global: '__blueStatusBasicApply',
    },
  ]
  if (options.fixture === true) entries.push({
    file: 'fixture.mjs', name: 'blue-status-fixture', inject: ['blueStatus'], global: '__blueStatusFixtureApply',
  })
  for (const entry of entries) {
    writeFileSync(join(dir, entry.file), [
      `export const name = '${entry.name}'`,
      `export const inject = ${JSON.stringify(entry.inject)}`,
      `export const apply = ctx => globalThis.${entry.global}(ctx)`,
      '',
    ].join('\n'))
  }
  writeFileSync(join(dir, 'cordis.yml'), entries.flatMap(entry => [
    `- id: ${entry.name}`,
    `  name: ${pathToFileURL(join(dir, entry.file)).href}`,
  ]).concat('').join('\n'))

  const globals = globalThis as unknown as Record<string, (ctx: Context) => void>
  globals.__blueTranscriptApply = apply
  globals.__blueTranscriptOfficialApply = officialModel.apply
  globals.__blueStatusBasicApply = statusBasicModel.apply
  globals.__blueStatusFixtureApply = fixtureApply

  const ctx = new Context()
  const screen = new FakeScreen()
  const keymap = new FakeKeymap()
  const projections = new FakeProjectionService()
  const status = new BlueStatusService(ctx)
  let active = initial
  let revision = 0
  const listeners = new Set<(agent: Agent | null, revision: number) => void>()
  const currentAgent = {
    current: () => active as unknown as Agent | null,
    revision: () => revision,
    subscribe(listener: (agent: Agent | null, nextRevision: number) => void) {
      listeners.add(listener)
      listener(active as unknown as Agent | null, revision)
      return () => { listeners.delete(listener) }
    },
  }
  const select = (agent: FakeAgent | null): void => {
    active = agent
    revision += 1
    for (const listener of listeners) listener(agent as unknown as Agent | null, revision)
  }
  const services: Record<string, unknown> = {
    blueScreen: screen,
    blueTheme: { colors: COLORS },
    blueComponents: fakeBlueComponents(),
    blueKeymap: keymap,
    blueCurrentAgent: currentAgent,
    sessionProjections: projections,
    sessions: { list: () => active === null ? [] : [active.session] },
    blueConversationReady: { key: 'blueConversation' },
    tools: { get: () => undefined },
    ...(options.settings === undefined ? {} : { settings: { get: (ns: string) => options.settings?.[ns] } }),
    ...(options.attachments === undefined ? {} : { attachments: options.attachments }),
  }
  for (const [name, value] of Object.entries(services)) ctx.reflect.provide(name, value)
  ctx.on('session/event', (session, event) => projections.emit(session, event))

  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, screen, keymap, select }
}

function stripGutter(lines: string[]): string[] {
  return lines.map(line => line === ' ' ? '' : line.slice(1))
}

function contentLines(screen: FakeScreen): string[] {
  return stripGutter(screen.children.flatMap(component => component.render(80)))
}

function footerLines(screen: FakeScreen): string[] {
  return stripGutter(screen.bottomChildren.flatMap(component => component.render(80)))
}

describe('blue-transcript through the real Loader', () => {
  it('boots against direct Cordis services and renders a pre-existing Agent', async () => {
    resetSeq()
    const agent = fakeAgent([userEvent('remember me'), assistantEvent(1, 1, [{ type: 'text', text: 'answer' }])])
    const { ctx, screen } = await bootTranscript(agent)
    expect(ctx.blueCurrentAgent.current()).toBe(agent)
    expect(contentLines(screen).join('\n')).toContain('remember me')
    expect(contentLines(screen).join('\n')).toContain('answer')
    expect(footerLines(screen)[0]).toContain('deepseek-chat')
  })

  it('switches exact Agents and follows native projection updates only for the selected session', async () => {
    resetSeq()
    const { ctx, screen, select } = await bootTranscript()
    const agent = fakeAgent([userEvent('work'), toolCallEvent(1, 1, 'c1', 'bash', '{"command":"ls"}')])
    select(agent)
    expect(contentLines(screen).join('\n')).toContain('work')

    const baseline = screen.renderRequests.length
    const other = fakeAgent([])
    other.session.id = 'other'
    ctx.emit('session/event', other.session, textDelta(2, 1, 'foreign'))
    expect(screen.renderRequests.length).toBe(baseline)

    ctx.emit('session/event', agent.session, textDelta(2, 1, 'partial'))
    expect(contentLines(screen).join('\n')).toContain('partial')
    ctx.emit('session/event', agent.session, assistantEvent(2, 1, [{ type: 'text', text: 'final' }]))
    ctx.emit('session/event', agent.session, toolResultEvent(2, 1, 'c1', 'file.txt'))
    const text = contentLines(screen).join('\n')
    expect(text).toContain('final')
    expect(text).toContain('Used')
    expect(text).toContain('file.txt')
  })

  it('renders a sibling plugin registration from the same direct blueStatus service', async () => {
    const { screen } = await bootTranscript(fakeAgent([]), { fixture: true })
    const footer = footerLines(screen).join('\n')
    expect(footer).toContain('deepseek-chat')
    expect(footer).toContain('fixture-entry')
  })

  it('renders direct tool/transcript model consumers through the shared renderer callbacks', async () => {
    let tick: (() => void) | undefined
    setThinkingTimers({
      setInterval(callback) {
        tick = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval() {},
    })
    const { ctx, screen } = await bootTranscript(fakeAgent([]))
    const offTool = ctx.blueToolModels.register(createToolPresentationModel({
      id: 'fixture-tool',
      name: 'fixture',
      call: { card: 'generic', title: 'Fixture tool', content: [{ type: 'text', text: 'tool body' }] },
    }))
    const offTranscript = ctx.blueTranscriptModels.register(createTranscriptModel('fixture-transcript', [{
      kind: 'transcript-thinking',
      id: 'fixture-thinking',
      seq: 1,
      turn: 1,
      step: 0,
      text: 'live thought',
      streaming: true,
    }], true))
    expect(contentLines(screen).join('\n')).toContain('Fixture tool')
    const baseline = screen.renderRequests.length
    tick?.()
    expect(screen.renderRequests.length).toBeGreaterThan(baseline)
    offTranscript()
    offTool()
    setThinkingTimers(undefined)
  })

  it('loads transcript images through the optional attachment service and contains failures', async () => {
    let call = 0
    const readImage = vi.fn(async () => {
      call += 1
      if (call === 1) return { data: new Uint8Array([1, 2, 3]) }
      throw new Error('attachment unavailable')
    })
    const agent = fakeAgent([userEvent('images', [
      imageBlock({ attachmentId: 'image-ok', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } as never),
      imageBlock({ attachmentId: 'image-missing', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } as never),
    ])])
    const { screen } = await bootTranscript(agent, { attachments: { readImage } })
    contentLines(screen)
    await vi.waitFor(() => { expect(readImage).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => {
      const rendered = contentLines(screen).join('\n')
      expect(rendered).toContain('<image 3B>')
      expect(rendered.match(/\[image\]/g)?.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('applies settings, reprojects locale copy, and unloads every Fiber-owned registration', async () => {
    const { ctx, screen, keymap } = await bootTranscript(null, {
      settings: { blue: { collapseToolCalls: false, expandTurns: 2, userFoldLines: 12 } },
    })
    expect(ctx.blueTranscriptModels.presentationPolicy()).toMatchObject({ toolsExpanded: true, expandTurns: 2, userFoldLines: 12 })
    ctx.emit('settings/updated', 'blue' as SettingsNamespace, { expandTurns: 4, userFoldChars: 700 }, {}, 'provider')
    expect(ctx.blueTranscriptModels.presentationPolicy()).toMatchObject({ expandTurns: 4, userFoldChars: 700 })
    ctx.emit('settings/updated', 'blue' as SettingsNamespace, { expandTurns: 4, userFoldChars: 700 }, {}, 'provider')
    ctx.emit('settings/updated', 'other' as SettingsNamespace, { expandTurns: 8 }, {}, 'provider')

    const toggle = keymap.actions.find(action => action.id === ACTION_TOGGLE_COLLAPSE)
    const baseline = screen.renderRequests.length
    toggle?.handler()
    expect(screen.renderRequests.length).toBeGreaterThan(baseline)
    expect(screen.renderRequests.at(-1)).toBe(true)

    const localeFiber = await ctx.plugin({
      name: 'transcript-test-locale',
      apply(localeCtx: Context) {
        const locale = new BlueLocaleService(localeCtx, { systemLocale: 'en' })
        localeCtx.effect(() => () => locale.dispose())
      },
    })
    await Promise.resolve()
    expect(keymap.actions.find(action => action.id === ACTION_TOGGLE_COLLAPSE)?.description)
      .toBe('Toggle detail expansion (tool output, long messages)')
    ctx.blueLocale.setPreference('zh')
    expect(keymap.actions.find(action => action.id === ACTION_TOGGLE_COLLAPSE)?.description)
      .toBe('切换详细内容展开状态（工具输出、长消息）')
    await localeFiber.dispose()

    await ctx.fiber.dispose()
    disposers.length = 0
    expect(screen.children).toEqual([])
    expect(screen.bottomChildren).toEqual([])
    expect(keymap.actions).toEqual([])
    expect(keymap.unregistered.flat().map(action => action.id)).toContain(ACTION_TOGGLE_COLLAPSE)
  })
})
