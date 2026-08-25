/**
 * Tests for the `blue-settings` plugin: the schema defaults, the single
 * `blue` namespace registration, the shared thunk reflecting user
 * overrides, and the persisted-theme applier (the session-attach-gated
 * initial apply, the immediate path when a session is already attached,
 * commit-follow, pre-attach commit silence, failure restore, and the
 * unload guard).
 *
 * Module state (`source`/`lastAppliedTheme` in settings.ts, `current` in
 * theme-switch.ts) is shared across this file, so the cases run
 * sequentially and each leaves a known theme active — the
 * theme-switch.spec discipline. The theme modules come from the package
 * subpaths (never relative core source paths) so the swap's registry keys
 * match the modules theme-switch statically imports.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Empty type import carries the `settings` Context merge and the
// 'settings/updated' Events merge the emit below uses.
import type {} from '@deepseek-ai/dsh-settings'
import SettingsProvider, { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
// Empty type import carries the app-owned `blueSession` Context merge and
// the 'blue/session-changed' Events merge the attach helper emits.
import type {} from '@dsh-blue/blue-app'
import * as themeDark from '@dsh-blue/blue-core/theme-dark'
import * as themeOcean from '@dsh-blue/blue-core/theme-ocean'
import * as themePaper from '@dsh-blue/blue-core/theme-paper'
import * as settingsPlugin from '../src/settings.ts'
import { applyTheme } from '../src/theme-switch.ts'

/**
 * The theme applier's failure branch needs a swap that actually fails; a
 * built-in mount on a bare context never does (a missing inject leaves the
 * plugin pending, it does not throw), so this spec forces the error result
 * through a module mock that delegates while the flag is down.
 */
const themeMock = vi.hoisted(() => ({ forceFailure: false, calls: [] as string[] }))
vi.mock('../src/theme-switch.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/theme-switch.ts')>()
  return {
    ...original,
    applyTheme: (ctx: Context, key: string) => {
      themeMock.calls.push(key)
      return themeMock.forceFailure
        ? Promise.resolve({ kind: 'error' as const, text: `forced failure for ${key}` })
        : original.applyTheme(ctx, key)
    },
  }
})

/** A settings provider with the stored document as its constructor config. */
class MemorySettings extends SettingsProvider {
  readonly writable = true
  private readonly doc: Record<string, unknown>

  constructor(ctx: Context, doc?: Record<string, unknown>) {
    super(ctx)
    this.doc = doc ?? {}
  }

  protected async load(): Promise<Record<string, unknown>> {
    return this.doc
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[String(ns)] = section
  }
}

/** Mount the provider, a null-current `blueSession` ref, and the settings plugin. */
async function mount(doc: Record<string, unknown> = {}): Promise<{
  ctx: Context
  settings: SettingsProvider
  attach: () => void
}> {
  const ctx = new Context()
  await ctx.plugin(MemorySettings, doc)
  // The real app updates `blueSession.current` before broadcasting the
  // switch event; the fake mirrors that contract by staying mutable.
  const session = { current: null as Agent | null }
  ctx.provide('blueSession', session)
  await ctx.plugin(settingsPlugin)
  await settle()
  return {
    ctx,
    settings: ctx.get('settings')!,
    attach: () => {
      const agent = { id: 'settings-spec' } as unknown as Agent
      session.current = agent
      ctx.emit('blue/session-changed', agent)
    },
  }
}

