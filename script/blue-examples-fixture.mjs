#!/usr/bin/env node
/**
 * Pack and install the complete Blue ecosystem example suite, then exercise
 * seven public-export scenarios in one independent npm project.
 *
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
import { harnessLine as currentHarnessLine } from './smoke-lib.mjs'

const args = process.argv.slice(2)
let requestedHarnessLine = currentHarnessLine
let argumentError
for (let index = 0; index < args.length; index += 1) {
  const value = args[index]
  if (value === '--install') continue
  if (value === '--harness-line') {
    const next = args[index + 1]
    if (next === undefined || next.startsWith('--')) argumentError = '--harness-line requires an exact version'
    else { requestedHarnessLine = next; index += 1 }
    continue
  }
  if (value?.startsWith('--harness-line=')) { requestedHarnessLine = value.slice('--harness-line='.length); continue }
  argumentError = `unknown option: ${String(value)}`
}

const install = args.includes('--install')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'blue-examples-fixture-'))
const reproduce = `node script/blue-examples-fixture.mjs --install --harness-line ${String(requestedHarnessLine)}`
const report = {
  package: '@dsh-blue-example/blue-ecosystem',
  fixtureRoot,
  installed: false,
  independentInstall: false,
  harnessLine: requestedHarnessLine ?? null,
  harnessPackages: {},
  hostPeer: null,
  pluginCapabilities: {},
  declared: [],
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
  report.declared.push(name)
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
  'packages/frontend',
  'packages/harness-adapter',
  'packages/conversation',
  'packages/core',
  'packages/app',
  'packages/transcript',
  'packages/interaction',
  'packages/bundle/blue',
  'examples/blue-user-kit',
  'examples/header',
  'examples/right-inspector',
  'examples/bottom-log',
  'examples/overlay',
  'examples/status-provider',
  'examples/editor-provider',
  'examples/blue-ecosystem',
]
const pluginNames = [
  '@dsh-blue-example/header',
  '@dsh-blue-example/right-inspector',
  '@dsh-blue-example/bottom-log',
  '@dsh-blue-example/overlay',
  '@dsh-blue-example/status-provider',
  '@dsh-blue-example/editor-provider',
]
const expectedCapabilities = Object.freeze({
  '@dsh-blue-example/header': ['panes'],
  '@dsh-blue-example/right-inspector': ['panes'],
  '@dsh-blue-example/bottom-log': ['panes'],
  '@dsh-blue-example/overlay': ['commands', 'overlays'],
  '@dsh-blue-example/status-provider': ['status.provider'],
  '@dsh-blue-example/editor-provider': ['editor.provider'],
})

try {
  ensure(argumentError === undefined, 'EXAMPLES_ARGUMENT_INVALID', argumentError ?? '')
  ensure(install, 'EXAMPLES_INSTALL_REQUIRED', 'independent scenarios require --install')
  ensure(typeof requestedHarnessLine === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(requestedHarnessLine), 'EXAMPLES_HARNESS_LINE_INVALID', `invalid Harness line: ${String(requestedHarnessLine)}`)

  const tarballRoot = join(fixtureRoot, 'tarballs')
  mkdirSync(tarballRoot, { recursive: true })
  const tarballs = new Map()
  const sourceManifests = new Map()
  for (const relativeDir of packageDirs) {
    const manifest = readManifest(relativeDir)
    const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', tarballRoot], {
      cwd: join(ROOT, relativeDir), encoding: 'utf8',
    })
    const packed = JSON.parse(output.slice(output.indexOf('{')))
    tarballs.set(manifest.name, resolve(packed.filename))
    sourceManifests.set(manifest.name, manifest)
  }

  const dependencies = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]))
  const harnessPackageNames = new Set()
  for (const manifest of sourceManifests.values()) {
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (!tarballs.has(name)) dependencies[name] ??= range
      if (name.startsWith('@deepseek-ai/dsh-')) harnessPackageNames.add(name)
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (name.startsWith('@deepseek-ai/dsh-')) harnessPackageNames.add(name)
    }
  }
  const harnessQueue = [...harnessPackageNames]
  while (harnessQueue.length > 0) {
    const name = harnessQueue.shift()
    const output = execFileSync('npm', ['view', `${name}@${requestedHarnessLine}`, '--json'], { encoding: 'utf8' }).trim()
    const metadata = output === '' ? {} : JSON.parse(output)
    for (const dependencyName of Object.keys({ ...metadata.dependencies, ...metadata.peerDependencies, ...metadata.optionalDependencies })) {
      if (!dependencyName.startsWith('@deepseek-ai/dsh-') || harnessPackageNames.has(dependencyName)) continue
      harnessPackageNames.add(dependencyName)
      harnessQueue.push(dependencyName)
    }
  }
  for (const name of harnessPackageNames) dependencies[name] = requestedHarnessLine
  const overrides = Object.fromEntries([...harnessPackageNames].map(name => [name, requestedHarnessLine]))
  writeFileSync(join(fixtureRoot, 'package.json'), `${JSON.stringify({ private: true, type: 'module', dependencies, overrides }, null, 2)}\n`)
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], { cwd: fixtureRoot, stdio: 'ignore' })
  report.installed = true
  report.independentInstall = existsSync(join(fixtureRoot, 'node_modules'))
  ensure(report.independentInstall, 'EXAMPLES_INSTALL_MISSING', 'npm install produced no node_modules')

  const localNames = [...tarballs.keys()]
  for (const name of localNames) {
    const root = join(fixtureRoot, 'node_modules', ...name.split('/'))
    ensure(existsSync(root), 'EXAMPLES_PACKAGE_MISSING', `${name} was not installed`)
    ensure(!lstatSync(root).isSymbolicLink(), 'EXAMPLES_WORKSPACE_LINK', `${name} installed as a symlink`)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const table of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [dependency, spec] of Object.entries(manifest[table] ?? {})) {
        ensure(typeof spec !== 'string' || !/^(?:workspace|link|file):/u.test(spec), 'EXAMPLES_PACK_PROTOCOL_LEAK', `${name} packed ${table}.${dependency} leaked ${String(spec)}`)
      }
    }
    ensure(!existsSync(join(root, 'src')), 'EXAMPLES_SOURCE_LEAK', `${name} tarball shipped src/`)
  }

  const nodeModulesQueue = [join(fixtureRoot, 'node_modules')]
  const seenNodeModules = new Set()
  const installedHarnessNames = new Set()
  while (nodeModulesQueue.length > 0) {
    const nodeModules = nodeModulesQueue.shift()
    if (seenNodeModules.has(nodeModules) || !existsSync(nodeModules)) continue
    seenNodeModules.add(nodeModules)
    const packageRoots = []
    for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.bin') continue
      const root = join(nodeModules, entry.name)
      if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(root, { withFileTypes: true })) if (scoped.isDirectory()) packageRoots.push(join(root, scoped.name))
      } else packageRoots.push(root)
    }
    for (const root of packageRoots) {
      nodeModulesQueue.push(join(root, 'node_modules'))
      const manifestPath = join(root, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@deepseek-ai/dsh-')) continue
      installedHarnessNames.add(manifest.name)
      report.harnessPackages[manifest.name] = manifest.version
      ensure(manifest.version === requestedHarnessLine, 'EXAMPLES_HARNESS_LINE_MISMATCH', `${manifest.name} resolved to ${String(manifest.version)} at ${root}, expected ${requestedHarnessLine}`)
    }
  }
  for (const name of harnessPackageNames) ensure(installedHarnessNames.has(name), 'EXAMPLES_HARNESS_PACKAGE_MISSING', `${name} was not installed for Harness ${requestedHarnessLine}`)
  ensure(installedHarnessNames.size > 0, 'EXAMPLES_HARNESS_PACKAGE_MISSING', 'no Harness package was installed')

  const fixtureRequire = createRequire(join(fixtureRoot, 'fixture.mjs'))
  async function load(name) {
    return import(pathToFileURL(fixtureRequire.resolve(name)).href)
  }
  const [blueHost, cordis, api, core, dark, kit, header, inspector, bottomLog, overlay, status, editor] = await Promise.all([
    load('@dsh-blue/blue'),
    load('@deepseek-ai/cordis'),
    load('@dsh-blue/blue-api'),
    load('@dsh-blue/blue-core'),
    load('@dsh-blue/blue-core/theme-dark'),
    load('@dsh-blue-example/user-kit'),
    load('@dsh-blue-example/header'),
    load('@dsh-blue-example/right-inspector'),
    load('@dsh-blue-example/bottom-log'),
    load('@dsh-blue-example/overlay'),
    load('@dsh-blue-example/status-provider'),
    load('@dsh-blue-example/editor-provider'),
  ])

  const compositionRoot = join(fixtureRoot, 'node_modules', '@dsh-blue-example', 'blue-ecosystem')
  const compositionManifest = JSON.parse(readFileSync(join(compositionRoot, 'package.json'), 'utf8'))
  const hostRoot = join(fixtureRoot, 'node_modules', '@dsh-blue', 'blue')
  const hostManifest = JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8'))
  const hostPeer = compositionManifest.peerDependencies?.['@dsh-blue/blue']
  const compositionRequire = createRequire(join(compositionRoot, 'peer-probe.cjs'))
  const resolvedHostManifest = compositionRequire.resolve('@dsh-blue/blue/package.json')
  ensure(typeof hostPeer === 'string' && !/^(?:workspace|link|file):/u.test(hostPeer), 'EXAMPLES_HOST_PEER_INVALID', `composition host peer is ${String(hostPeer)}`)
  ensure(hostPeer === hostManifest.version || hostPeer === `=${String(hostManifest.version)}`, 'EXAMPLES_HOST_PEER_MISMATCH', `composition requires @dsh-blue/blue ${hostPeer}, installed ${String(hostManifest.version)}`)
  ensure(resolve(resolvedHostManifest) === resolve(join(hostRoot, 'package.json')) && !lstatSync(hostRoot).isSymbolicLink() && typeof blueHost.name === 'string' && typeof blueHost.apply === 'function', 'EXAMPLES_HOST_PEER_UNRESOLVED', 'composition host peer did not resolve through the packed public entry')
  report.hostPeer = { name: '@dsh-blue/blue', declared: hostPeer, installed: hostManifest.version, packed: true }
  const composition = parseYaml(readFileSync(join(compositionRoot, 'cordis.patch.yml'), 'utf8'))
  const rows = composition.flatMap(entry => entry.insert ?? [])
  ensure(rows.length === 6, 'EXAMPLES_COMPOSITION_ROWS', `composition has ${String(rows.length)} rows, expected 6`)
  ensure(rows.map(row => row.name).join('\n') === pluginNames.join('\n'), 'EXAMPLES_COMPOSITION_ORDER', 'composition rows do not match the six plugin packages')
  for (const row of rows) {
    ensure(row.id === row.name, 'EXAMPLES_COMPOSITION_ID', `loader id/name mismatch for ${String(row.name)}`)
    const module = await load(row.name)
    ensure(module.name === row.name && typeof module.apply === 'function', 'EXAMPLES_COMPOSITION_ENTRY', `${String(row.name)} does not resolve to its declared plugin entry`)
  }
  const packedPluginManifests = new Map()
  for (const name of pluginNames) {
    const root = join(fixtureRoot, 'node_modules', ...name.split('/'))
    const pluginPatch = parseYaml(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
    const pluginRows = pluginPatch.flatMap(entry => entry.insert ?? [])
    ensure(pluginRows.length === 1 && pluginRows[0]?.id === name && pluginRows[0]?.name === name, 'EXAMPLES_PLUGIN_PATCH', `${name} does not ship its matching one-row patch`)
    const manifest = JSON.parse(readFileSync(join(root, 'blue.plugin.json'), 'utf8'))
    ensure(manifest.id === name && manifest.entry === './lib/index.js', 'EXAMPLES_PLUGIN_MANIFEST', `${name} packed manifest is inconsistent`)
    ensure(JSON.stringify(manifest.capabilities) === JSON.stringify(expectedCapabilities[name]), 'EXAMPLES_PLUGIN_CAPABILITIES', `${name} packed capabilities differ from the expected contract`)
    packedPluginManifests.set(name, manifest)
    report.pluginCapabilities[name] = manifest.capabilities
  }
  report.observations.push({ scenario: 'composition.six-rows-resolve', rows: pluginNames })

  const components = new core.BlueComponentsService(new cordis.Context(), { theme: { colors: dark.DARK_COLORS }, tui: {} })
  const widths = [20, 40, 80, 120]
  function expectRowsFit(label, rows, width) {
    for (const [index, row] of rows.entries()) ensure(core.visibleWidth(row) <= width, 'EXAMPLES_WIDTH_OVERFLOW', `${label} row ${String(index)} exceeds width ${String(width)}`)
  }
  function scanUi(label, node) {
    const viewport = { columns: 120, rows: 20 }
    const compiled = core.compileBlueUiNode(node, { components, colors: dark.DARK_COLORS, getViewport: () => viewport, screenMode: 'alternate', emit: () => {} })
    ensure(compiled.ok, 'EXAMPLES_UI_COMPILE', compiled.message ?? `${label} did not compile`)
    for (const width of widths) { viewport.columns = width; expectRowsFit(label, compiled.value.component.render(width), width) }
  }
  function fakeEditor() {
    let value = ''
    const instance = {
      focused: false, disableSubmit: false,
      getText: () => value, getExpandedText: () => value,
      setText: next => { value = next },
      handleInput: data => { value += data },
      renderContent: width => [components.truncateToWidth(value, width)],
      render: width => [components.truncateToWidth(value, width)],
      invalidate: () => {}, addToHistory: () => {}, getHistory: () => [],
      setBorderColor: () => {}, setPromptSymbol: () => {}, setBorderLabel: () => {}, setConnectedAbove: () => {},
      setGhostHint: () => {}, setAutocompleteProvider: () => {}, isShowingAutocomplete: () => false,
      insertText: text => { value += text },
    }
    return instance
  }
  function scanStatus(label, node) {
    const viewport = { columns: 120, rows: 3 }
    const compiled = core.compileBlueStatusNode(node, { components, colors: dark.DARK_COLORS, getViewport: () => viewport, screenMode: 'alternate', maxRows: 3 })
    ensure(compiled.ok, 'EXAMPLES_STATUS_COMPILE', compiled.message ?? `${label} did not compile`)
    for (const width of widths) { viewport.columns = width; expectRowsFit(label, compiled.value.component.renderStatus(width).rows, width) }
  }
  function scanEditor(label, node) {
    const viewport = { columns: 120, rows: 6 }
    const compiled = core.compileBlueEditorShellNode(node, { components, colors: dark.DARK_COLORS, getViewport: () => viewport, screenMode: 'alternate', emit: () => {}, editor: fakeEditor() })
    ensure(compiled.ok, 'EXAMPLES_EDITOR_COMPILE', compiled.message ?? `${label} did not compile`)
    for (const width of widths) { viewport.columns = width; expectRowsFit(label, compiled.value.component.renderChecked(width, { dryRun: true }).rows, width) }
  }

  class Scope {
    constructor(host, openRequests) {
      this.bluePluginHost = openRequests === undefined ? host : Object.freeze({
        version: host.version,
        open: (consumer, manifest) => {
          openRequests.push(manifest)
          return host.open(consumer, manifest)
        },
      })
      this.cleanups = []
    }
    effect(callback) { this.cleanups.push(callback()) }
    dispose() { for (const cleanup of this.cleanups.splice(0).reverse()) cleanup() }
  }
  function world(capabilities) {
    const host = new api.BluePluginHostService(new cordis.Context())
    const owner = new Scope(host)
    const openRequests = []
    const consumer = new Scope(host, openRequests)
    api.attachBluePluginHostCapabilities(host, owner, capabilities)
    return { host, owner, consumer, openRequests }
  }
  function snapshot(host) { return api.snapshotBluePluginHost(host) }
  function expectOpenRequest(active, name) {
    const manifest = packedPluginManifests.get(name)
    const request = active.openRequests[0]
    ensure(active.openRequests.length === 1 && request?.id === manifest?.id && request.api === manifest.api, 'EXAMPLES_RUNTIME_MANIFEST', `${name} runtime open request differs from its packed manifest`)
    ensure(JSON.stringify(request.capabilities) === JSON.stringify(manifest.capabilities), 'EXAMPLES_RUNTIME_CAPABILITIES', `${name} runtime capabilities differ from its packed manifest`)
  }

  await scenario('user-kit.public-component', async () => {
    const node = kit.summaryMetric.render({ label: 'Context', value: '42%', detail: '12k / 28k' })
    ensure(Object.isFrozen(node) && Object.isFrozen(node.child), 'EXAMPLES_KIT_FREEZE', 'user-kit output is not deeply frozen')
    scanUi('user-kit', node)
    const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'node_modules', '@dsh-blue-example', 'user-kit', 'package.json'), 'utf8'))
    ensure(manifest.blue === undefined && manifest.dsh === undefined, 'EXAMPLES_KIT_CAPABILITY', 'user-kit must not be a host plugin or request capability')
  })

  for (const [scenarioName, module, expectedId, expectedPlacement] of [
    ['header.pane-lifecycle', header, 'example.header.summary', 'header'],
    ['right-inspector.pane-lifecycle', inspector, 'example.inspector.context', 'right'],
    ['bottom-log.pane-lifecycle', bottomLog, 'example.log.recent', 'bottom'],
  ]) {
    await scenario(scenarioName, async () => {
      const denied = world([])
      module.apply(denied.consumer)
      expectOpenRequest(denied, module.name)
      ensure(snapshot(denied.host).panes.length === 0, 'EXAMPLES_CAPABILITY_REJECTION', `${scenarioName} bypassed host admission`)
      denied.consumer.dispose(); denied.owner.dispose()

      const active = world(['panes'])
      module.apply(active.consumer)
      expectOpenRequest(active, module.name)
      const entry = snapshot(active.host).panes[0]
      ensure(entry?.id === expectedId && entry.contribution.placement === expectedPlacement, 'EXAMPLES_PANE_ADMISSION', `${scenarioName} did not register its pane`)
      scanUi(expectedId, entry.contribution.render())
      active.consumer.dispose()
      ensure(snapshot(active.host).panes.length === 0, 'EXAMPLES_PANE_UNLOAD', `${scenarioName} survived consumer unload`)
      active.owner.dispose()
    })
  }

  await scenario('overlay.gesture-and-late-containment', async () => {
    const denied = world(['commands'])
    const retainedGesture = api.createBlueUserGesture(denied.host, denied.owner)
    ensure(retainedGesture.ok, 'EXAMPLES_OVERLAY_GESTURE_SETUP', 'could not mint the capability-absent probe gesture')
    overlay.apply(denied.consumer)
    expectOpenRequest(denied, overlay.name)
    ensure(snapshot(denied.host).commands.length === 0 && snapshot(denied.host).overlays.length === 0, 'EXAMPLES_OVERLAY_CAPABILITY_REJECTION', 'overlay registered partial state without its complete capability set')
    const overlayLease = api.attachBluePluginHostCapabilities(denied.host, denied.owner, ['overlays'])
    const probe = new Scope(denied.host)
    const probeOpened = denied.host.open(probe, { id: 'fixture.gesture-probe', api: '^1.0.0', capabilities: ['overlays'] })
    ensure(probeOpened.ok, 'EXAMPLES_OVERLAY_GESTURE_PROBE', probeOpened.message ?? 'gesture probe could not open the overlay capability')
    const preserved = probeOpened.value.overlays.open({ id: 'fixture.gesture-probe', capturing: true, render: () => ({ kind: 'text', content: 'probe' }) }, { userGesture: retainedGesture.value })
    ensure(preserved.ok, 'EXAMPLES_OVERLAY_GESTURE_CONSUMED', preserved.message ?? 'capability rejection consumed the retained gesture')
    preserved.value.close()
    probe.dispose(); overlayLease.dispose(); denied.consumer.dispose(); denied.owner.dispose()

    const active = world(['commands', 'overlays'])
    overlay.apply(active.consumer)
    expectOpenRequest(active, overlay.name)
    const command = snapshot(active.host).commands[0]
    ensure(command !== undefined, 'EXAMPLES_OVERLAY_COMMAND', 'overlay command was not registered')
    const withoutGesture = await command.execute([], {})
    ensure(!withoutGesture.ok && withoutGesture.code === 'BLUE_ACTION_REJECTED' && snapshot(active.host).overlays.length === 0, 'EXAMPLES_OVERLAY_GESTURE', 'overlay opened without a gesture')
    await api.runBlueUserGesture(active.host, active.owner, async userGesture => {
      const opened = await command.execute([], { userGesture })
      ensure(opened.ok, 'EXAMPLES_OVERLAY_OPEN', opened.message ?? 'overlay did not open')
    })
    const entry = snapshot(active.host).overlays[0]
    ensure(entry !== undefined, 'EXAMPLES_OVERLAY_MISSING', 'capturing overlay is missing')
    scanUi('overlay', entry.request.render())
    active.consumer.dispose()
    ensure(snapshot(active.host).commands.length === 0 && snapshot(active.host).overlays.length === 0, 'EXAMPLES_OVERLAY_UNLOAD', 'overlay state survived unload')
    await api.runBlueUserGesture(active.host, active.owner, async userGesture => {
      const late = await command.execute([], { userGesture })
      ensure(!late.ok, 'EXAMPLES_OVERLAY_LATE', 'retained command reopened an overlay after unload')
    })
    active.owner.dispose()
  })

  await scenario('status-provider.inert-candidate', async () => {
    const denied = world([])
    status.apply(denied.consumer)
    expectOpenRequest(denied, status.name)
    ensure(snapshot(denied.host).statusProviders.length === 0, 'EXAMPLES_STATUS_CAPABILITY_REJECTION', 'status provider registered while its capability was absent')
    denied.consumer.dispose(); denied.owner.dispose()

    const active = world(['status.provider'])
    status.apply(active.consumer)
    expectOpenRequest(active, status.name)
    const candidate = snapshot(active.host).statusProviders[0]
    ensure(candidate?.id === 'example.status.compact', 'EXAMPLES_STATUS_CANDIDATE', 'status candidate was not registered')
    const node = candidate.render({ session: { id: 's', cwd: '/tmp', status: 'running', mode: 'plan', model: { id: 'deepseek-chat' } }, entries: [], busy: true })
    scanStatus('status-provider', node)
    active.consumer.dispose()
    ensure(snapshot(active.host).statusProviders.length === 0, 'EXAMPLES_STATUS_UNLOAD', 'status candidate survived unload')
    active.owner.dispose()
  })

  await scenario('editor-provider.one-control-candidate', async () => {
    const denied = world([])
    editor.apply(denied.consumer)
    expectOpenRequest(denied, editor.name)
    ensure(snapshot(denied.host).editorProviders.length === 0, 'EXAMPLES_EDITOR_CAPABILITY_REJECTION', 'editor provider registered while its capability was absent')
    denied.consumer.dispose(); denied.owner.dispose()

    const active = world(['editor.provider'])
    editor.apply(active.consumer)
    expectOpenRequest(active, editor.name)
    const candidate = snapshot(active.host).editorProviders[0]
    ensure(candidate?.id === 'example.editor.focused', 'EXAMPLES_EDITOR_CANDIDATE', 'editor candidate was not registered')
    const node = candidate.render({ mode: 'plan', busy: true, attachments: [{ id: 'a', label: 'image.png' }], extensions: [{ id: 'ext' }] })
    const controls = JSON.stringify(node).match(/editor-control/gu)?.length ?? 0
    ensure(controls === 1, 'EXAMPLES_EDITOR_CONTROL', `editor shell has ${String(controls)} editor controls`)
    scanEditor('editor-provider', node)
    active.consumer.dispose()
    ensure(snapshot(active.host).editorProviders.length === 0, 'EXAMPLES_EDITOR_UNLOAD', 'editor candidate survived unload')
    active.owner.dispose()
  })
} catch (error) {
  recordFailure('fixture.setup', error, 'EXAMPLES_FIXTURE_SETUP_FAILED')
} finally {
  for (const name of report.declared) if (!report.executed.includes(name) && !report.failures.some(failure => failure.scenario === name)) {
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
    && report.declared.length === 7 && report.executed.length === 7
    && report.cleaned && report.fixtureCleaned
  console.log(JSON.stringify({ ...report, valid }, null, 2))
  process.exitCode = valid ? 0 : 1
}
