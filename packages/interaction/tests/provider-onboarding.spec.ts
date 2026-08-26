/** Boot-time provider onboarding: credential detection, setup, and skip. */

import { describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import * as onboardingPlugin from '../src/provider-onboarding.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

function current(screen: FakeScreen): { handleInput(data: string): void, render(width: number): string[] } {
  const entry = screen.overlays.at(-1)
  expect(entry).toBeDefined()
  return entry!.component as never
}

async function mount(options: {
  configured?: readonly string[]
  providers?: readonly string[]
  profiles?: Record<string, unknown>
  failDescribe?: readonly string[]
  failSet?: unknown
  session?: boolean | 'null'
  credentials?: boolean
  display?: boolean
  llm?: boolean
  settings?: boolean
  section?: unknown
  sharedEditor?: boolean
  describeImpl?: (ref: object) => Promise<{ configured: boolean, writable?: boolean }>
  setImpl?: (ref: object, value: string) => Promise<void>
  loader?: Promise<void>
  waitForDescription?: boolean
} = {}) {
  const base = fakeBlueContext()
  const notices: string[] = []
  const configured = new Set(options.configured ?? [])
  const failDescribe = new Set(options.failDescribe ?? [])
  const describe = vi.fn(async (ref: object) => {
    if (options.describeImpl !== undefined) return options.describeImpl(ref)
    const id = String(ref)
    if (failDescribe.has(id)) throw new Error('credential backend unavailable')
    return { configured: configured.has(id), writable: true }
  })
  const set = vi.fn(async (ref: object, value: string) => {
    if (options.setImpl !== undefined) return options.setImpl(ref, value)
    if (options.failSet !== undefined) throw options.failSet
    configured.add(String(ref))
    void value
  })
  if (options.display === false) {
    base.ctx.set('blueTheme', undefined)
  }
  if (options.llm !== false) {
    base.ctx.provide('llm', {
      listProviders: () => (options.providers ?? ['deepseek-official']).map(id => ({ id, name: id })),
    } as never)
  }
  if (options.settings !== false) {
    base.ctx.provide('settings', {
      get: (ns: object) => String(ns) === String(settingsNamespace('llm-pi-ai'))
        ? options.section ?? { providers: options.profiles ?? {} }
        : undefined,
    } as never)
  }
  if (options.credentials !== false) {
    base.ctx.provide('credentials', { describe, set } as never)
  }
  if (options.session !== false) {
    base.ctx.provide('testSession', { current: options.session === 'null' ? null : {}, modelRef: undefined })
  }
  if (options.loader !== undefined) {
    base.ctx.provide('loader', { await: () => options.loader } as never)
  }
  if (options.sharedEditor !== false) {
    setSharedEditor(base.ctx, {
      editor: { focused: false, render: () => [], invalidate: () => {} } as never,
      submitPrompt: () => {},
      notice: text => { notices.push(text) },
    })
  }
  const fiber = await base.ctx.plugin(onboardingPlugin)
  if (options.waitForDescription !== false) {
    await vi.waitFor(() => {
      if (options.credentials !== false && options.session !== false && options.session !== 'null') {
        expect(describe).toHaveBeenCalled()
      }
    })
  }
  return { ...base, notices, describe, set, fiber }
}

describe('provider onboarding', () => {
  it('asks only for DEEPSEEK_API_KEY when no provider credential is configured', async () => {
    const bench = await mount()
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    const form = current(bench.screen)
    const rows = form.render(100).join('\n')
    expect(rows).toContain('Connect to DeepSeek')
    expect(rows).toContain('official endpoint')
    expect(rows).toContain('DEEPSEEK_API_KEY')
    expect(rows).toContain('configure another provider later')
    form.handleInput('sk-secret')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(bench.set).toHaveBeenCalledWith(credentialRef('DEEPSEEK_API_KEY'), 'sk-secret')
      expect(bench.screen.overlays[0]?.hidden).toBe(true)
    })
    expect(bench.notices).toEqual(['DeepSeek API key saved'])
  })

  it('does not open when DeepSeek or another active provider has a key', async () => {
    const deepseek = await mount({ configured: ['DEEPSEEK_API_KEY'] })
    expect(deepseek.screen.overlays).toHaveLength(0)
    await deepseek.fiber.dispose()

    const other = await mount({ providers: ['openai'], configured: ['OPENAI_API_KEY'] })
    expect(other.screen.overlays).toHaveLength(0)
  })

  it('honors a profile-declared credential reference', async () => {
    const bench = await mount({
      providers: ['my-gateway'],
      configured: ['MY_SECRET'],
      profiles: { 'my-gateway': { apiKeyEnv: 'MY_SECRET' }, malformed: null },
    })
    expect(bench.screen.overlays).toHaveLength(0)
    expect(bench.describe).toHaveBeenCalledWith(credentialRef('MY_SECRET'))
  })

  it('handles optional catalog and settings shapes', async () => {
    const thin = await mount({ llm: false, settings: false })
    await vi.waitFor(() => { expect(thin.screen.overlays).toHaveLength(1) })

    const foreign = await mount({ section: 'not-an-object' })
    await vi.waitFor(() => { expect(foreign.screen.overlays).toHaveLength(1) })

    const noProfiles = await mount({ section: {} })
    await vi.waitFor(() => { expect(noProfiles.screen.overlays).toHaveLength(1) })

    const invalidRefs = await mount({
      profiles: { number: { apiKeyEnv: 4 }, empty: { apiKeyEnv: '' } },
    })
    await vi.waitFor(() => { expect(invalidRefs.screen.overlays).toHaveLength(1) })
  })

  it('skips for this run and points to the provider wizard', async () => {
    const bench = await mount()
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    current(bench.screen).handleInput(KEY.escape)
    expect(bench.screen.overlays[0]?.hidden).toBe(true)
    expect(bench.set).not.toHaveBeenCalled()
    expect(bench.notices).toEqual(['Provider setup skipped — use /provider add to configure a provider'])
  })

  it('keeps the form open and renders credential write failures', async () => {
    const bench = await mount({ failSet: new Error('credential file is read-only') })
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
    const form = current(bench.screen)
    form.handleInput('bad')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(form.render(80).join('\n')).toContain('credential file is read-only')
    })
    expect(bench.screen.overlays[0]?.hidden).toBe(false)
  })

  it('renders non-Error write failures and tolerates a missing notice target', async () => {
    const failed = await mount({ failSet: 'plain failure', sharedEditor: false })
    await vi.waitFor(() => { expect(failed.screen.overlays).toHaveLength(1) })
    const form = current(failed.screen)
    form.handleInput('bad')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(form.render(80).join('\n')).toContain('plain failure') })

    const skipped = await mount({ sharedEditor: false })
    await vi.waitFor(() => { expect(skipped.screen.overlays).toHaveLength(1) })
    current(skipped.screen).handleInput(KEY.escape)
    expect(skipped.screen.overlays[0]?.hidden).toBe(true)
  })

  it('treats failed credential descriptions as unconfigured', async () => {
    const bench = await mount({ failDescribe: ['DEEPSEEK_API_KEY', 'DEEPSEEK_OFFICIAL_API_KEY'] })
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
  })

  it('waits for required services and retries on session change', async () => {
    const bench = await mount({ credentials: false, session: false })
    expect(bench.screen.overlays).toHaveLength(0)
    bench.ctx.provide('credentials', { describe: async () => ({ configured: false }), set: async () => {} } as never)
    bench.ctx.provide('testSession', { current: {}, modelRef: undefined })
    bench.ctx.emit('test/session-changed', {} as never)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
  })

  it('waits while the session reference is empty', async () => {
    const bench = await mount({ session: 'null' })
    expect(bench.screen.overlays).toHaveLength(0)
    bench.ctx.set('testSession', { current: {}, modelRef: undefined })
    bench.ctx.emit('test/session-changed', {} as never)
    await vi.waitFor(() => { expect(bench.screen.overlays).toHaveLength(1) })
  })

  it('deduplicates checks and ignores late writes after unload', async () => {
    let resolveDescribe: ((value: { configured: boolean }) => void) | undefined
    const describing = new Promise<{ configured: boolean }>(resolve => { resolveDescribe = resolve })
    const checking = await mount({ describeImpl: () => describing })
    checking.ctx.emit('test/session-changed', {} as never)
    checking.ctx.emit('test/session-changed', {} as never)
    resolveDescribe?.({ configured: false })
    await vi.waitFor(() => { expect(checking.screen.overlays).toHaveLength(1) })
    checking.ctx.emit('test/session-changed', {} as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(checking.screen.overlays).toHaveLength(1)

    let resolveSet: (() => void) | undefined
    const pendingSet = new Promise<void>(resolve => { resolveSet = resolve })
    const writing = await mount({ setImpl: () => pendingSet })
    await vi.waitFor(() => { expect(writing.screen.overlays).toHaveLength(1) })
    const form = current(writing.screen)
    form.handleInput('key')
    form.handleInput(KEY.enter)
    await writing.fiber.dispose()
    resolveSet?.()
    await pendingSet
    expect(writing.notices).toEqual([])

    let rejectSet: ((error: Error) => void) | undefined
    const rejectedSet = new Promise<void>((_resolve, reject) => { rejectSet = reject })
    const rejecting = await mount({ setImpl: () => rejectedSet })
    await vi.waitFor(() => { expect(rejecting.screen.overlays).toHaveLength(1) })
    const rejectedForm = current(rejecting.screen)
    rejectedForm.handleInput('key')
    rejectedForm.handleInput(KEY.enter)
    await rejecting.fiber.dispose()
    rejectSet?.(new Error('late failure'))
    await expect(rejectedSet).rejects.toThrow('late failure')
    expect(rejecting.notices).toEqual([])
  })

  it('ignores checks that finish after loader or credential teardown', async () => {
    let resolveLoader: (() => void) | undefined
    const loader = new Promise<void>(resolve => { resolveLoader = resolve })
    const settling = await mount({ loader, waitForDescription: false })
    await settling.fiber.dispose()
    resolveLoader?.()
    await loader
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(settling.screen.overlays).toHaveLength(0)

    let resolveDescribe: ((value: { configured: boolean }) => void) | undefined
    const description = new Promise<{ configured: boolean }>(resolve => { resolveDescribe = resolve })
    const describing = await mount({ describeImpl: () => description })
    await describing.fiber.dispose()
    resolveDescribe?.({ configured: false })
    await description
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(describing.screen.overlays).toHaveLength(0)
  })

  it('degrades when the display is unavailable and restores on unload', async () => {
    const absent = await mount({ display: false })
    expect(absent.screen.overlays).toHaveLength(0)

    const mounted = await mount()
    await vi.waitFor(() => { expect(mounted.screen.overlays).toHaveLength(1) })
    await mounted.fiber.dispose()
    expect(mounted.screen.overlays[0]?.hidden).toBe(true)
  })
})
