/**
 * `/plugin` command contract tests: marketplace reads, pinned-GitHub guards,
 * profile discovery, delegated installs, error mapping, and disposal.
 *
 * @module @dsh-blue/blue-interaction/plugin-command-tests
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { registerPluginCommand } from '../src/plugin-command.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import { fakeBlueContext, KEY } from './fakes.ts'

registerTempDirCleanup()

const REAL_ARGV = [...process.argv]
const REAL_ENV = { ...process.env }

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...REAL_ARGV)
  for (const key of Object.keys(process.env)) {
    if (!(key in REAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, REAL_ENV)
  vi.unstubAllGlobals()
})

async function mount(): Promise<{
  ctx: Context
  agent: Agent
  execute(input: string): Promise<unknown>
  dispose(): void
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId(`plugin-command-${Math.random()}`))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  const dispose = registerPluginCommand(ctx)
  return {
    ctx,
    agent,
    execute: async input => (await ctx.commands.execute(agent, `/plugin ${input}`, [], new AbortController().signal))?.result,
    dispose,
  }
}

async function mountPanel(): Promise<{
  ctx: Context
  screen: ReturnType<typeof fakeBlueContext>['screen']
  host: string
  dsh: string
  execute(input: string): Promise<unknown>
  dispose(): void
}> {
  const display = fakeBlueContext()
  const ctx = display.ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId(`plugin-panel-${Math.random()}`))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  const home = mkdtempTracked('blue-plugin-panel-home-')
  const profileRoot = join(home, 'profiles', 'blue')
  const packageRoot = join(profileRoot, 'node_modules', '@scope', 'installed')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { '@scope/installed': 'github:owner/repo.git@deadbeef', '@scope/stable': '1.0.0', '@scope/internal': '1.0.0', '@scope/broken': '1.0.0', '@scope/noversion': '1.0.0' },
  }))
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@scope/installed', version: '1.0.0' }))
  const stableRoot = join(profileRoot, 'node_modules', '@scope', 'stable')
  mkdirSync(stableRoot, { recursive: true })
  writeFileSync(join(stableRoot, 'package.json'), JSON.stringify({ name: '@scope/stable', version: '2.0.0' }))
  const internalRoot = join(profileRoot, 'node_modules', '@scope', 'internal')
  mkdirSync(internalRoot, { recursive: true })
  writeFileSync(join(internalRoot, 'package.json'), JSON.stringify({ name: '@scope/internal', version: '1.0.0' }))
  const brokenRoot = join(profileRoot, 'node_modules', '@scope', 'broken')
  mkdirSync(brokenRoot, { recursive: true })
  writeFileSync(join(brokenRoot, 'package.json'), '{broken')
  const noVersionRoot = join(profileRoot, 'node_modules', '@scope', 'noversion')
  mkdirSync(noVersionRoot, { recursive: true })
  writeFileSync(join(noVersionRoot, 'package.json'), JSON.stringify({ name: '@scope/noversion', version: '5.0.0' }))
  const unscopedRoot = join(profileRoot, 'node_modules', 'plain-package')
  mkdirSync(unscopedRoot, { recursive: true })
  writeFileSync(join(unscopedRoot, 'package.json'), JSON.stringify({ name: 'plain-package', version: '1.2.3' }))
  const host = join(home, 'dsh-host.mjs')
  writeFileSync(host, "console.log('profile operation complete')\n")
  const dsh = join(home, 'dsh')
  writeFileSync(dsh, "#!/usr/bin/env node\nconsole.log('profile operation complete')\n")
  chmodSync(dsh, 0o755)
  process.env.DSH_HOME = home
  process.env.BLUE_DSH_BIN = host
  registry({ plugins: [
    { id: 'installed', package: '@scope/installed', version: '2.0.0', title: { en: 'Installed plugin' } },
    { id: 'stable', package: '@scope/stable', version: '2.0.0', title: { en: 'Stable plugin' } },
    { id: 'broken', package: '@scope/broken', version: '1.0.0', title: { en: 'Broken plugin' } },
    { package: '@scope/noversion', title: { zh: 'No version' } },
    { id: 'not-installed', package: '@scope/not-installed', version: '1.0.0' },
    { id: 'available', package: '@scope/available', version: '3.0.0', title: { en: 'Available plugin' }, install: [{ kind: 'npm', spec: '@scope/available@3.0.0' }] },
    { id: 'fallback', package: '@scope/fallback', version: '4.0.0', title: { en: 'Fallback plugin' }, install: [{ kind: 'npm' }] },
    { id: 'unversioned', package: '@scope/unversioned', title: { en: 'Unversioned plugin' } },
    { id: 'plain', package: 'plain-package', version: '1.2.3', title: { en: 'Plain package' } },
    { package: '@scope/no-id', version: '6.0.0', title: { en: 'No id' } },
    { id: 'metadata-only' },
  ] })
  setSharedEditor(ctx, { editor: display.components.createEditor(), submitPrompt: () => {}, notice: vi.fn() })
  const dispose = registerPluginCommand(ctx)
  return {
    ctx,
    screen: display.screen,
    host,
    dsh,
    execute: async input => (await ctx.commands.execute(agent, `/plugin ${input}`, [], new AbortController().signal))?.result,
    dispose,
  }
}

function registry(value: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(value), { status: 200 })))
}

describe('registerPluginCommand', () => {
  it('lists, searches, and inspects official marketplace entries', async () => {
    registry({ plugins: [
      { id: 'blue-doudizhu', package: '@dsh-blue/blue-doudizhu', version: '1.0.0', title: { en: 'Doudizhu' } },
      { id: 'zh-only', version: '2.0.0', title: { zh: '中文标题' } },
      { id: 'bare' },
      { title: {} },
    ] })
    const world = await mount()
    await expect(world.execute('')).resolves.toEqual({ kind: 'success', text: 'blue-doudizhu@1.0.0\nzh-only@2.0.0\nbare@\n@' })
    await expect(world.execute('search doudi')).resolves.toEqual({ kind: 'success', text: 'blue-doudizhu — Doudizhu' })
    await expect(world.execute('search zh-only')).resolves.toEqual({ kind: 'success', text: 'zh-only — 中文标题' })
    await expect(world.execute('search bare')).resolves.toEqual({ kind: 'success', text: 'bare — ' })
    await expect(world.execute('search title')).resolves.toEqual({
      kind: 'success',
      text: 'blue-doudizhu — Doudizhu\nzh-only — 中文标题\n — ',
    })
    await expect(world.execute('search absent')).resolves.toEqual({ kind: 'success', text: 'no matching plugins' })
    await expect(world.execute('info blue-doudizhu')).resolves.toMatchObject({ kind: 'success' })
    await expect(world.execute('info @dsh-blue/blue-doudizhu')).resolves.toMatchObject({ kind: 'success' })
    await expect(world.execute('info absent')).resolves.toEqual({ kind: 'error', text: 'plugin not found: absent' })
    await expect(world.execute('info')).resolves.toEqual({ kind: 'error', text: 'usage: /plugin info <id-or-package>' })
  })

  it('handles an empty registry, verification requests, and unknown actions', async () => {
    registry({})
    const world = await mount()
    await expect(world.execute('list')).resolves.toEqual({ kind: 'success', text: 'marketplace is empty' })
    await expect(world.execute('verify')).resolves.toEqual({
      kind: 'success',
      text: 'verification requested for ; use blue-plugin-validate and the packed fixture before enabling',
    })
    await expect(world.execute('remove x')).resolves.toEqual({ kind: 'error', text: 'unknown plugin action: remove' })
  })

  it('requires an install spec and pins both GitHub spec forms', async () => {
    const world = await mount()
    await expect(world.execute('install')).resolves.toEqual({
      kind: 'error',
      text: 'usage: /plugin install <marketplace id, npm spec, or pinned GitHub commit>',
    })
    for (const spec of ['https://github.com/owner/repo', 'github:owner/repo']) {
      await expect(world.execute(`install ${spec}`)).resolves.toEqual({
        kind: 'error',
        text: 'GitHub plugins must be pinned to a commit (append @<sha>)',
      })
    }
  })

  it('delegates a pinned GitHub install through BLUE_DSH_BIN and --profile=', async () => {
    const dir = mkdtempTracked('blue-plugin-command-host-')
    const host = join(dir, 'host.mjs')
    writeFileSync(host, "console.log(process.argv.slice(2).join('|'))\n")
    process.env.BLUE_DSH_BIN = host
    process.argv.push('--profile=acceptance')
    const world = await mount()
    const result = await world.execute('install github:owner/repo@deadbeef')
    expect(result).toEqual({
      kind: 'success',
      text: 'plugin|--profile|acceptance|add|github:owner/repo@deadbeef\ninstalled; restart Blue to apply',
    })
  })

  it('rewrites GitHub installs through the configured marketplace proxy', async () => {
    const dir = mkdtempTracked('blue-plugin-command-proxy-')
    const host = join(dir, 'host.mjs')
    writeFileSync(host, "console.log(process.argv.slice(2).join('|'))\n")
    process.env.BLUE_DSH_BIN = host
    process.env.BLUE_MARKETPLACE_GITHUB_PROXY = 'https://gh-proxy.com/'
    const world = await mount()
    await expect(world.execute('install github:owner/repo@deadbeef')).resolves.toEqual({
      kind: 'success',
      text: 'plugin|--profile|blue|add|git+https://gh-proxy.com/https://github.com/owner/repo.git#deadbeef\ninstalled; restart Blue to apply',
    })
    await expect(world.execute('install https://github.com/owner/repo.git@deadbeef')).resolves.toEqual({
      kind: 'success',
      text: 'plugin|--profile|blue|add|git+https://gh-proxy.com/https://github.com/owner/repo.git@deadbeef\ninstalled; restart Blue to apply',
    })
  })

  it('delegates npm installs to global dsh with spaced and default profiles', async () => {
    const dir = mkdtempTracked('blue-plugin-command-path-')
    const dsh = join(dir, 'dsh')
    writeFileSync(dsh, "#!/usr/bin/env node\nconsole.log(process.argv.slice(2).join('|'))\n")
    chmodSync(dsh, 0o755)
    delete process.env.BLUE_DSH_BIN
    process.env.PATH = `${dir}:${process.env.PATH ?? ''}`
    process.argv.push('--profile', 'staging')
    const world = await mount()
    await expect(world.execute('install @scope/plugin@1.0.0')).resolves.toEqual({
      kind: 'success',
      text: 'plugin|--profile|staging|add|@scope/plugin@1.0.0\ninstalled; restart Blue to apply',
    })
    process.argv.splice(REAL_ARGV.length)
    await expect(world.execute('install @scope/plugin@1.0.1')).resolves.toEqual({
      kind: 'success',
      text: 'plugin|--profile|blue|add|@scope/plugin@1.0.1\ninstalled; restart Blue to apply',
    })
    writeFileSync(dsh, '#!/usr/bin/env node\n')
    chmodSync(dsh, 0o755)
    await expect(world.execute('install @scope/plugin@1.0.2')).resolves.toEqual({
      kind: 'success',
      text: '\ninstalled; restart Blue to apply',
    })
  })

  it('maps registry and delegated-process failures and unregisters on dispose', async () => {
    process.env.BLUE_MARKETPLACE_REGISTRY = 'https://registry.example.test/plugins.json'
    const request = vi.fn(async () => new Response('down', { status: 503 }))
    vi.stubGlobal('fetch', request)
    const world = await mount()
    await expect(world.execute('list')).resolves.toEqual({
      kind: 'error',
      text: 'plugin operation failed: marketplace registry returned HTTP 503',
    })
    expect(request).toHaveBeenCalledWith('https://registry.example.test/plugins.json')
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'offline' }))
    await expect(world.execute('list')).resolves.toEqual({ kind: 'error', text: 'plugin operation failed: offline' })
    process.env.BLUE_DSH_BIN = join(mkdtempTracked('blue-plugin-command-missing-'), 'missing.mjs')
    await expect(world.execute('install @scope/missing')).resolves.toMatchObject({ kind: 'error' })
    world.dispose()
    expect(world.ctx.commands.find(world.agent, 'plugin')).toBeUndefined()
  })

  it('maps a fetch failure while the display panel is loading', async () => {
    const display = fakeBlueContext()
    await display.ctx.plugin(SessionStore)
    await display.ctx.plugin(CommandRuntime)
    const session = display.ctx.sessions.create(SessionId(`plugin-panel-error-${Math.random()}`))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    setSharedEditor(display.ctx, { editor: display.components.createEditor(), submitPrompt: () => {}, notice: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed') }))
    const dispose = registerPluginCommand(display.ctx)
    await expect(display.ctx.commands.execute(agent, '/plugin', [], new AbortController().signal)).resolves.toMatchObject({
      result: { kind: 'error', text: 'plugin operation failed: fetch failed; configure BLUE_MARKETPLACE_REGISTRY to a reachable registry URL' },
    })
    dispose()

    vi.stubGlobal('fetch', vi.fn(async () => { throw 'offline' }))
    const stringErrorDispose = registerPluginCommand(display.ctx)
    await expect(display.ctx.commands.execute(agent, '/plugin', [], new AbortController().signal)).resolves.toMatchObject({
      result: { kind: 'error', text: 'plugin operation failed: offline' },
    })
    stringErrorDispose()
  })

  it('opens the plugin panel and runs install, upgrade, and uninstall actions', async () => {
    const world = await mountPanel()
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    expect(panel.render(100).join('\n')).toContain('Installed plugin')
    expect(panel.render(100).join('\n')).toContain('‹ Installed ›')

    // The first installed row is behind an upgrade confirmation form.
    panel.handleInput(KEY.enter)
    const cancelledForm = world.screen.overlays.at(-1)?.component as { handleInput(data: string): void }
    cancelledForm.handleInput(KEY.escape)
    panel.handleInput(KEY.enter)
    const form = world.screen.overlays.at(-1)?.component as { handleInput(data: string): void }
    form.handleInput('n')
    form.handleInput(KEY.enter)
    form.handleInput('\x7f')
    form.handleInput('y')
    form.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('upgraded; restart Blue to apply'))

    // Switch to the marketplace page and install its selected entry.
    panel.handleInput(KEY.tab)
    expect(panel.render(100).join('\n')).toContain('‹ Available ›')
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('installed; restart Blue to apply'))
    expect((panel as unknown as { group: number }).group).toBe(1)

    // Return to Installed and choose the up-to-date row to exercise removal.
    panel.handleInput(KEY.shiftTab)
    expect((panel as unknown as { group: number }).group).toBe(0)
    expect(panel.render(100).join('\n')).toContain('‹ Installed ›')
    panel.handleInput(KEY.down)
    const selectedNoVersion = panel.render(100).find(row => row.includes('No version')) ?? ''
    expect(selectedNoVersion).toContain('●')
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('uninstalled; restart Blue to apply'))
    const panelOptions = panel as unknown as { options: { onAction(action: unknown): void } }
    const runPanelAction = async (row: { packageName: string, label: string, spec: string }, output: string): Promise<void> => {
      writeFileSync(world.host, `console.log('${output}')\n`)
      panelOptions.options.onAction({ kind: 'plugin.install', row })
      await vi.waitFor(() => {
        const rendered = panel.render(100).join('\n')
        expect(rendered).toContain(output)
        expect(rendered).toContain('installed; restart Blue to apply')
      })
    }
    process.env.BLUE_MARKETPLACE_GITHUB_PROXY = 'https://proxy.test/'
    await runPanelAction({ packageName: '@scope/github-short', label: 'GitHub short', spec: 'github:owner/repo' }, 'short')
    await runPanelAction({ packageName: '@scope/github-suffixed', label: 'GitHub suffixed', spec: 'github:owner/repo.git' }, 'suffixed')
    await runPanelAction({ packageName: '@scope/github-url', label: 'GitHub URL', spec: 'https://github.com/owner/repo' }, 'url')
    await runPanelAction({ packageName: '@scope/github-pinned-url', label: 'GitHub pinned URL', spec: 'https://github.com/owner/repo#deadbeef' }, 'pinned-url')
    delete process.env.BLUE_DSH_BIN
    process.env.PATH = `${join(world.dsh, '..')}:${process.env.PATH ?? ''}`
    await runPanelAction({ packageName: '@scope/no-latest', label: 'No latest', spec: '@scope/no-latest' }, 'profile operation complete')
    process.env.BLUE_DSH_BIN = world.host
    writeFileSync(world.host, "process.exit(0)\n")
    panelOptions.options.onAction({ kind: 'plugin.install', row: { packageName: '@scope/empty-output', label: 'Empty output', spec: '@scope/empty-output' } })
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('add completed'))
    writeFileSync(world.host, "console.error('operation failed'); process.exit(1)\n")
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed'))
    panelOptions.options.onAction({ kind: 'plugin.unknown', row: { packageName: '@scope/unknown', label: 'Unknown', spec: '@scope/unknown' } })
    panel.handleInput(KEY.escape)
    panel.handleInput(KEY.escape)
    world.dispose()
  })
})
