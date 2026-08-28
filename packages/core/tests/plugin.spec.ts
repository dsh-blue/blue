/**
 * REAL-composition test: boot the blue-core plugin plus the blue-theme-dark
 * entry through the real Loader from a cordis.yml in a temp directory,
 * asserting the terminal starts, all five services register, the global key
 * dispatcher consumes handler actions before focus routing, the
 * terminal-theme-changed broadcast fires, and unloading restores the
 * terminal and removes the services and the dispatcher listener.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { BluePluginApi } from '../../api/src/contracts.ts'
import { apply as apiApply } from '../../api/src/host.ts'
import { apply } from '../src/index.ts'
import { apply as themeDarkApply } from '../src/theme-dark.ts'
import { mkdtempTracked, registerTempDirCleanup } from './temp-dir.ts'


registerTempDirCleanup()

const disposers: (() => Promise<void>)[] = []

interface StartupPaneProbe {
  coreApplyStarted: boolean
  appliedBeforeCore: boolean
  appliedBeforeScreen: boolean
  openOk: boolean
  registerOk: boolean
  renders: number
  gapRenders: number
  api?: BluePluginApi
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.restoreAllMocks()
})

/**
 * Boot a real Loader tree whose entries delegate to the source-plane
 * plugins already imported by this test (the Loader imports through Node's
 * resolver, which cannot reach tsconfig paths).
 * @returns the root context and the terminal output observed so far.
 */
