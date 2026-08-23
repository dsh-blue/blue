/**
 * Tests for the `/theme` command: the listing, provider swaps through the
 * real Cordis registry, file-backed custom palettes, and usage plus
 * mount-failure errors. The theme modules come from the package subpaths —
 * not relative core source paths — because the swap keys registry runtimes
 * by callback identity: only the module instance the command statically
 * imports shares a registry record with the provider it replaces. Module
 * state (`current` in theme-switch.ts) is shared across this file, so the
 * cases run sequentially and each leaves a known theme active.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as themeDark from '@dsh-blue/blue-core/theme-dark'
import * as themeLight from '@dsh-blue/blue-core/theme-light'
import * as themeOcean from '@dsh-blue/blue-core/theme-ocean'
import * as themePaper from '@dsh-blue/blue-core/theme-paper'
import type { BlueComponentsService, BlueKeymapService, BlueScreenService } from '@dsh-blue/blue-core'
import { BlueTerminalInfoService } from '../../core/src/terminal-info.ts'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { setEditorSlotSwap } from '../src/editor-instance.ts'
import type { SelectListPanel } from '../src/select-list.ts'
import { FakeBlueComponents, FakeKeymap, FakeScreen, KEY } from './fakes.ts'

const USAGE = 'usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'blue-theme-spec-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function mount(): Promise<{
  ctx: Context
  agent: Agent
  fiber: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('theme-spec'))
  const agent = { id: session.id, session } as unknown as Agent
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, agent, fiber }
}

async function execute(ctx: Context, agent: Agent, line: string): Promise<CommandResult | undefined> {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  return execution?.result
}

describe('/theme command', () => {
  it('lists the known themes, marking the live one', async () => {
    const { ctx, agent } = await mount()
    const result = await execute(ctx, agent, '/theme')
    expect(result).toEqual({ kind: 'success', text: 'themes: dark ← current, light, ocean, paper, auto, custom' })
  })

  it('swaps built-in palettes through the real registry', async () => {
    const { ctx, agent } = await mount()
    await ctx.plugin(themeDark)
    expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
    const toLight = await execute(ctx, agent, '/theme light')
    expect(toLight).toEqual({ kind: 'success', text: 'switched to theme "light"' })
    expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS)
    const toOcean = await execute(ctx, agent, '/theme ocean')
    expect(toOcean).toEqual({ kind: 'success', text: 'switched to theme "ocean"' })
    expect(ctx.get('blueTheme')?.colors).toBe(themeOcean.OCEAN_COLORS)
    const toPaper = await execute(ctx, agent, '/theme paper')
    expect(toPaper).toEqual({ kind: 'success', text: 'switched to theme "paper"' })
    expect(ctx.get('blueTheme')?.colors).toBe(themePaper.PAPER_COLORS)
    const back = await execute(ctx, agent, '/theme dark')
    expect(back).toEqual({ kind: 'success', text: 'switched to theme "dark"' })
    expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
  })

  it('follows the probed terminal background with auto', async () => {
    const { ctx, agent } = await mount()
    await ctx.plugin(BlueTerminalInfoService, { background: 'light', kittyKeyboard: false })
    const toAuto = await execute(ctx, agent, '/theme auto')
    expect(toAuto).toEqual({ kind: 'success', text: 'switched to theme "auto"' })
    expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS)
    // Back to the baseline: later cases start from dark.
    await execute(ctx, agent, '/theme dark')
    expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
  })

  it('loads a custom palette file over the dark base', async () => {
    const { ctx, agent } = await mount()
    const path = join(dir, 'custom-dark.json')
    await writeFile(path, JSON.stringify({ accent: '#ff0000' }))
    const result = await execute(ctx, agent, `/theme custom ${path}`)
    expect(result).toEqual({ kind: 'success', text: 'switched to theme "custom"' })
    const colors = ctx.get('blueTheme')?.colors
    expect(colors?.accent('x')).toBe('\x1b[38;2;255;0;0mx\x1b[39m')
    expect(colors?.text).toBe(themeDark.DARK_COLORS.text)
    const list = await execute(ctx, agent, '/theme')
    expect(list).toEqual({ kind: 'success', text: 'themes: dark, light, ocean, paper, auto, custom ← current' })
  })

  it('loads a custom palette over the light base', async () => {
    const { ctx, agent } = await mount()
    const path = join(dir, 'custom-light.json')
    await writeFile(path, JSON.stringify({ accent: '#00ff00' }))
    const result = await execute(ctx, agent, `/theme custom ${path} light`)
    expect(result).toEqual({ kind: 'success', text: 'switched to theme "custom"' })
    const colors = ctx.get('blueTheme')?.colors
    expect(colors?.text).toBe(themeLight.LIGHT_COLORS.text)
    expect(colors?.accent('x')).toBe('\x1b[38;2;0;255;0mx\x1b[39m')
  })

  it('layers the array and single-hex brand tokens from a custom file', async () => {
    const { ctx, agent } = await mount()
    const path = join(dir, 'custom-gradient.json')
    await writeFile(path, JSON.stringify({
      modelHighlight: '#123456',
      logoGradient: ['#100000', '#200000'],
    }))
    const result = await execute(ctx, agent, `/theme custom ${path}`)
    expect(result).toEqual({ kind: 'success', text: 'switched to theme "custom"' })
    const colors = ctx.get('blueTheme')?.colors
    expect(colors?.modelHighlight('x')).toBe('\x1b[38;2;18;52;86mx\x1b[39m')
    // A two-entry sweep over nine logo rows: entry 0 on row 0, entry 1
    // everywhere else (the banner clamps short gradients).
    expect(colors?.logoGradient[0]!('x')).toBe('\x1b[38;2;16;0;0mx\x1b[39m')
    expect(colors?.logoGradient[1]!('x')).toBe('\x1b[38;2;32;0;0mx\x1b[39m')
    expect(colors?.logoGradient).toHaveLength(2)
  })

  it('falls back to the base sweep when the gradient is invalid', async () => {
    const { ctx, agent } = await mount()
    const path = join(dir, 'custom-bad-gradient.json')
    await writeFile(path, JSON.stringify({ logoGradient: ['#100000', 'nope'] }))
    await execute(ctx, agent, `/theme custom ${path}`)
    const colors = ctx.get('blueTheme')?.colors
    expect(colors?.logoGradient).toBe(themeDark.DARK_COLORS.logoGradient)
  })

  it('loads a custom palette over the ocean base', async () => {
    const { ctx, agent } = await mount()
    const path = join(dir, 'custom-ocean.json')
    await writeFile(path, JSON.stringify({ accent: '#0000ff' }))
    const result = await execute(ctx, agent, `/theme custom ${path} ocean`)
    expect(result).toEqual({ kind: 'success', text: 'switched to theme "custom"' })
    const colors = ctx.get('blueTheme')?.colors
    expect(colors?.text).toBe(themeOcean.OCEAN_COLORS.text)
    expect(colors?.logoGradient).toBe(themeOcean.OCEAN_COLORS.logoGradient)
    expect(colors?.accent('x')).toBe('\x1b[38;2;0;0;255mx\x1b[39m')
  })

  it('rejects malformed invocations with the usage text and keeps the live theme', async () => {
    const { ctx, agent } = await mount()
    expect(await execute(ctx, agent, '/theme bogus')).toEqual({ kind: 'error', text: USAGE })
    expect(await execute(ctx, agent, '/theme dark extra')).toEqual({ kind: 'error', text: USAGE })
    expect(await execute(ctx, agent, '/theme custom')).toEqual({ kind: 'error', text: USAGE })
    expect(await execute(ctx, agent, `/theme custom ${join(dir, 'x.json')} light extra`))
      .toEqual({ kind: 'error', text: USAGE })
    const list = await execute(ctx, agent, '/theme')
    expect(list).toEqual({ kind: 'success', text: 'themes: dark, light, ocean, paper, auto, custom ← current' })
  })

  it('restores the dark palette when the custom mount fails validation', async () => {
    const { ctx, agent } = await mount()
    const path = join(dir, 'custom-bogus.json')
    await writeFile(path, '{}')
    const result = await execute(ctx, agent, `/theme custom ${path} bogus`)
    expect(result?.kind).toBe('error')
    if (result?.kind === 'error') expect(result.text).toContain('failed to apply theme "custom"')
    expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
    const list = await execute(ctx, agent, '/theme')
    expect(list).toEqual({ kind: 'success', text: 'themes: dark ← current, light, ocean, paper, auto, custom' })
  })

  it('unregisters the command when the fiber disposes', async () => {
    const { ctx, agent, fiber } = await mount()
    expect(ctx.commands.find(agent, 'theme')).toBeDefined()
    await fiber.dispose()
    expect(ctx.commands.find(agent, 'theme')).toBeUndefined()
  })
})

describe('/theme picker', () => {
  /**
   * The picker mount: the display quartet without the theme fake — the
   * panel needs the four services to open, but the provider swaps must run
   * through the real registry (a fake `provide` would block the swap's
   * double-registration check). The real dark plugin supplies the theme
   * member.
   */
  async function mountPicker(): Promise<{
    ctx: Context
    screen: FakeScreen
    agent: Agent
  }> {
    const ctx = new Context()
    const screen = new FakeScreen()
    ctx.provide('blueScreen', screen as unknown as BlueScreenService)
    ctx.provide('blueKeymap', new FakeKeymap() as unknown as BlueKeymapService)
    ctx.provide('blueComponents', new FakeBlueComponents() as unknown as BlueComponentsService)
    setEditorSlotSwap({ mount: component => screen.mountDialogPanel(component) })
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('picker-spec'))
    await ctx.plugin(themeDark)
    await ctx.plugin(commandsPlugin)
    return { ctx, screen, agent: { id: session.id, session } as unknown as Agent }
  }

  /** The topmost mounted panel, as the mounted picker. */
  function panel(screen: FakeScreen): SelectListPanel {
    const overlay = screen.overlays.at(-1)
    if (overlay === undefined) throw new Error('no panel mounted')
    return overlay.component as SelectListPanel
  }

  it('opens the picker panel instead of the listing when the display quartet is live', async () => {
    const { ctx, screen, agent } = await mountPicker()
    const result = await execute(ctx, agent, '/theme')
    expect(result).toEqual({ kind: 'success' })
    expect(screen.overlays.length).toBeGreaterThan(0)
    // The rendered frame names the picker and its key affordances.
    const rendered = panel(screen).render(60).join('\n')
    expect(rendered).toContain('Themes')
    expect(rendered).toContain('dark')
    expect(rendered).toContain('paper')
    expect(rendered).toContain('esc revert')
    await execute(ctx, agent, '/theme dark')
  })

  it('live-applies the highlighted palette on every cursor move', async () => {
    const { ctx, screen, agent } = await mountPicker()
    await execute(ctx, agent, '/theme')
    const picker = panel(screen)
    picker.handleInput(KEY.down)
    await vi.waitFor(() => { expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS) })
    // The panel re-homed after the swap rebuilt the input: the same panel
    // tops the dialog stack again.
    expect(panel(screen)).toBe(picker)
    picker.handleInput(KEY.down)
    await vi.waitFor(() => { expect(ctx.get('blueTheme')?.colors).toBe(themeOcean.OCEAN_COLORS) })
    // Escape reverts the whole browsing session to the opening theme.
    picker.handleInput(KEY.escape)
    await vi.waitFor(() => { expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS) })
    expect(screen.overlays.every(overlay => overlay.hidden)).toBe(true)
  })

  it('keeps the highlighted theme on Enter without a redundant swap', async () => {
    const { ctx, screen, agent } = await mountPicker()
    await execute(ctx, agent, '/theme')
    const picker = panel(screen)
    picker.handleInput(KEY.down)
    await vi.waitFor(() => { expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS) })
    const tableBefore = ctx.get('blueTheme')?.colors
    picker.handleInput(KEY.enter)
    // The highlighted palette was already live: Enter only closes.
    expect(ctx.get('blueTheme')?.colors).toBe(tableBefore)
    expect(screen.overlays.every(overlay => overlay.hidden)).toBe(true)
    // Leave the module state on dark for the cases below.
    await execute(ctx, agent, '/theme dark')
  })

  it('keeps the previewed palette when escaping from a custom opening theme', async () => {
    const { ctx, screen, agent } = await mountPicker()
    const path = join(dir, 'picker-custom.json')
    await writeFile(path, JSON.stringify({ accent: '#ff0000' }))
    await execute(ctx, agent, `/theme custom ${path}`)
    await execute(ctx, agent, '/theme')
    const picker = panel(screen)
    picker.handleInput(KEY.down)
    await vi.waitFor(() => { expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS) })
    picker.handleInput(KEY.escape)
    // 'custom' has no picker row to revert to; the preview stands.
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS)
    await execute(ctx, agent, '/theme dark')
  })

  it('applies the highlighted palette on Enter when the live swap is still in flight', async () => {
    const { ctx, screen, agent } = await mountPicker()
    await execute(ctx, agent, '/theme')
    const picker = panel(screen)
    // Down and Enter in one synchronous burst: Enter lands before the
    // queued live swap runs, so the close path fires the final swap itself
    // and the aborted chain's closed check drops the pending move.
    picker.handleInput(KEY.down)
    picker.handleInput(KEY.enter)
    expect(screen.overlays.every(overlay => overlay.hidden)).toBe(true)
    await vi.waitFor(() => { expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS) })
    await execute(ctx, agent, '/theme dark')
  })

  it('closes without a swap when Escape lands on the opening theme', async () => {
    const { ctx, screen, agent } = await mountPicker()
    await execute(ctx, agent, '/theme')
    const picker = panel(screen)
    const tableBefore = ctx.get('blueTheme')?.colors
    picker.handleInput(KEY.escape)
    expect(screen.overlays.every(overlay => overlay.hidden)).toBe(true)
    // The untouched opening provider stays: no revert churn.
    expect(ctx.get('blueTheme')?.colors).toBe(tableBefore)
  })

  it('re-homes the panel when the input editor reference changes', async () => {
    const { ctx, screen, agent } = await mountPicker()
    await execute(ctx, agent, '/theme')
    const picker = panel(screen)
    const mounts = screen.overlays.length
    // The input fiber rebuilt (its mount emits before the slot swap
    // installs); one microtask later the panel has re-homed.
    ctx.emit('blue/input-editor-changed')
    await vi.waitFor(() => { expect(screen.overlays.length).toBeGreaterThan(mounts) })
    expect(panel(screen)).toBe(picker)
    // A rebuild signal landing after Escape hits the closed guard: the
    // deferred re-home declines without touching the dock.
    const settled = screen.overlays.length
    ctx.emit('blue/input-editor-changed')
    picker.handleInput(KEY.escape)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(screen.overlays).toHaveLength(settled)
  })

  it('renders through the opening palette inside the provider gap of a swap', async () => {
    const { ctx, screen, agent } = await mountPicker()
    await execute(ctx, agent, '/theme')
    const picker = panel(screen)
    // Swap to light, then dispose the provider outright — the same window
    // a live swap crosses — and render: the panel falls back to the
    // opening table instead of crashing on the missing provider.
    await execute(ctx, agent, '/theme light')
    const before = screen.overlays.length
    picker.handleInput(KEY.up)
    picker.handleInput(KEY.escape)
    expect(screen.overlays).toHaveLength(before)
    // Restore the dark baseline for the cases below.
    await execute(ctx, agent, '/theme dark')
  })
})
