/**
 * Tests for the `blue-settings` plugin: the schema defaults, the single
 * `blue` namespace registration, the shared thunk reflecting user
 * overrides, and the persisted-theme applier (boot swap, commit-follow,
 * unrelated-commit silence, failure restore, and the unload guard).
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
// Empty type import carries the loader Context merge for the fake loader.
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Empty type import carries the `settings` Context merge and the
// 'settings/updated' Events merge the emit below uses.
import type {} from '@deepseek-ai/dsh-settings'
import SettingsProvider, { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
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

/** Mount the provider (as a class plugin, so init publishes the document) and the settings plugin. */
async function mount(doc: Record<string, unknown> = {}): Promise<{ ctx: Context, settings: SettingsProvider }> {
  const ctx = new Context()
  await ctx.plugin(MemorySettings, doc)
  await ctx.plugin(settingsPlugin)
  await settle()
  return { ctx, settings: ctx.get('settings')! }
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
    })
  })
})

describe('blue-settings theme applier', () => {
  it('degrades without a settings service or a loader', async () => {
    const ctx = new Context()
    await ctx.plugin(settingsPlugin)
    await settle()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('does not swap when the persisted theme is the baseline', async () => {
    const { ctx } = await mount({ blue: { updateCheck: false } })
    await settle()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })

  it('applies the persisted theme once the tree settles, then follows commits', async () => {
    themeMock.calls.length = 0
    const { ctx, settings } = await mount({ blue: { theme: 'ocean' } })
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

  it('does not record a failed swap: the error result warns and the provider stays put', async () => {
    themeMock.forceFailure = true
    try {
      const ctx = new Context()
      const warn = vi.spyOn(ctx.logger, 'warn')
      await ctx.plugin(MemorySettings, { blue: { theme: 'ocean' } })
      await ctx.plugin(settingsPlugin)
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith('forced failure for ocean')
      })
      // No swap happened: nothing mounted, and lastAppliedTheme never moved.
      expect(ctx.get('blueTheme')).toBeUndefined()
    } finally {
      themeMock.forceFailure = false
    }
  })

  it('stops the boot continuation when the fiber unloads behind the loader settle', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings, { blue: { theme: 'ocean' } })
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    ctx.provide('loader', { await: () => gate } as never)
    const fiber = await ctx.plugin(settingsPlugin)
    await fiber.dispose()
    release()
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