async function bootBlueCore(): Promise<{ ctx: Context; output: () => string; pane: StartupPaneProbe }> {
  const dir = mkdtempTracked('dsh-blue-core-')
  // The fixtures re-export the real plugins' namespace shape (name + apply)
  // so the Loader exercises the same unwrap path as a packaged install.
  writeFileSync(join(dir, 'blue-api-host.mjs'), `
export const name = 'blue-api-host'
export const apply = ctx => globalThis.__blueApiApply(ctx)
`)
  writeFileSync(join(dir, 'blue-core.mjs'), `
await globalThis.__delayBlueCoreImport()
export const name = 'blue-core'
export const apply = ctx => globalThis.__blueCoreApply(ctx)
`)
  writeFileSync(join(dir, 'blue-theme-dark.mjs'), `
export const name = 'blue-theme-dark'
export const apply = ctx => globalThis.__blueThemeDarkApply(ctx)
`)
  writeFileSync(join(dir, 'external-pane.mjs'), `
export const name = 'external-pane'
export const inject = ['bluePluginHost']
export const apply = ctx => globalThis.__externalPaneApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: blue-api-host',
    `  name: ${pathToFileURL(join(dir, 'blue-api-host.mjs')).href}`,
    '- id: external-pane',
    `  name: ${pathToFileURL(join(dir, 'external-pane.mjs')).href}`,
    '- id: blue-core',
    `  name: ${pathToFileURL(join(dir, 'blue-core.mjs')).href}`,
    '- id: blue-theme-dark',
    `  name: ${pathToFileURL(join(dir, 'blue-theme-dark.mjs')).href}`,
    '',
  ].join('\n'))
  const globals = globalThis as unknown as {
    __blueCoreApply: typeof apply
    __blueApiApply: typeof apiApply
    __delayBlueCoreImport: () => Promise<void>
    __blueThemeDarkApply: typeof themeDarkApply
    __externalPaneApply: (ctx: Context) => void
  }
  const pane: StartupPaneProbe = { coreApplyStarted: false, appliedBeforeCore: false, appliedBeforeScreen: false, openOk: false, registerOk: false, renders: 0, gapRenders: 0 }
  globals.__blueApiApply = apiApply
  globals.__delayBlueCoreImport = () => new Promise<void>(resolve => setTimeout(resolve, 50))
  globals.__blueCoreApply = (ctx) => {
    pane.coreApplyStarted = true
    return apply(ctx)
  }
  globals.__blueThemeDarkApply = themeDarkApply
  globals.__externalPaneApply = (ctx) => {
    pane.appliedBeforeCore = !pane.coreApplyStarted
    pane.appliedBeforeScreen = ctx.get('blueScreen') === undefined
    const opened = ctx.bluePluginHost.open(ctx, { id: '@acme/startup-pane', api: '^1.0.0', capabilities: ['panes'] })
    pane.openOk = opened.ok
    if (!opened.ok) return
    pane.api = opened.value
    const registered = opened.value.panes!.register({
      id: 'startup-pane',
      placement: 'bottom',
      render: () => {
        pane.renders += 1
        return { kind: 'text', content: 'startup-pane' }
      },
    })
    pane.registerOk = registered.ok
  }

  const chunks: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  })

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, output: () => chunks.join(''), pane }
}

describe('blue-core plugin through the real Loader', () => {
  it('starts the terminal and registers the L1 services', async () => {
    const { ctx, output } = await bootBlueCore()
    expect(ctx.get('blueScreen')).toBeDefined()
    expect(ctx.get('blueKeymap')).toBeDefined()
    expect(ctx.get('blueTerminalInfo')).toBeDefined()
    expect(ctx.get('blueComponents')).toBeDefined()
    expect(ctx.get('blueTheme')).toBeDefined()
    // ProcessTerminal.start enables bracketed paste; Blue's production entry
    // selects the alternate buffer with application-owned mouse handling.
    expect(output()).toContain('\x1b[?2004h')
    expect(output()).toContain('\x1b[?1049h')
    expect(output()).toContain('\x1b[?1002h')
  })

  it('buffers host-only panes before core import and replays them across renderer gaps', async () => {
    const { ctx, output, pane } = await bootBlueCore()
    expect(pane.appliedBeforeCore).toBe(true)
    expect(pane.appliedBeforeScreen).toBe(true)
    expect(pane.openOk).toBe(true)
    expect(pane.registerOk).toBe(true)

    ctx.blueScreen.requestRender(true)
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(pane.renders).toBeGreaterThan(0)
    expect(output()).toContain('startup-pane')

    const coreEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'blue-core')
    expect(coreEntry).toBeDefined()
    await ctx.loader.update(coreEntry!.id, { disabled: true })
    await ctx.loader.await()
    expect(pane.api!.panes!.register({
      id: 'during-renderer-gap',
      placement: 'bottom',
      render: () => {
        pane.gapRenders += 1
        return { kind: 'text', content: 'renderer-gap-pane' }
      },
    })).toMatchObject({ ok: true })

    await ctx.loader.update(coreEntry!.id, { disabled: false })
    await ctx.loader.await()
    ctx.blueScreen.requestRender(true)
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(pane.gapRenders).toBeGreaterThan(0)
    expect(output()).toContain('renderer-gap-pane')

    const apiEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'blue-api-host')
    expect(apiEntry).toBeDefined()
    await ctx.loader.update(apiEntry!.id, { disabled: true })
    await ctx.loader.await()
    expect(pane.api!.panes!.register({ id: 'after-host-unload', placement: 'bottom', render: () => null })).toMatchObject({
      ok: false,
      code: 'BLUE_ACTION_REJECTED',
    })
  })

  it('broadcasts blue/terminal-theme-changed when the terminal reports a scheme', async () => {
    const { ctx } = await bootBlueCore()
    const schemes: ('dark' | 'light')[] = []
    ctx.on('blue/terminal-theme-changed', scheme => schemes.push(scheme))
    // Simulate the terminal's mode 2031 report arriving on process stdin.
    process.stdin.emit('data', Buffer.from('\x1b[?997;2n', 'utf8'))
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(schemes).toEqual(['light'])
  })

  it('routes input through the global dispatcher before the focused component', async () => {
    const { ctx } = await bootBlueCore()
    const handler = vi.fn()
    ctx.blueKeymap.register([{ id: 'blue.transcript.toggle', keys: 'ctrl+o', handler }])

    const received: string[] = []
    const focused = {
      focused: false,
      render: () => ['probe'],
      invalidate: () => {},
      handleInput: (data: string) => received.push(data),
    }
    ctx.blueScreen.addChild(focused)
    ctx.blueScreen.setFocus(focused)

    // A matching sequence is consumed by the handler before focus routing.
    process.stdin.emit('data', Buffer.from('\x0f', 'utf8'))
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(received).toEqual([])

    // A non-matching sequence passes through to the focused component.
    process.stdin.emit('data', Buffer.from('a', 'utf8'))
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(received).toEqual(['a'])

    // Unloading removes the dispatcher listener with the fiber.
    await ctx.fiber.dispose()
    process.stdin.emit('data', Buffer.from('\x0f', 'utf8'))
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('stops the terminal and removes the services when the tree unloads', async () => {
    const { ctx, output } = await bootBlueCore()
    await ctx.fiber.dispose()
    // TuiBase.stop shows the cursor; ProcessTerminal.stop disables bracketed paste.
    expect(output()).toContain('\x1b[?2004l')
    expect(output()).toContain('\x1b[?1002l')
    expect(output()).toContain('\x1b[?1049l')
    expect(ctx.get('blueScreen')).toBeUndefined()
    expect(ctx.get('blueKeymap')).toBeUndefined()
    expect(ctx.get('blueTerminalInfo')).toBeUndefined()
    expect(ctx.get('blueComponents')).toBeUndefined()
    expect(ctx.get('blueTheme')).toBeUndefined()
  })
})
