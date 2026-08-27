/**
 * `/plugin` command contract tests: marketplace reads, pinned-GitHub guards,
 * profile discovery, delegated installs, error mapping, and disposal.
 *
 * @module @dsh-blue/blue-interaction/plugin-command-tests
 */

import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { registerPluginCommand } from '../src/plugin-command.ts'

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
})
