#!/usr/bin/env node
/** Packed direct-service lifecycle fixture for the Blue ecosystem examples.
 * @module script/blue-examples-fixture
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { ROOT, readManifest } from './package-contract.mjs'
import { harnessLine as supportedHarnessLine } from './smoke-lib.mjs'

const args = process.argv.slice(2)
let harnessLine = supportedHarnessLine
let argumentError
for (let index = 0; index < args.length; index += 1) {
  const value = args[index]
  if (value === '--install') continue
  if (value === '--harness-line') {
    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) argumentError = '--harness-line requires an exact version'
    else { harnessLine = next; index += 1 }
    continue
  }
  if (value?.startsWith('--harness-line=')) { harnessLine = value.slice('--harness-line='.length); continue }
  argumentError = `unknown option: ${String(value)}`
}

const scenarios = [
  'composition.five-direct-rows',
  'user-kit.public-component',
  'header.pane-lifecycle',
  'right-inspector.pane-lifecycle',
  'bottom-log.pane-lifecycle',
  'ui-gallery.pane-lifecycle',
  'overlay.command-and-lifecycle',
  'direct.status-and-editor-lifecycle',
]
const fixtureRoot = await mkdtemp(join(tmpdir(), 'blue-examples-fixture-'))
const reproduce = `node script/blue-examples-fixture.mjs --install --harness-line ${String(harnessLine)}`
const report = {
  package: '@dsh-blue-example/blue-ecosystem',
  fixtureRoot,
  installed: false,
  independentInstall: false,
  harnessLine: harnessLine ?? null,
  harnessPackages: {},
  directServices: ['bluePanes', 'blueStatus', 'blueOverlays', 'blueEditorExtensions'],
  declared: [...scenarios],
  executed: [],
  skipped: [],
  failures: [],
  observations: [],
  cleaned: false,
  fixtureCleaned: false,
  reproduce,
}

class FixtureFailure extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function ensure(condition, code, message) {
  if (!condition) throw new FixtureFailure(code, message)
}

function recordFailure(scenario, error, fallbackCode = 'EXAMPLES_SCENARIO_FAILED') {
  report.failures.push({
    package: report.package,
    scenario,
    code: error instanceof FixtureFailure ? error.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    reproduce,
  })
}

async function scenario(name, run) {
  try {
    await run()
    report.executed.push(name)
  } catch (error) {
    recordFailure(name, error)
  }
}

const packageDirs = [
  'packages/api',
  'packages/ui',
  'examples/blue-user-kit',
  'examples/header',
  'examples/right-inspector',
  'examples/bottom-log',
  'examples/overlay',
  'examples/ui-gallery',
  'examples/blue-ecosystem',
]
const pluginNames = [
  '@dsh-blue-example/header',
  '@dsh-blue-example/right-inspector',
  '@dsh-blue-example/bottom-log',
  '@dsh-blue-example/overlay',
  '@dsh-blue-example/ui-gallery',
]

function walkHarnessPackages(nodeModules, found, visited = new Set()) {
  if (visited.has(nodeModules) || !existsSync(nodeModules)) return
  visited.add(nodeModules)
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue
    const roots = entry.name.startsWith('@')
      ? readdirSync(join(nodeModules, entry.name), { withFileTypes: true })
          .filter(child => child.isDirectory())
          .map(child => join(nodeModules, entry.name, child.name))
      : [join(nodeModules, entry.name)]
    for (const root of roots) {
      walkHarnessPackages(join(root, 'node_modules'), found, visited)
      const manifestPath = join(root, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/dsh-')) found[manifest.name] = manifest.version
    }
  }
}

try {
  ensure(argumentError === undefined, 'EXAMPLES_ARGUMENT_INVALID', argumentError ?? '')
  ensure(args.includes('--install'), 'EXAMPLES_INSTALL_REQUIRED', 'independent scenarios require --install')
  ensure(typeof harnessLine === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(harnessLine), 'EXAMPLES_HARNESS_LINE_INVALID', `invalid Harness line: ${String(harnessLine)}`)

  const tarballRoot = join(fixtureRoot, 'tarballs')
  mkdirSync(tarballRoot, { recursive: true })
  const tarballs = new Map()
  for (const directory of packageDirs) {
    const manifest = readManifest(directory)
    const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', tarballRoot], {
      cwd: join(ROOT, directory), encoding: 'utf8',
    })
    const packed = JSON.parse(output.slice(output.indexOf('{')))
    tarballs.set(manifest.name, resolve(packed.filename))
  }

  const dependencies = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]))
  dependencies['@deepseek-ai/cordis'] = '4.0.2'
  dependencies['@deepseek-ai/dsh-commands'] = harnessLine
  writeFileSync(join(fixtureRoot, 'package.json'), `${JSON.stringify({
    private: true,
    type: 'module',
    dependencies,
    overrides: { '@deepseek-ai/dsh-commands': harnessLine },
  }, null, 2)}\n`)
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], { cwd: fixtureRoot, stdio: 'ignore' })
  report.installed = true
  report.independentInstall = existsSync(join(fixtureRoot, 'node_modules'))

  for (const name of tarballs.keys()) {
    const root = join(fixtureRoot, 'node_modules', ...name.split('/'))
    ensure(existsSync(root), 'EXAMPLES_PACKAGE_MISSING', `${name} was not installed`)
    ensure(!lstatSync(root).isSymbolicLink(), 'EXAMPLES_WORKSPACE_LINK', `${name} installed as a symlink`)
    ensure(!existsSync(join(root, 'src')), 'EXAMPLES_SOURCE_LEAK', `${name} tarball shipped src/`)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const table of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dependency, spec] of Object.entries(manifest[table] ?? {})) {
        ensure(typeof spec !== 'string' || !/^(?:workspace|link):/u.test(spec), 'EXAMPLES_PACK_PROTOCOL_LEAK', `${name} packed ${table}.${dependency} leaked ${String(spec)}`)
      }
    }
  }
  walkHarnessPackages(join(fixtureRoot, 'node_modules'), report.harnessPackages)
  ensure(report.harnessPackages['@deepseek-ai/dsh-commands'] === harnessLine, 'EXAMPLES_HARNESS_LINE_MISMATCH', `dsh commands resolved to ${String(report.harnessPackages['@deepseek-ai/dsh-commands'])}`)

  const fixtureRequire = createRequire(join(fixtureRoot, 'fixture.mjs'))
  const load = name => import(pathToFileURL(fixtureRequire.resolve(name)).href)
  const [cordis, api, kit, header, inspector, bottomLog, overlay, gallery] = await Promise.all([
    load('@deepseek-ai/cordis'),
    load('@dsh-blue/blue-api'),
    load('@dsh-blue-example/user-kit'),
    load('@dsh-blue-example/header'),
    load('@dsh-blue-example/right-inspector'),
    load('@dsh-blue-example/bottom-log'),
    load('@dsh-blue-example/overlay'),
    load('@dsh-blue-example/ui-gallery'),
  ])

  await scenario('composition.five-direct-rows', async () => {
    const root = join(fixtureRoot, 'node_modules', '@dsh-blue-example', 'blue-ecosystem')
    const patch = parseYaml(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
    const rows = patch.flatMap(entry => entry.insert ?? [])
    ensure(rows.length === 5, 'EXAMPLES_COMPOSITION_ROWS', `composition has ${String(rows.length)} rows`)
    ensure(rows.map(row => row.name).join('\n') === pluginNames.join('\n'), 'EXAMPLES_COMPOSITION_ORDER', 'composition rows differ from direct plugin packages')
    const expectedInject = new Map([
      ['@dsh-blue-example/header', ['bluePanes']],
      ['@dsh-blue-example/right-inspector', ['bluePanes']],
      ['@dsh-blue-example/bottom-log', ['bluePanes']],
      ['@dsh-blue-example/overlay', ['commands', 'blueOverlays']],
      ['@dsh-blue-example/ui-gallery', ['bluePanes']],
    ])
    for (const row of rows) {
      const module = await load(row.name)
      ensure(
        row.id === row.name && module.inject.join('\n') === expectedInject.get(row.name)?.join('\n'),
        'EXAMPLES_DIRECT_INJECT',
        `${row.name} does not declare its direct services`,
      )
    }
  })

  await scenario('user-kit.public-component', () => {
    const node = kit.summaryMetric.render({ label: 'Context', value: '42%', detail: '12k / 28k' })
    ensure(node.kind === 'surface' && Object.isFrozen(node), 'EXAMPLES_KIT_NODE', 'user kit did not return a frozen canonical node')
  })

  for (const [name, module, expectedId, placement] of [
    ['header.pane-lifecycle', header, 'example.header.summary', 'header'],
    ['right-inspector.pane-lifecycle', inspector, 'example.inspector.context', 'right'],
    ['bottom-log.pane-lifecycle', bottomLog, 'example.log.recent', 'bottom'],
    ['ui-gallery.pane-lifecycle', gallery, 'example.ui-gallery.showcase', 'right'],
  ]) {
    await scenario(name, async () => {
      const ctx = new cordis.Context()
      const apiFiber = await ctx.plugin(api)
      const pluginFiber = await ctx.plugin(module)
      const entry = ctx.bluePanes.list()[0]
      ensure(entry?.id === expectedId && entry.contribution.placement === placement, 'EXAMPLES_PANE_DIRECT', `${name} did not register directly`)
      ensure(typeof entry.contribution.render()?.kind === 'string', 'EXAMPLES_PANE_NODE', `${name} returned no canonical node`)
      await pluginFiber.dispose()
      ensure(ctx.bluePanes.list().length === 0, 'EXAMPLES_PANE_UNLOAD', `${name} survived Fiber unload`)
      await apiFiber.dispose()
    })
  }

  await scenario('overlay.command-and-lifecycle', async () => {
    const ctx = new cordis.Context()
    const apiFiber = await ctx.plugin(api)
    let command
    ctx.provide('commands', {
      register(definition) { command = definition; return () => { command = undefined } },
    })
    const pluginFiber = await ctx.plugin(overlay)
    ensure(command?.name === 'example-overlay', 'EXAMPLES_DSH_COMMAND', 'overlay did not register through dsh commands')
    const result = await command.handler({ rawInput: '' })
    ensure(result.kind === 'success' && ctx.blueOverlays.list()[0]?.id === overlay.overlayRequest.id, 'EXAMPLES_OVERLAY_DIRECT', 'command did not open the direct overlay')
    await pluginFiber.dispose()
    ensure(ctx.blueOverlays.list().length === 0, 'EXAMPLES_OVERLAY_UNLOAD', 'overlay survived Fiber unload')
    await apiFiber.dispose()
  })

  await scenario('direct.status-and-editor-lifecycle', async () => {
    const ctx = new cordis.Context()
    const apiFiber = await ctx.plugin(api)
    const consumer = await ctx.plugin({
      name: 'direct-contributions',
      inject: ['blueStatus', 'blueEditorExtensions'],
      apply(pluginCtx) {
        pluginCtx.blueStatus.register({ id: 'example.status', visible: true, node: { kind: 'text', content: 'ready' } })
        pluginCtx.blueEditorExtensions.register({ id: 'example.editor', hint: 'direct extension' })
      },
    })
    ensure(ctx.blueStatus.list()[0]?.id === 'example.status' && ctx.blueEditorExtensions.list()[0]?.id === 'example.editor', 'EXAMPLES_DIRECT_SERVICES', 'direct status/editor registrations are missing')
    await consumer.dispose()
    ensure(ctx.blueStatus.list().length === 0 && ctx.blueEditorExtensions.list().length === 0, 'EXAMPLES_DIRECT_UNLOAD', 'direct registrations survived Fiber unload')
    await apiFiber.dispose()
  })
} catch (error) {
  recordFailure('fixture.setup', error, 'EXAMPLES_FIXTURE_SETUP_FAILED')
} finally {
  for (const name of scenarios) if (!report.executed.includes(name) && !report.failures.some(failure => failure.scenario === name)) {
    report.skipped.push({ scenario: name, reason: 'scenario did not execute' })
  }
  try {
    await rm(fixtureRoot, { recursive: true, force: true })
    report.cleaned = true
    report.fixtureCleaned = true
  } catch (error) {
    recordFailure('fixture.cleanup', error, 'EXAMPLES_FIXTURE_CLEANUP_FAILED')
  }
  const valid = report.failures.length === 0 && report.skipped.length === 0
    && report.executed.length === scenarios.length && report.cleaned
  console.log(JSON.stringify({ ...report, valid }, null, 2))
  process.exitCode = valid ? 0 : 1
}
