/**
 * `/plugin` installed/catalog tabs, compatibility, verification, bounded
 * refresh, and profile-owner mutation tests.
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
import { bundledPluginCatalog, type PluginCatalogResult } from '../src/plugin-catalog.ts'
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

function compatibleCatalog(commit = 'd'.repeat(40)): PluginCatalogResult {
  return {
    source: 'live',
    entries: [{
      packageName: '@acme/catalog-ready',
      version: '1.2.3',
      description: 'A canonical plugin ready to install.',
      repository: 'acme/catalog-ready',
      repositoryUrl: 'https://github.com/acme/catalog-ready',
      branch: 'main',
      commit,
      capabilities: ['status'],
      state: 'compatible',
      reason: 'canonical manifest compatible',
      installSpec: `github:acme/catalog-ready@${commit}`,
    }],
  }
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
    await expect(world.execute('')).resolves.toEqual({ kind: 'success', text: 'no Blue plugins installed' })
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
      manifest.api = '>=9.0.0'
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
    expect(rows.find(row => row.packageName === '@scope/incompatible')?.reason).toContain('API')
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

  it('opens Installed first and performs visible Verify and Remove actions', async () => {
    vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockResolvedValue(bundledPluginCatalog())
    const world = await mount({ display: true })
    writeProfileManifest(world.profile, { '@scope/installed': '1.0.0' })
    addPlugin(world, '@scope/installed')
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    const initial = panel.render(100).join('\n')
    expect(initial).toContain('Installed')
    expect(initial).toContain('Catalog')
    expect(initial).toContain('@scope/installed')
    expect(initial).toContain('[Verify]')
    expect(initial).toContain('[Remove]')
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('verified @scope/installed'))
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('uninstalled; restart Blue to apply'))

    const failure = vi.spyOn(pluginCommandInternals.effects, 'run').mockRejectedValueOnce(new Error('validator offline'))
    panel.handleInput(KEY.left)
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: validator offline'))
    failure.mockRejectedValueOnce('profile owner offline')
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: profile owner offline'))
    failure.mockRejectedValueOnce('validator offline without Error')
    panel.handleInput(KEY.left)
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: validator offline without Error'))
    failure.mockRejectedValueOnce(new Error('profile owner Error'))
    panel.handleInput(KEY.altS)
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('plugin operation failed: profile owner Error'))
    panel.handleInput(KEY.escape)
  }, 20_000)

  it('shows the vetted doudizhu catalog entry with migration-gated installation', async () => {
    vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockResolvedValue(bundledPluginCatalog())
    const world = await mount({ display: true })
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    expect(panel.render(80).join('\n')).toContain('No Blue plugins installed')
    panel.handleInput(KEY.tab)
    const catalog = panel.render(120).join('\n')
    expect(catalog).toContain('@dsh-blue/blue-doudizhu')
    expect(catalog).toContain('Needs migration')
    expect(catalog).toContain('[Details]')
    expect(catalog).toContain('[Install]')
    panel.handleInput(KEY.right)
    expect(panel.render(40).join('\n')).toContain('Details selected')
    panel.handleInput(KEY.enter)
    const detail = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    const renderedDetail = detail.render(120).join('\n')
    expect(renderedDetail).toContain('legacy manifest')
    expect(renderedDetail).toContain('d2edd2b6cce3440d8aab87dd23e2a05e00d54f14')
    expect(renderedDetail).not.toContain('Enter install')
    detail.handleInput(KEY.escape)
    panel.handleInput(KEY.escape)
  })

  it('refreshes Catalog and installs only the exact admitted commit', async () => {
    const catalog = compatibleCatalog()
    vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockResolvedValue(catalog)
    const world = await mount({ display: true })
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    await vi.waitFor(() => expect(panel.render(120).join('\n')).toContain('catalog refreshed from GitHub'))
    panel.handleInput(KEY.tab)
    expect(panel.render(120).join('\n')).toContain('@acme/catalog-ready')
    panel.handleInput(KEY.enter)
    const detail = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    expect(detail.render(120).join('\n')).toContain('Enter install')
    detail.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(120).join('\n')).toContain('installed; restart Blue to apply'))
    expect(panel.render(120).join('\n')).toContain(`github:acme/catalog-ready@${'d'.repeat(40)}`)
    panel.handleInput(KEY.escape)
  })

  it('contains catalog installation failures without changing the live tree', async () => {
    vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockResolvedValue(compatibleCatalog())
    const installFailure = vi.spyOn(pluginCommandInternals.effects, 'run')
    installFailure.mockRejectedValueOnce(new Error('install failed')).mockRejectedValueOnce('plain install failure')
    const world = await mount({ display: true })
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    await vi.waitFor(() => expect(panel.render(120).join('\n')).toContain('catalog refreshed from GitHub'))
    panel.handleInput(KEY.tab)
    panel.handleInput(KEY.right)
    expect(panel.render(40).join('\n')).toContain('Install selected')
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(120).join('\n')).toContain('plugin operation failed: install failed'))
    expect(panel.render(120).join('\n')).toContain('‹ Catalog ›')
    panel.handleInput(KEY.enter)
    await vi.waitFor(() => expect(panel.render(120).join('\n')).toContain('plugin operation failed: plain install failure'))
    panel.handleInput(KEY.escape)
  })

  it('renders installed and catalog compatibility states, including already installed entries', async () => {
    const ready = compatibleCatalog().entries[0]!
    vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockResolvedValue({
      source: 'live',
      entries: [
        ready,
        { ...ready, packageName: '@acme/incompatible', repository: 'acme/incompatible', state: 'incompatible', reason: 'does not accept Blue', installSpec: undefined },
        { ...ready, packageName: '@acme/invalid', repository: 'acme/invalid', capabilities: [], state: 'invalid', reason: 'invalid manifest', installSpec: undefined },
      ],
    })
    const world = await mount({ display: true })
    writeProfileManifest(world.profile, {
      '@acme/catalog-ready': '1.2.3',
      '@scope/incompatible': '2.0.0',
      '@scope/invalid': '3.0.0',
    })
    addPlugin(world, '@acme/catalog-ready')
    addPlugin(world, '@scope/incompatible', root => {
      const path = join(root, 'blue.plugin.json')
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      manifest.compatibility.blue = '>=9'
      writeFileSync(path, JSON.stringify(manifest))
    })
    addPlugin(world, '@scope/invalid', root => writeFileSync(join(root, 'blue.plugin.json'), '{}'))
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    const installed = panel.render(120).join('\n')
    expect(installed).toContain('Compatible')
    expect(installed).toContain('Incompatible')
    expect(installed).toContain('Invalid')
    await vi.waitFor(() => expect(panel.render(120).join('\n')).toContain('catalog refreshed from GitHub'))
    panel.handleInput(KEY.tab)
    const catalog = panel.render(120).join('\n')
    expect(catalog).toContain('Installed')
    expect(catalog).toContain('Incompatible')
    expect(catalog).toContain('Invalid')
    panel.handleInput(KEY.enter)
    const detail = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    expect(detail.render(120).join('\n')).toContain('Already installed in this profile')
    expect(detail.render(120).join('\n')).not.toContain('Enter install')
    detail.handleInput(KEY.escape)
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    const invalidDetail = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    expect(invalidDetail.render(120).join('\n')).toContain('Capabilities none declared')
    invalidDetail.handleInput(KEY.escape)
    panel.handleInput(KEY.escape)
  })

  it('reports a resolved offline fallback without discarding its vetted rows', async () => {
    vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockResolvedValue({
      ...bundledPluginCatalog(),
      message: 'rate limited',
    })
    const world = await mount({ display: true })
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    await vi.waitFor(() => expect(panel.render(100).join('\n')).toContain('offline · using vetted snapshot'))
    panel.handleInput(KEY.escape)
  })

  it('keeps the bundled catalog on refresh failure and rejects late refresh after unload', async () => {
    const refresh = vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog')
      .mockRejectedValueOnce(new Error('GitHub offline'))
      .mockRejectedValueOnce('plain offline')
    const offline = await mount({ display: true })
    await expect(offline.execute('')).resolves.toEqual({ kind: 'success' })
    const offlinePanel = offline.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    await vi.waitFor(() => expect(offlinePanel.render(100).join('\n')).toContain('catalog refresh failed: GitHub offline'))
    offlinePanel.handleInput(KEY.tab)
    expect(offlinePanel.render(100).join('\n')).toContain('@dsh-blue/blue-doudizhu')
    offlinePanel.handleInput(KEY.escape)

    const plainOffline = await mount({ display: true })
    await expect(plainOffline.execute('')).resolves.toEqual({ kind: 'success' })
    const plainPanel = plainOffline.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    await vi.waitFor(() => expect(plainPanel.render(100).join('\n')).toContain('catalog refresh failed: plain offline'))
    plainPanel.handleInput(KEY.escape)

    let resolveRefresh: ((value: PluginCatalogResult) => void) | undefined
    let refreshSignal: AbortSignal | undefined
    refresh.mockImplementation(signal => {
      refreshSignal = signal
      return new Promise(resolve => { resolveRefresh = resolve })
    })
    const late = await mount({ display: true })
    await expect(late.execute('')).resolves.toEqual({ kind: 'success' })
    const requestsBeforeDispose = late.screen!.renderRequests
    late.dispose()
    expect(refreshSignal?.aborted).toBe(true)
    const requestsAfterDispose = late.screen!.renderRequests
    expect(requestsAfterDispose).toBeGreaterThanOrEqual(requestsBeforeDispose)
    resolveRefresh?.(compatibleCatalog('e'.repeat(40)))
    await Promise.resolve()
    await Promise.resolve()
    expect(late.screen!.renderRequests).toBe(requestsAfterDispose)
    expect(late.ctx.commands.find(late.agent, 'plugin')).toBeUndefined()
  })

  it('rejects verification and refresh failures that settle after panel disposal', async () => {
    let rejectRefresh: ((reason: Error) => void) | undefined
    const refresh = vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockImplementation(() => new Promise((_resolve, reject) => { rejectRefresh = reject }))
    let resolveValidation: ((value: { stdout: string, stderr: string }) => void) | undefined
    const run = vi.spyOn(pluginCommandInternals.effects, 'run').mockImplementation(() => new Promise(resolve => { resolveValidation = resolve }))
    const world = await mount({ display: true })
    writeProfileManifest(world.profile, { '@scope/installed': '1.0.0' })
    addPlugin(world, '@scope/installed')
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    panel.handleInput(KEY.enter)
    expect(panel.render(80).join('\n')).toContain('Verifying')
    world.dispose()
    const requests = world.screen!.renderRequests
    resolveValidation?.({ stdout: JSON.stringify({ package: '@scope/installed', valid: true, files: 3 }), stderr: '' })
    rejectRefresh?.(new Error('late offline'))
    await Promise.resolve()
    await Promise.resolve()
    expect(world.screen!.renderRequests).toBe(requests)

    refresh.mockResolvedValue(bundledPluginCatalog())
    let rejectValidation: ((reason: Error) => void) | undefined
    run.mockImplementation(() => new Promise((_resolve, reject) => { rejectValidation = reject }))
    const rejected = await mount({ display: true })
    writeProfileManifest(rejected.profile, { '@scope/installed': '1.0.0' })
    addPlugin(rejected, '@scope/installed')
    await expect(rejected.execute('')).resolves.toEqual({ kind: 'success' })
    const rejectedPanel = rejected.screen!.overlays.at(-1)?.component as { handleInput(data: string): void }
    rejectedPanel.handleInput(KEY.enter)
    rejected.dispose()
    const rejectedRequests = rejected.screen!.renderRequests
    rejectValidation?.(new Error('late validator failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(rejected.screen!.renderRequests).toBe(rejectedRequests)
  })

  it('keeps retained panel callbacks inert and makes disposal idempotent', async () => {
    vi.spyOn(pluginCommandInternals.effects, 'refreshCatalog').mockResolvedValue(compatibleCatalog())
    const run = vi.spyOn(pluginCommandInternals.effects, 'run')
    const world = await mount({ display: true })
    writeProfileManifest(world.profile, { '@scope/installed': '1.0.0' })
    addPlugin(world, '@scope/installed')
    await expect(world.execute('')).resolves.toEqual({ kind: 'success' })
    const panel = world.screen!.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    await vi.waitFor(() => expect(panel.render(120).join('\n')).toContain('catalog refreshed from GitHub'))
    world.dispose()
    world.dispose()
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.tab)
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.right)
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.escape)
    expect(run).not.toHaveBeenCalled()
  })
})
