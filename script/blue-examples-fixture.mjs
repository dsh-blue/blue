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
  'packages/core',
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

try {
  ensure(argumentError === undefined, 'EXAMPLES_ARGUMENT_INVALID', argumentError ?? '')
  ensure(install, 'EXAMPLES_INSTALL_REQUIRED', 'independent scenarios require --install')
  ensure(typeof requestedHarnessLine === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(requestedHarnessLine), 'EXAMPLES_HARNESS_LINE_INVALID', `invalid Harness line: ${String(requestedHarnessLine)}`)

  const tarballRoot = join(fixtureRoot, 'tarballs')
  mkdirSync(tarballRoot, { recursive: true })
  const tarballs = new Map()
  for (const relativeDir of packageDirs) {
    const manifest = readManifest(relativeDir)
    const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', tarballRoot], {
      cwd: join(ROOT, relativeDir), encoding: 'utf8',
    })
    const packed = JSON.parse(output.slice(output.indexOf('{')))
    tarballs.set(manifest.name, resolve(packed.filename))
  }

  const dependencies = Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]))
  dependencies['@deepseek-ai/cordis'] = '4.0.1'
  dependencies['@deepseek-ai/dsh-invariants'] = requestedHarnessLine
  writeFileSync(join(fixtureRoot, 'package.json'), `${JSON.stringify({ private: true, type: 'module', dependencies }, null, 2)}\n`)
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

  const harnessScope = join(fixtureRoot, 'node_modules', '@deepseek-ai')
  for (const entry of readdirSync(harnessScope)) {
    if (!entry.startsWith('dsh-')) continue
    const manifest = JSON.parse(readFileSync(join(harnessScope, entry, 'package.json'), 'utf8'))
    report.harnessPackages[`@deepseek-ai/${entry}`] = manifest.version
    ensure(manifest.version === requestedHarnessLine, 'EXAMPLES_HARNESS_LINE_MISMATCH', `@deepseek-ai/${entry} resolved to ${String(manifest.version)}, expected ${requestedHarnessLine}`)
  }
  ensure(Object.keys(report.harnessPackages).length > 0, 'EXAMPLES_HARNESS_PACKAGE_MISSING', 'no Harness package was installed')

  const fixtureRequire = createRequire(join(fixtureRoot, 'fixture.mjs'))
  async function load(name) {
    return import(pathToFileURL(fixtureRequire.resolve(name)).href)
  }
  const [cordis, api, core, dark, kit, header, inspector, bottomLog, overlay, status, editor] = await Promise.all([
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
  const composition = parseYaml(readFileSync(join(compositionRoot, 'cordis.patch.yml'), 'utf8'))
  const rows = composition.flatMap(entry => entry.insert ?? [])
  ensure(rows.length === 6, 'EXAMPLES_COMPOSITION_ROWS', `composition has ${String(rows.length)} rows, expected 6`)
  ensure(rows.map(row => row.name).join('\n') === pluginNames.join('\n'), 'EXAMPLES_COMPOSITION_ORDER', 'composition rows do not match the six plugin packages')
  for (const row of rows) {
    ensure(row.id === row.name, 'EXAMPLES_COMPOSITION_ID', `loader id/name mismatch for ${String(row.name)}`)
    const module = await load(row.name)
    ensure(module.name === row.name && typeof module.apply === 'function', 'EXAMPLES_COMPOSITION_ENTRY', `${String(row.name)} does not resolve to its declared plugin entry`)
  }
  for (const name of pluginNames) {
    const root = join(fixtureRoot, 'node_modules', ...name.split('/'))
    const pluginPatch = parseYaml(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
    const pluginRows = pluginPatch.flatMap(entry => entry.insert ?? [])
    ensure(pluginRows.length === 1 && pluginRows[0]?.id === name && pluginRows[0]?.name === name, 'EXAMPLES_PLUGIN_PATCH', `${name} does not ship its matching one-row patch`)
    const manifest = JSON.parse(readFileSync(join(root, 'blue.plugin.json'), 'utf8'))
    ensure(manifest.id === name && manifest.entry === './lib/index.js', 'EXAMPLES_PLUGIN_MANIFEST', `${name} packed manifest is inconsistent`)
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
    constructor(host) { this.bluePluginHost = host; this.cleanups = [] }
    effect(callback) { this.cleanups.push(callback()) }
    dispose() { for (const cleanup of this.cleanups.splice(0).reverse()) cleanup() }
  }
  function world(capabilities) {
    const host = new api.BluePluginHostService(new cordis.Context())
    const owner = new Scope(host)
    const consumer = new Scope(host)
    api.attachBluePluginHostCapabilities(host, owner, capabilities)
    return { host, owner, consumer }
  }
  function snapshot(host) { return api.snapshotBluePluginHost(host) }

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
      ensure(snapshot(denied.host).panes.length === 0, 'EXAMPLES_CAPABILITY_REJECTION', `${scenarioName} bypassed host admission`)
      denied.consumer.dispose(); denied.owner.dispose()

      const active = world(['panes'])
      module.apply(active.consumer)
      const entry = snapshot(active.host).panes[0]
      ensure(entry?.id === expectedId && entry.contribution.placement === expectedPlacement, 'EXAMPLES_PANE_ADMISSION', `${scenarioName} did not register its pane`)
      scanUi(expectedId, entry.contribution.render())
      active.consumer.dispose()
      ensure(snapshot(active.host).panes.length === 0, 'EXAMPLES_PANE_UNLOAD', `${scenarioName} survived consumer unload`)
      active.owner.dispose()
    })
  }

  await scenario('overlay.gesture-and-late-containment', async () => {
    const active = world(['commands', 'overlays'])
    overlay.apply(active.consumer)
    const command = snapshot(active.host).commands[0]
    ensure(command !== undefined, 'EXAMPLES_OVERLAY_COMMAND', 'overlay command was not registered')
    const denied = await command.execute([], {})
    ensure(!denied.ok && denied.code === 'BLUE_ACTION_REJECTED' && snapshot(active.host).overlays.length === 0, 'EXAMPLES_OVERLAY_GESTURE', 'overlay opened without a gesture')
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
    const active = world(['status.provider'])
    status.apply(active.consumer)
    const candidate = snapshot(active.host).statusProviders[0]
    ensure(candidate?.id === 'example.status.compact', 'EXAMPLES_STATUS_CANDIDATE', 'status candidate was not registered')
    const node = candidate.render({ session: { id: 's', cwd: '/tmp', status: 'running', mode: 'plan', model: { id: 'deepseek-chat' } }, entries: [], busy: true })
    scanStatus('status-provider', node)
    active.consumer.dispose()
    ensure(snapshot(active.host).statusProviders.length === 0, 'EXAMPLES_STATUS_UNLOAD', 'status candidate survived unload')
    active.owner.dispose()
  })

  await scenario('editor-provider.one-control-candidate', async () => {
    const active = world(['editor.provider'])
    editor.apply(active.consumer)
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
