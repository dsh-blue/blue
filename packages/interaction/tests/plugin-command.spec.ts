/**
 * `/plugin` local inventory, compatibility, verification, and profile-owner
 * mutation tests. The paused marketplace has no network path in this suite.
 *
 * @module @dsh-blue/blue-interaction/plugin-command-tests
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createPluginPackage } from '../../plugin-kit/src/create.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { pluginCommandInternals, registerPluginCommand } from '../src/plugin-command.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import { fakeBlueContext, KEY } from './fakes.ts'

registerTempDirCleanup()

const REAL_ARGV = [...process.argv]
const REAL_ENV = { ...process.env }

afterEach(() => {
  process.argv.splice(0, process.argv.length, ...REAL_ARGV)
  for (const key of Object.keys(process.env)) if (!(key in REAL_ENV)) delete process.env[key]
  Object.assign(process.env, REAL_ENV)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

interface World {
  readonly ctx: Context
  readonly agent: Agent
  readonly home: string
  readonly profile: string
  readonly host: string
  readonly execute: (input: string) => Promise<unknown>
  readonly dispose: () => void
}

function profilePackageRoot(world: Pick<World, 'profile'>, packageName: string): string {
  return join(world.profile, 'node_modules', ...packageName.split('/'))
}

function writeProfileManifest(profile: string, dependencies: Readonly<Record<string, string>>): void {
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'test-profile', private: true, dependencies }))
}

function addPlugin(world: Pick<World, 'profile'>, packageName: string, mutate?: (root: string) => void): string {
  const root = profilePackageRoot(world, packageName)
  const created = createPluginPackage({ directory: root, packageName })
  expect(created.ok).toBe(true)
  mutate?.(root)
  return root
}

async function mount(options: { readonly display?: boolean } = {}): Promise<World & { readonly screen?: ReturnType<typeof fakeBlueContext>['screen'] }> {
  const display = options.display === true ? fakeBlueContext() : undefined
  const ctx = display?.ctx ?? new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId(`plugin-command-${Math.random()}`))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  const home = mkdtempTracked('blue-plugin-command-home-')
  const profile = join(home, 'profiles', 'acceptance')
  writeProfileManifest(profile, {})
  const host = join(home, 'host.mjs')
  writeFileSync(host, "console.log(process.argv.slice(2).join('|'))\n")
  process.env.DSH_HOME = home
  process.env.BLUE_DSH_BIN = host
  process.argv.push('--profile', 'acceptance')
  if (display !== undefined) setSharedEditor(ctx, { editor: display.components.createEditor(), submitPrompt: () => {}, notice: vi.fn() })
  const dispose = registerPluginCommand(ctx)
  return {
    ctx,
    agent,
    home,
    profile,
    host,
    execute: async input => (await ctx.commands.execute(agent, `/plugin${input === '' ? '' : ` ${input}`}`, [], new AbortController().signal))?.result,
    dispose,
    ...(display === undefined ? {} : { screen: display.screen }),
  }
}

describe('plugin source admission', () => {
  it('accepts existing local paths and exact npm/GitHub sources only', () => {
    const root = mkdtempTracked('blue-plugin-source-')
    const tarball = join(root, 'plugin.tgz')
    writeFileSync(tarball, 'tarball')
    expect(pluginCommandInternals.installSource(root)).toEqual({ ok: true, kind: 'local', spec: `file:${resolve(root)}`, directory: resolve(root) })
    expect(pluginCommandInternals.installSource(`file:${tarball}`)).toEqual({ ok: true, kind: 'local', spec: `file:${tarball}` })
    expect(pluginCommandInternals.installSource(`link:${root}`)).toEqual({ ok: true, kind: 'local', spec: `file:${resolve(root)}`, directory: resolve(root) })
    expect(pluginCommandInternals.installSource('./definitely-missing')).toMatchObject({ ok: false, message: expect.stringContaining('does not exist') })
    expect(pluginCommandInternals.installSource('@scope/plugin@1.2.3')).toEqual({ ok: true, kind: 'npm', spec: '@scope/plugin@1.2.3' })
    expect(pluginCommandInternals.installSource('plain-plugin@1.2.3-rc.1')).toEqual({ ok: true, kind: 'npm', spec: 'plain-plugin@1.2.3-rc.1' })
    const sha = 'a'.repeat(40)
    expect(pluginCommandInternals.installSource(`github:owner/repo@${sha}`)).toEqual({ ok: true, kind: 'github', spec: `github:owner/repo@${sha}` })
    expect(pluginCommandInternals.installSource(`https://github.com/owner/repo#${sha}`)).toEqual({ ok: true, kind: 'github', spec: `https://github.com/owner/repo#${sha}` })
    for (const spec of ['@scope/plugin', '@scope/plugin@latest', '@scope/plugin@^1.0.0', 'Invalid@1.0.0', 'github:owner/repo@deadbeef']) {
      expect(pluginCommandInternals.installSource(spec)).toMatchObject({ ok: false })
    }
  })

  it('rewrites only full-commit GitHub sources through the optional proxy', () => {
    const sha = 'b'.repeat(40)
    const source = `github:owner/repo@${sha}`
    expect(pluginCommandInternals.withGitHubProxy(source)).toBe(source)
    process.env.BLUE_GITHUB_PROXY = '  '
    expect(pluginCommandInternals.withGitHubProxy(source)).toBe(source)
    process.env.BLUE_GITHUB_PROXY = 'https://proxy.example/'
    expect(pluginCommandInternals.withGitHubProxy(source)).toBe(`git+https://proxy.example/https://github.com/owner/repo.git#${sha}`)
    expect(pluginCommandInternals.withGitHubProxy(`https://github.com/owner/repo.git#${sha}`)).toBe(`git+https://proxy.example/https://github.com/owner/repo.git#${sha}`)
    expect(pluginCommandInternals.withGitHubProxy('@scope/plugin@1.0.0')).toBe('@scope/plugin@1.0.0')
  })

  it('normalizes process and validator edge reports', async () => {
    const run = vi.spyOn(pluginCommandInternals.effects, 'run')
    run.mockResolvedValueOnce({ stdout: '', stderr: '' })
    await expect(pluginCommandInternals.runProfileCommand('add', '@scope/plugin@1.0.0')).resolves.toBe('add completed')

    expect(pluginCommandInternals.parseValidationReport('not json')).toBeUndefined()
    expect(pluginCommandInternals.parseValidationReport('null')).toBeUndefined()
    expect(pluginCommandInternals.validationText({ valid: true })).toBe('verified plugin: valid (0 files)')
    expect(pluginCommandInternals.validationText({ valid: false })).toBe('verification failed for plugin')
    expect(pluginCommandInternals.validationText({
      valid: false,
      violations: [{}, {}, {}, {}, {}, { code: 'IGNORED', message: 'sixth' }],
    })).toBe('verification failed for plugin\nINVALID: validation failed\nINVALID: validation failed\nINVALID: validation failed\nINVALID: validation failed\nINVALID: validation failed')

    run.mockResolvedValueOnce({ stdout: 'not json', stderr: '' })
    await expect(pluginCommandInternals.validatePackage('/invalid-output')).rejects.toThrow('validator returned invalid JSON')
    const childError = { stdout: 'not json' }
    run.mockRejectedValueOnce(childError)
    await expect(pluginCommandInternals.validatePackage('/invalid-error-output')).rejects.toBe(childError)
    run.mockRejectedValueOnce({ stdout: JSON.stringify({ valid: false }) })
    await expect(pluginCommandInternals.validatePackage('/reported-error')).resolves.toEqual({ valid: false })
    run.mockRejectedValueOnce('process failed')
    await expect(pluginCommandInternals.validatePackage('/spawn-error')).rejects.toBe('process failed')
  })
})

describe('registerPluginCommand', () => {
  it('reports an empty local inventory without contacting a registry and unregisters', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const world = await mount()
    await expect(world.execute('')).resolves.toEqual({ kind: 'success', text: 'no Blue plugins installed; marketplace is paused' })
    await expect(world.execute('search anything')).resolves.toEqual({ kind: 'success', text: 'no matching installed plugins' })
    expect(fetch).not.toHaveBeenCalled()
    world.dispose()
    expect(world.ctx.commands.find(world.agent, 'plugin')).toBeUndefined()
  })

  it('discovers only manifest-declaring profile packages and classifies compatibility', async () => {
    const world = await mount()
    const dependencies: Record<string, string> = {
      '@scope/compatible': 'link:compatible',
      '@scope/incompatible': '2.0.0',
      '@scope/invalid': '3.0.0',
      '@scope/mismatch': '4.0.0',
      '@scope/escape': '5.0.0',
      '@scope/missing-manifest': '6.0.0',
      '@scope/no-blue': '7.0.0',
      '@scope/empty-pointer': '7.1.0',
      '@scope/broken-package': '8.0.0',
      '@scope/array-package': '9.0.0',
    }
    writeProfileManifest(world.profile, dependencies)
    addPlugin(world, '@scope/compatible')
    addPlugin(world, '@scope/incompatible', root => {
      const path = join(root, 'blue.plugin.json')
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      manifest.compatibility = { blue: '>=9.0.0', harness: '>=9.0.0', node: '>=99.0.0' }
      writeFileSync(path, JSON.stringify(manifest))
    })
    addPlugin(world, '@scope/invalid', root => writeFileSync(join(root, 'blue.plugin.json'), '{}'))
    addPlugin(world, '@scope/mismatch', root => {
      const path = join(root, 'blue.plugin.json')
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      manifest.id = '@scope/different'
      writeFileSync(path, JSON.stringify(manifest))
    })
    addPlugin(world, '@scope/escape', root => {
      const pkgPath = join(root, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      pkg.blue.manifest = '../outside.json'
      writeFileSync(pkgPath, JSON.stringify(pkg))
    })
    addPlugin(world, '@scope/missing-manifest', root => {
      const pkgPath = join(root, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      pkg.blue.manifest = './absent.json'
      delete pkg.version
      writeFileSync(pkgPath, JSON.stringify(pkg))
    })
    const plainRoot = profilePackageRoot(world, '@scope/no-blue')
    mkdirSync(plainRoot, { recursive: true })
    writeFileSync(join(plainRoot, 'package.json'), JSON.stringify({ name: '@scope/no-blue', version: '1.0.0' }))
    const emptyPointerRoot = profilePackageRoot(world, '@scope/empty-pointer')
    mkdirSync(emptyPointerRoot, { recursive: true })
    writeFileSync(join(emptyPointerRoot, 'package.json'), JSON.stringify({ name: '@scope/empty-pointer', version: '1.0.0', blue: { manifest: '' } }))
    const brokenRoot = profilePackageRoot(world, '@scope/broken-package')
    mkdirSync(brokenRoot, { recursive: true })
    writeFileSync(join(brokenRoot, 'package.json'), '{broken')
    const arrayRoot = profilePackageRoot(world, '@scope/array-package')
    mkdirSync(arrayRoot, { recursive: true })
    writeFileSync(join(arrayRoot, 'package.json'), '[]')

    const rows = pluginCommandInternals.installedPlugins()
    expect(rows.map(row => [row.packageName, row.state])).toEqual([
      ['@scope/compatible', 'compatible'],
      ['@scope/escape', 'invalid'],
      ['@scope/incompatible', 'incompatible'],
      ['@scope/invalid', 'invalid'],
      ['@scope/mismatch', 'invalid'],
      ['@scope/missing-manifest', 'invalid'],
    ])
    expect(rows.find(row => row.packageName === '@scope/incompatible')?.reason).toContain('Blue')
    expect(rows.find(row => row.packageName === '@scope/incompatible')?.reason).toContain('Harness')
    expect(rows.find(row => row.packageName === '@scope/incompatible')?.reason).toContain('Node')
    expect(rows.find(row => row.packageName === '@scope/missing-manifest')?.installed).toBe('unknown')
    await expect(world.execute('list')).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('@scope/compatible@0.1.0 [compatible]') })
    await expect(world.execute('search LINK:COMPATIBLE')).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('@scope/compatible') })
    await expect(world.execute('info @scope/compatible')).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('manifest compatible') })
    await expect(world.execute('info')).resolves.toEqual({ kind: 'error', text: 'usage: /plugin info <installed-package>' })
    await expect(world.execute('info @scope/absent')).resolves.toEqual({ kind: 'error', text: 'installed Blue plugin not found: @scope/absent' })
  })

  it('runs the real validator for direct and installed targets', async () => {
    const world = await mount()
    const local = join(world.home, 'local-plugin')
    expect(createPluginPackage({ directory: local, packageName: '@scope/local' }).ok).toBe(true)
    await expect(world.execute('verify')).resolves.toEqual({ kind: 'error', text: 'usage: /plugin verify <installed-package-or-directory>' })
    await expect(world.execute(`verify ${local}`)).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('verified @scope/local: valid') })

    writeProfileManifest(world.profile, { '@scope/installed': '1.0.0' })
    addPlugin(world, '@scope/installed')
    await expect(world.execute('verify @scope/installed')).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('verified @scope/installed') })
    writeFileSync(join(local, 'blue.plugin.json'), '{}')
    await expect(world.execute(`verify ${local}`)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('verification failed') })
  }, 20_000)

  it('validates local directories, delegates accepted installs, and guards removal', async () => {
    const world = await mount()
    const local = join(world.home, 'local-plugin')
    expect(createPluginPackage({ directory: local, packageName: '@scope/local' }).ok).toBe(true)
    await expect(world.execute('install')).resolves.toEqual({ kind: 'error', text: 'usage: /plugin install <local-path|tarball|exact-npm-version|pinned-github-commit>' })
    await expect(world.execute('install @scope/plugin@latest')).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('exact package@version') })
    await expect(world.execute(`install ${local}`)).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining(`plugin|--profile|acceptance|add|file:${local}`),
    })
    await expect(world.execute('install @scope/plugin@1.2.3')).resolves.toEqual({
      kind: 'success',
      text: 'plugin|--profile|acceptance|add|@scope/plugin@1.2.3\ninstalled; restart Blue to apply, then run /plugin verify <package>',
    })
    const sha = 'c'.repeat(40)
    process.env.BLUE_GITHUB_PROXY = 'https://proxy.test/'
    await expect(world.execute(`install github:owner/repo@${sha}`)).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining(`git+https://proxy.test/https://github.com/owner/repo.git#${sha}`) })
    writeFileSync(join(local, 'blue.plugin.json'), '{}')
    await expect(world.execute(`install ${local}`)).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('verification failed') })

    await expect(world.execute('remove')).resolves.toEqual({ kind: 'error', text: 'usage: /plugin remove <installed-package>' })
    await expect(world.execute('remove @scope/absent')).resolves.toEqual({ kind: 'error', text: 'installed Blue plugin not found: @scope/absent' })
    writeProfileManifest(world.profile, { '@scope/installed': '1.0.0' })
    addPlugin(world, '@scope/installed')
    await expect(world.execute('remove @scope/installed')).resolves.toEqual({
      kind: 'success',
      text: 'plugin|--profile|acceptance|remove|@scope/installed\nuninstalled; restart Blue to apply',
    })
  }, 20_000)

  it('uses global dsh when no test host is configured and maps process failures', async () => {
    const world = await mount()
    const bin = join(world.home, 'dsh')
    writeFileSync(bin, "#!/usr/bin/env node\nconsole.log(process.argv.slice(2).join('|'))\n")
    chmodSync(bin, 0o755)
    delete process.env.BLUE_DSH_BIN
    process.env.PATH = `${world.home}:${process.env.PATH ?? ''}`
    await expect(world.execute('install plain-plugin@1.0.0')).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('plugin|--profile|acceptance|add|plain-plugin@1.0.0') })
    writeFileSync(bin, '#!/usr/bin/env node\nprocess.exit(1)\n')
    chmodSync(bin, 0o755)
    await expect(world.execute('install plain-plugin@1.0.1')).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('plugin operation failed') })
    vi.spyOn(pluginCommandInternals.effects, 'run').mockRejectedValueOnce('plain failure')
    await expect(world.execute('install plain-plugin@1.0.2')).resolves.toEqual({ kind: 'error', text: 'plugin operation failed: plain failure' })
    await expect(world.execute('unknown value')).resolves.toEqual({ kind: 'error', text: 'unknown plugin action: unknown' })
  })

  it('opens a local-only panel and performs verify and uninstall actions', async () => {
    const world = await mount({ display: true })
    writeProfileManifest(world.profile, { '@scope/installed': '1.0.0' })
    addPlugin(world, '@scope/installed')
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    expect(panel.render(100).join('\n')).toContain('marketplace paused')
    expect(panel.render(100).join('\n')).toContain('@scope/installed')
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('verified @scope/installed'))
    panel.handleInput(KEY.altS)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('uninstalled; restart Blue to apply'))

    const failure = vi.spyOn(pluginCommandInternals.effects, 'run').mockRejectedValueOnce(new Error('validator offline'))
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: validator offline'))
    failure.mockRejectedValueOnce('profile owner offline')
    panel.handleInput(KEY.altS)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: profile owner offline'))
    failure.mockRejectedValueOnce('validator offline without Error')
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: validator offline without Error'))
    failure.mockRejectedValueOnce(new Error('profile owner Error'))
    panel.handleInput(KEY.altS)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: profile owner Error'))
    panel.handleInput(KEY.escape)
  }, 20_000)
})
