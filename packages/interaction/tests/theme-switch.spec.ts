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
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as themeDark from '@dsh-blue/blue-core/theme-dark'
import * as themeLight from '@dsh-blue/blue-core/theme-light'
import { BlueTerminalInfoService } from '../../core/src/terminal-info.ts'
import * as commandsPlugin from '../src/commands-plugin.ts'

const USAGE = 'usage: /theme [dark|light|auto|custom <path> [dark|light]]'

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
  const execution = await ctx.commands.execute(agent, line, new AbortController().signal)
  return execution?.result
}

describe('/theme command', () => {
  it('lists the known themes, marking the live one', async () => {
    const { ctx, agent } = await mount()
    const result = await execute(ctx, agent, '/theme')
    expect(result).toEqual({ kind: 'success', text: 'themes: dark (current), light, auto, custom' })
  })

  it('swaps built-in palettes through the real registry', async () => {
    const { ctx, agent } = await mount()
    await ctx.plugin(themeDark)
    expect(ctx.get('blueTheme')?.colors).toBe(themeDark.DARK_COLORS)
    const toLight = await execute(ctx, agent, '/theme light')
    expect(toLight).toEqual({ kind: 'success', text: 'switched to theme "light"' })
    expect(ctx.get('blueTheme')?.colors).toBe(themeLight.LIGHT_COLORS)
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
    expect(list).toEqual({ kind: 'success', text: 'themes: dark, light, auto, custom (current)' })
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

  it('rejects malformed invocations with the usage text and keeps the live theme', async () => {
    const { ctx, agent } = await mount()
    expect(await execute(ctx, agent, '/theme bogus')).toEqual({ kind: 'error', text: USAGE })
    expect(await execute(ctx, agent, '/theme dark extra')).toEqual({ kind: 'error', text: USAGE })
    expect(await execute(ctx, agent, '/theme custom')).toEqual({ kind: 'error', text: USAGE })
    expect(await execute(ctx, agent, `/theme custom ${join(dir, 'x.json')} light extra`))
      .toEqual({ kind: 'error', text: USAGE })
    const list = await execute(ctx, agent, '/theme')
    expect(list).toEqual({ kind: 'success', text: 'themes: dark, light, auto, custom (current)' })
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
    expect(list).toEqual({ kind: 'success', text: 'themes: dark (current), light, auto, custom' })
  })

  it('unregisters the command when the fiber disposes', async () => {
    const { ctx, agent, fiber } = await mount()
    expect(ctx.commands.find(agent, 'theme')).toBeDefined()
    await fiber.dispose()
    expect(ctx.commands.find(agent, 'theme')).toBeUndefined()
  })
})