/** Flush the inject attach and the applier's async chain. */
function settle(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('blue-settings schema and registration', () => {
  it('resolves every schema default and starts on the composition defaults', () => {
    // Must run before any attach: the thunk starts at the composition entry.
    expect(settingsPlugin.currentBlueSettings()).toEqual(settingsPlugin.DEFAULT_SETTINGS)
    expect(settingsPlugin.Config({})).toEqual(settingsPlugin.DEFAULT_SETTINGS)
    expect(settingsPlugin.DEFAULT_SETTINGS).toEqual({
      updateCheck: true,
      updateChannel: 'rc',
      theme: 'dark',
      collapseThinking: true,
      collapseToolCalls: true,
      windowTurns: 15,
      recentStepsRetention: 30,
      expandTurns: 3,
      userFoldLines: 10,
      userFoldChars: 1000,
      editorCommand: '',
      pasteImageBackend: 'auto',
    })
    expect(settingsPlugin.name).toBe('blue-settings')
  })

  it('registers the blue namespace exactly once and reflects user overrides', async () => {
    const { settings } = await mount({ blue: { updateCheck: false, updateChannel: 'beta' } })
    const blue = settings.describe().filter(descriptor => String(descriptor.ns) === 'blue')
    expect(blue).toHaveLength(1)
    // The namespace is taken: a second registration fails loud upstream.
    expect(() => settings.register(settingsNamespace('blue'), settingsPlugin.Config)).toThrow(/already registered/u)
    // The thunk resolves schema defaults layered with the user document.
    expect(settingsPlugin.currentBlueSettings()).toEqual({
      updateCheck: false,
      updateChannel: 'beta',
      theme: 'dark',
      collapseThinking: true,
      collapseToolCalls: true,
      windowTurns: 15,
      recentStepsRetention: 30,
      expandTurns: 3,
      userFoldLines: 10,
      userFoldChars: 1000,
      editorCommand: '',
      pasteImageBackend: 'auto',
    })
  })
})

describe('blue-settings theme applier', () => {
  it('degrades without a settings service or a session', async () => {
    const ctx = new Context()
    await ctx.plugin(settingsPlugin)
    await settle()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('does not swap when the persisted theme is the baseline', async () => {
    const { ctx, attach } = await mount({ blue: { updateCheck: false } })
    attach()
    await settle()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('applies the persisted theme on session attach, then follows commits', async () => {
    themeMock.calls.length = 0
    const { ctx, settings, attach } = await mount({ blue: { theme: 'ocean' } })
    // No swap before the attach, even with a persisted non-baseline theme:
    // the initial apply must not race the loader's activation assertion.
    expect(ctx.get('blueTheme')).toBeUndefined()
    expect(themeMock.calls).toEqual([])
    attach()
    await vi.waitFor(() => {
      expect(ctx.get('blueTheme')?.colors).toBe(themeOcean.OCEAN_COLORS)
    })
    expect(themeMock.calls).toEqual(['ocean'])

    // An unrelated blue commit leaves the live provider alone: the session
    // pick (or here, the just-applied persisted theme) survives.
    await settings.update(settingsNamespace('blue'), { updateCheck: false })
    await settle()
    expect(themeMock.calls).toEqual(['ocean'])

    // A foreign-namespace commit is filtered out entirely.
    ctx.emit('settings/updated', settingsNamespace('shell'), {}, {}, 'update')
    await settle()
    expect(themeMock.calls).toEqual(['ocean'])

    // A committed theme change swaps the provider.
    await settings.update(settingsNamespace('blue'), { theme: 'paper' })
    await vi.waitFor(() => {
      expect(ctx.get('blueTheme')?.colors).toBe(themePaper.PAPER_COLORS)
    })
    // Back to the baseline: later cases start from dark.
    await settings.update(settingsNamespace('blue'), { theme: 'dark' })
    await vi.waitFor(() => {
      expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
    })
    expect(themeMock.calls).toEqual(['ocean', 'paper', 'dark'])
  })

  it('reads the current value at attach: a pre-attach commit needs no follow', async () => {
    themeMock.calls.length = 0
    const { ctx, settings, attach } = await mount({ blue: { theme: 'ocean' } })
    // The settings/updated handler is gated on the attach: this commit
    // moves the persisted theme without any swap.
    await settings.update(settingsNamespace('blue'), { theme: 'paper' })
    await settle()
    expect(themeMock.calls).toEqual([])
    // The attach-time sync reads the current value, covering the commit.
    attach()
    await vi.waitFor(() => {
      expect(ctx.get('blueTheme')?.colors).toBe(themePaper.PAPER_COLORS)
    })
    expect(themeMock.calls).toEqual(['paper'])
    // Back to the baseline: later cases start from dark.
    await settings.update(settingsNamespace('blue'), { theme: 'dark' })
    await vi.waitFor(() => {
      expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
    })
  })

  it('syncs immediately when a session is already attached at load', async () => {
    themeMock.calls.length = 0
    const ctx = new Context()
    await ctx.plugin(MemorySettings, { blue: { theme: 'ocean' } })
    ctx.provide('blueSession', { current: { id: 'settings-spec' } as unknown as Agent })
    await ctx.plugin(settingsPlugin)
    await vi.waitFor(() => {
      expect(ctx.get('blueTheme')?.colors).toBe(themeOcean.OCEAN_COLORS)
    })
    expect(themeMock.calls).toEqual(['ocean'])
    // Back to the baseline: later cases start from dark.
    await ctx.get('settings')!.update(settingsNamespace('blue'), { theme: 'dark' })
    await vi.waitFor(() => {
      expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
    })
  })

  it('does not record a failed swap: the error result warns and the provider stays put', async () => {
    themeMock.forceFailure = true
    try {
      const ctx = new Context()
      const warn = vi.spyOn(ctx.logger, 'warn')
      await ctx.plugin(MemorySettings, { blue: { theme: 'ocean' } })
      const session = { current: null as Agent | null }
      ctx.provide('blueSession', session)
      await ctx.plugin(settingsPlugin)
      // Let the settings inject resolve before the attach: the prime reads
      // the resolved scope.
      await settle()
      const agent = { id: 'settings-spec' } as unknown as Agent
      session.current = agent
      ctx.emit('blue/session-changed', agent)
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith('forced failure for ocean')
      })
      // No swap happened: nothing mounted, and lastAppliedTheme never moved.
      expect(ctx.get('blueTheme')).toBeUndefined()
    } finally {
      themeMock.forceFailure = false
    }
  })

  it('never attaches once the fiber unloaded before the first session', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings, { blue: { theme: 'ocean' } })
    const session = { current: null as Agent | null }
    ctx.provide('blueSession', session)
    const fiber = await ctx.plugin(settingsPlugin)
    await fiber.dispose()
    // The attach listener left with the fiber: the emission swaps nothing.
    const agent = { id: 'settings-spec' } as unknown as Agent
    session.current = agent
    ctx.emit('blue/session-changed', agent)
    await settle()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })
})

describe('applyTheme', () => {
  it('rejects unknown theme keys without touching the live provider', async () => {
    const ctx = new Context()
    const result = await applyTheme(ctx, 'bogus')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('unknown theme "bogus"')
    expect(ctx.get('blueTheme')).toBeUndefined()
  })
})
