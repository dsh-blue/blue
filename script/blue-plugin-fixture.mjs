#!/usr/bin/env node
/**
 * Pack a Blue or external frontend package and its local Blue closure, install
 * those tarballs into a throwaway project, and execute renderer-neutral
 * runtime contracts only through the installed packages' public exports.
 *
 * @module script/blue-plugin-fixture
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { createPackageImporter } from './import-from-directory.mjs'
import { packWithoutScripts } from './pack-without-scripts.mjs'
import { collectLocalPackageClosure, summarizeHarnessPackageInstances } from './plugin-fixture-contract.mjs'
import { harnessLine as pinnedHarnessLine } from './smoke-lib.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const argumentsList = process.argv.slice(2)
let packageArgument = '.'
let harnessLine
let argumentError
for (let index = 0; index < argumentsList.length; index += 1) {
  const value = argumentsList[index]
  if (value === '--' || value === '--install') continue
  if (value === '--harness-line') {
    const line = argumentsList[index + 1]
    if (line === undefined || line.startsWith('--')) argumentError = '--harness-line requires an exact version'
    else { harnessLine = line; index += 1 }
    continue
  }
  if (value?.startsWith('--harness-line=')) {
    harnessLine = value.slice('--harness-line='.length)
    continue
  }
  if (value?.startsWith('--')) argumentError = `unknown option: ${value}`
  else packageArgument = value ?? '.'
}
const packageDir = resolve(packageArgument)
const install = argumentsList.includes('--install')
const requestedHarnessLine = harnessLine ?? pinnedHarnessLine
const manifestPath = join(packageDir, 'package.json')
const target = relative(repositoryRoot, packageDir)
const reproduce = `node script/blue-plugin-fixture.mjs ${target === '' ? '.' : target.startsWith(`..${sep}`) ? packageDir : target} --install${harnessLine === undefined ? '' : ` --harness-line ${harnessLine}`}`
const fixtureRoot = await mkdtemp(join(tmpdir(), 'blue-plugin-fixture-'))
let compilerContext
const report = {
  package: packageDir,
  fixtureRoot,
  installed: false,
  independentInstall: false,
  fixtureCleaned: false,
  harnessLine: requestedHarnessLine ?? null,
  peerResolution: 'normal',
  harnessPackages: {},
  harnessPackageInstances: [],
  declared: [],
  executed: [],
  skipped: [],
  failures: [],
  observations: [],
  externalPackage: false,
  reproduce,
}

class FixtureFailure extends Error {
  constructor(code, message) { super(message); this.code = code }
}

function ensure(condition, code, message) {
  if (!condition) throw new FixtureFailure(code, message)
}

function failure(scenario, error, fallbackCode = 'FIXTURE_SCENARIO_FAILED') {
  report.failures.push({
    package: report.package,
    scenario,
    code: error instanceof FixtureFailure ? error.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    reproduce,
  })
}

async function finish() {
  const missing = report.declared.filter(scenario => !report.executed.includes(scenario) && !report.skipped.some(value => value.scenario === scenario))
  for (const scenario of missing) report.skipped.push({ scenario, reason: 'scenario did not execute' })
  try {
    await rm(fixtureRoot, { recursive: true, force: true })
    report.fixtureCleaned = true
  } catch (error) {
    failure('fixture.cleanup', error, 'FIXTURE_CLEANUP_FAILED')
  }
  const valid = report.failures.length === 0 && report.skipped.length === 0 && report.declared.length === report.executed.length
  console.log(JSON.stringify({ ...report, valid }, null, 2))
  process.exitCode = valid ? 0 : 1
}

async function scenario(name, run) {
  report.declared.push(name)
  try {
    await run()
    report.executed.push(name)
  } catch (error) {
    failure(name, error)
  }
}

/** Discover every workspace package, including packages/bundle/* children. */
function discoverWorkspacePackages() {
  const found = new Map()
  const visit = (directory, depth) => {
    if (!existsSync(directory) || depth > 2) return
    const packageFile = join(directory, 'package.json')
    if (existsSync(packageFile)) {
      const value = JSON.parse(readFileSync(packageFile, 'utf8'))
      if (typeof value.name === 'string') found.set(value.name, directory)
      return
    }
    for (const entry of readdirSync(directory)) {
      const child = join(directory, entry)
      if (entry !== 'node_modules' && statSync(child).isDirectory()) visit(child, depth + 1)
    }
  }
  visit(join(repositoryRoot, 'packages'), 0)
  return found
}

try {
  ensure(argumentError === undefined, 'FIXTURE_ARGUMENT_INVALID', argumentError ?? '')
  ensure(requestedHarnessLine !== undefined && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedHarnessLine), 'FIXTURE_HARNESS_LINE_INVALID', `invalid Harness line: ${String(requestedHarnessLine)}`)
  ensure(existsSync(manifestPath), 'FIXTURE_MANIFEST_MISSING', `package.json not found: ${packageDir}`)
  ensure(lstatSync(manifestPath).isFile(), 'FIXTURE_MANIFEST_NOT_FILE', `package.json is not a regular file: ${packageDir}`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new FixtureFailure('FIXTURE_MANIFEST_INVALID_JSON', `package.json is not valid JSON: ${packageDir}`)
  }
  ensure(manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest), 'FIXTURE_MANIFEST_INVALID', `package.json must contain an object: ${packageDir}`)
  ensure(typeof manifest.name === 'string' && manifest.name !== '', 'FIXTURE_PACKAGE_NAME_INVALID', `package.json has no package name: ${packageDir}`)
  report.package = manifest.name
  const workspacePackages = discoverWorkspacePackages()
  const workspaceTarget = workspacePackages.get(manifest.name)
  const externalPackage = workspaceTarget === undefined || resolve(workspaceTarget) !== packageDir
  ensure(workspaceTarget === undefined || !externalPackage, 'FIXTURE_PACKAGE_NAME_COLLISION', `${manifest.name} conflicts with a different Blue workspace package`)
  report.externalPackage = externalPackage
  const localPackageDirectories = new Map(workspacePackages)
  localPackageDirectories.set(manifest.name, packageDir)

  /** Resolve the complete local package closure without querying the registry. */
  function localClosure() {
    const forced = [
      '@dsh-blue/blue-api',
      '@dsh-blue/blue-ui',
      '@dsh-blue/blue-frontend',
      '@dsh-blue/blue-harness-adapter',
      '@dsh-blue/blue-context',
      '@dsh-blue/blue-conversation',
      '@dsh-blue/blue-remote',
      '@dsh-blue/blue-core',
      '@dsh-blue/blue-transcript',
    ].filter(name => workspacePackages.has(name))
    return collectLocalPackageClosure(
      [manifest.name, ...forced],
      name => localPackageDirectories.has(name),
      name => {
        const directory = localPackageDirectories.get(name)
        ensure(directory !== undefined, 'FIXTURE_LOCAL_PACKAGE_MISSING', `local package directory disappeared: ${name}`)
        return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      },
    )
  }

  const tarballRoot = join(fixtureRoot, 'tarballs')
  mkdirSync(tarballRoot, { recursive: true })
  function pack(directory, untrusted) {
    try {
      return packWithoutScripts(directory, tarballRoot, untrusted ? 'npm' : 'pnpm')
    } catch (error) {
      throw new FixtureFailure(
        'FIXTURE_PACK_FAILED',
        error instanceof Error ? error.message : `failed to pack ${directory}`,
      )
    }
  }

  const packages = new Map()
  const localPackageNames = localClosure()
  for (const name of localPackageNames) {
    const directory = localPackageDirectories.get(name)
    packages.set(name, pack(directory, externalPackage && directory === packageDir))
  }
  const dependencies = Object.fromEntries([...packages].map(([name, tarball]) => [name, `file:${tarball}`]))
  const harnessPackageNames = new Set()
  for (const name of localPackageNames) {
    const directory = localPackageDirectories.get(name)
    if (directory === undefined) continue
    const value = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    for (const [dependencyName, range] of Object.entries(value.peerDependencies ?? {})) {
      if (!localPackageDirectories.has(dependencyName)) dependencies[dependencyName] ??= range
      if (dependencyName.startsWith('@deepseek-ai/dsh-')) harnessPackageNames.add(dependencyName)
    }
    for (const dependencyName of Object.keys({
      ...value.dependencies,
      ...value.optionalDependencies,
    })) {
      if (dependencyName.startsWith('@deepseek-ai/dsh-')) harnessPackageNames.add(dependencyName)
    }
  }
  const harnessQueue = [...harnessPackageNames]
  while (harnessQueue.length > 0) {
    const name = harnessQueue.shift()
    const output = execFileSync('npm', ['view', `${name}@${requestedHarnessLine}`, '--json'], { encoding: 'utf8' }).trim()
    const metadata = output === '' ? {} : JSON.parse(output)
    for (const dependencyName of Object.keys({
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
      ...metadata.peerDependencies,
    })) {
      if (!dependencyName.startsWith('@deepseek-ai/dsh-') || harnessPackageNames.has(dependencyName)) continue
      harnessPackageNames.add(dependencyName)
      harnessQueue.push(dependencyName)
    }
  }
  for (const name of harnessPackageNames) dependencies[name] = requestedHarnessLine
  const overrides = Object.fromEntries([...harnessPackageNames].map(name => [name, requestedHarnessLine]))
  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies,
    overrides,
  }, null, 2))
  if (!install) {
    throw new FixtureFailure('FIXTURE_INSTALL_REQUIRED', 'independent scenarios require --install')
  }
  const installArguments = ['install', '--ignore-scripts', '--no-audit', '--no-fund']
  execFileSync('npm', installArguments, { cwd: fixtureRoot, stdio: 'ignore' })
  report.installed = true
  report.independentInstall = existsSync(join(fixtureRoot, 'node_modules'))
  ensure(report.independentInstall, 'FIXTURE_INSTALL_MISSING', 'npm install produced no node_modules directory')
  function installedHarnessInstances() {
    const instances = []
    const visited = new Set()
    const visitPackage = (directory) => {
      if (visited.has(directory)) return
      visited.add(directory)
      const packageFile = join(directory, 'package.json')
      if (!existsSync(packageFile)) return
      const value = JSON.parse(readFileSync(packageFile, 'utf8'))
      if (typeof value.name === 'string' && value.name.startsWith('@deepseek-ai/dsh-')) {
        instances.push({
          name: value.name,
          version: value.version,
          path: relative(fixtureRoot, directory).split(sep).join('/'),
        })
      }
      visitNodeModules(join(directory, 'node_modules'))
    }
    const visitNodeModules = (directory) => {
      if (!existsSync(directory)) return
      for (const entry of readdirSync(directory)) {
        if (entry.startsWith('.')) continue
        const child = join(directory, entry)
        const info = lstatSync(child)
        if (!info.isDirectory() || info.isSymbolicLink()) continue
        if (entry.startsWith('@')) {
          for (const scopedEntry of readdirSync(child)) visitPackage(join(child, scopedEntry))
        } else {
          visitPackage(child)
        }
      }
    }
    visitNodeModules(join(fixtureRoot, 'node_modules'))
    return instances.sort((left, right) => left.path.localeCompare(right.path))
  }

  const installedHarness = installedHarnessInstances()
  report.harnessPackageInstances.push(...installedHarness)
  Object.assign(report.harnessPackages, summarizeHarnessPackageInstances(installedHarness))
  const mismatches = installedHarness.filter(instance => instance.version !== requestedHarnessLine)
  ensure(
    mismatches.length === 0,
    'FIXTURE_HARNESS_LINE_MISMATCH',
    `${mismatches.map(instance => `${instance.name} resolved to ${String(instance.version)} at ${instance.path}`).join('; ')}, expected ${requestedHarnessLine}`,
  )
  for (const name of harnessPackageNames) {
    ensure(Object.hasOwn(report.harnessPackages, name), 'FIXTURE_HARNESS_PACKAGE_MISSING', `${name} was not installed for Harness ${String(requestedHarnessLine)}`)
  }

  const importPackage = await createPackageImporter(fixtureRoot)
  const imported = new Map()
  async function load(name) {
    if (imported.has(name)) return imported.get(name)
    const module = await importPackage(name)
    imported.set(name, module)
    return module
  }

  if (externalPackage) {
    await scenario('plugin.public-entry-packed-load', async () => {
      const installedRoot = join(fixtureRoot, 'node_modules', ...manifest.name.split('/'))
      const installedPackage = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
      ensure(installedPackage.blue?.manifest === './blue.plugin.json', 'FIXTURE_PLUGIN_DISCOVERY', 'packed package lost package.json.blue.manifest')
      const distribution = JSON.parse(readFileSync(join(installedRoot, 'blue.plugin.json'), 'utf8'))
      const protocolV1 = await load('@dsh-blue/blue-api/protocol/v1')
      const parsed = protocolV1.validateBluePluginManifestV1(distribution)
      ensure(parsed.ok, 'FIXTURE_PLUGIN_MANIFEST', parsed.ok ? '' : parsed.issues.map(issue => issue.message).join('; '))
      ensure(parsed.value.id === manifest.name, 'FIXTURE_PLUGIN_ID', `packed manifest id ${String(parsed.value.id)} differs from ${String(manifest.name)}`)
      const entrySpecifier = parsed.value.entry === '.' ? manifest.name : `${manifest.name}${parsed.value.entry.slice(1)}`
      // Keep untrusted package initialization out of this process. A plugin
      // may log, terminate, or hang while its public entry is being imported;
      // the parent must still emit one clean JSON report and remove the fixture.
      const probePath = join(fixtureRoot, '.blue-plugin-entry-probe.mjs')
      const probeSentinel = '__BLUE_PLUGIN_ENTRY_PROBE__'
      writeFileSync(probePath, `const module = await import(${JSON.stringify(entrySpecifier)})\nprocess.stdout.write(${JSON.stringify(probeSentinel)} + JSON.stringify({ name: typeof module.name, apply: typeof module.apply }) + '\\n')\n`)
      const probe = spawnSync(process.execPath, [probePath], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      ensure(probe.error === undefined && probe.signal === null && probe.status === 0 && probe.stdout.includes(probeSentinel), 'FIXTURE_PLUGIN_ENTRY_PROBE_FAILED', `${entrySpecifier} probe did not complete: ${probe.error?.message ?? probe.signal ?? `exit ${String(probe.status)}`}`)
      const expectedProbeOutput = `${probeSentinel}{"name":"string","apply":"function"}\n`
      ensure(probe.stderr === '' && probe.stdout === expectedProbeOutput, 'FIXTURE_PLUGIN_STDIO', `${entrySpecifier} emitted unexpected probe output`)
      report.observations.push({ scenario: 'plugin.public-entry-packed-load', entry: entrySpecifier })
    })
  }

  const frontend = await load('@dsh-blue/blue-frontend')
  const adapter = await load('@dsh-blue/blue-harness-adapter')
  const core = await load('@dsh-blue/blue-core')
  const cordis = await load('@deepseek-ai/cordis')
  const themeDark = await load('@dsh-blue/blue-core/theme-dark')
  const context = await load('@dsh-blue/blue-context')
  const conversation = await load('@dsh-blue/blue-conversation')
  const remote = await load('@dsh-blue/blue-remote')
  const officialTranscript = await load('@dsh-blue/blue-transcript/official-model')
  const transcriptModel = await load('@dsh-blue/blue-transcript/transcript-model')
  compilerContext = new cordis.Context()
  const compilerComponents = new core.BlueComponentsService(compilerContext, {
    theme: { colors: themeDark.DARK_COLORS },
    tui: {},
  })
  function renderNode(node, width) {
    const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
    const compiled = core.compileBlueUiNode(node, {
      components: compilerComponents,
      colors: themeDark.DARK_COLORS,
      getViewport: () => ({ columns: safeWidth, rows: Number.MAX_SAFE_INTEGER }),
      screenMode: 'main',
      emit: () => {},
    })
    ensure(compiled.ok, 'FIXTURE_CANONICAL_COMPILE', compiled.ok ? '' : compiled.message)
    return compiled.value.component.render(safeWidth)
  }

  await scenario('provider.swap-and-plain-fallback', async () => {
    const host = new frontend.FrontendHost()
    await host.activateInitial({ id: 'fixture-provider', activate: ctx => ctx.publish({ providerId: 'fixture-provider', capabilities: [], nodes: [{ kind: 'text', content: 'ready' }] }) })
    await host.swap({ id: 'fixture-failing-provider', activate: () => { throw new Error('fixture failure') } })
    ensure(host.snapshot.providerId === 'plain', 'FIXTURE_PROVIDER_FALLBACK', 'provider failure did not fall back to plain')
    await host.unload()
  })

  await scenario('provider.unload-and-late-event', async () => {
    const host = new frontend.FrontendHost()
    let latePublish
    await host.activateInitial({ id: 'fixture-late-provider', activate: ctx => { latePublish = () => ctx.publish({ providerId: 'fixture-late-provider', capabilities: [], nodes: [{ kind: 'text', content: 'late' }] }); ctx.publish({ providerId: 'fixture-late-provider', capabilities: [], nodes: [] }) } })
    await host.unload()
    latePublish?.()
    ensure(host.snapshot.providerId === 'plain', 'FIXTURE_PROVIDER_LATE_EVENT', 'late publish survived unload')
  })

  await scenario('action.abort-and-stale-result', async () => {
    const coordinator = new adapter.ActionCoordinator()
    const stale = coordinator.execute('main', async () => 'late')
    coordinator.switchSession()
    const staleResult = await stale
    ensure(!staleResult.ok && staleResult.code === 'BLUE_ACTION_REJECTED', 'FIXTURE_ACTION_STALE', 'stale action was accepted')
    const abortController = new AbortController()
    const aborted = coordinator.execute('main', async ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve('aborted'), { once: true })), { signal: abortController.signal })
    abortController.abort()
    const abortResult = await aborted
    ensure(!abortResult.ok && abortResult.code === 'BLUE_ABORTED', 'FIXTURE_ACTION_ABORT', 'aborted action was not rejected')
    coordinator.dispose()
  })

  await scenario('context.projection-replay-resume', async () => {
    let contextListener
    let refreshCount = 0
    const contextSource = {
      capabilities: ['context', 'breakdown', 'refresh', 'status'],
      snapshot: async () => ({ watermark: 2, events: [{ type: 'usage', usage: { turn: 1, step: 1, inputTokens: 10, outputTokens: 2 } }, { type: 'pressure', projectedTokens: 20, contextWindow: 100 }] }),
      subscribe: (_sessionId, _watermark, listener) => { contextListener = listener; return () => { contextListener = undefined } },
      refresh: async () => { refreshCount += 1 },
    }
    const feature = new context.ContextFeature(contextSource)
    await feature.attach('s1')
    contextListener?.({ sessionId: 's1', seq: 3, event: { type: 'usage', usage: { turn: 1, step: 2, inputTokens: 4, outputTokens: 1 } } })
    contextListener?.({ sessionId: 's1', seq: 3, event: { type: 'usage', usage: { turn: 1, step: 2, inputTokens: 40, outputTokens: 5 } } })
    ensure(feature.snapshot?.facts.input === 14, 'FIXTURE_PROJECTION_DUPLICATE', 'context duplicate sequence was applied')
    const refreshResult = await feature.execute({ kind: 'context.refresh', sessionId: 's1' })
    ensure(refreshResult.ok && refreshCount === 1, 'FIXTURE_PROJECTION_ACTION', 'context refresh did not call the source')
    feature.detach()
    contextListener?.({ sessionId: 's1', seq: 4, event: { type: 'pressure', projectedTokens: 99 } })
    feature.dispose()
  })

  await scenario('context.official-baseline-push-unload', async () => {
    let changed
    let unsubscribed = false
    let sequence = 7
    let values = {
      tokenUsage: { uncachedInputTokens: 32, outputTokens: 4, cacheReadTokens: 8, cacheWriteTokens: 1 },
      contextPressure: { projectedTokens: 48, contextWindow: 1024 },
      contextBreakdown: { systemTokens: 2, toolsTokens: 3, messageTokens: 40 },
      contextTimeline: { current: { system: 2, tools: 3, user: 10, inject: 0, assistant: 20, tool: 5, total: 40 }, requests: [{ turn: 1, step: 1, time: 1, seq: 6, total: 40 }], events: [], droppedNodes: 0, images: 0 },
    }
    const source = new context.OfficialContextSource({
      currentMany: keys => ({ asOfSeq: sequence, values: Object.fromEntries(keys.map(key => [key, values[key]])) }),
      subscribe: listener => { changed = listener; return () => { unsubscribed = true; changed = undefined } },
    }, () => 'official')
    const feature = new context.ContextFeature(source)
    await feature.attach('official')
    ensure(feature.snapshot?.facts.timeline?.requests.length === 1 && feature.snapshot.facts.input === 32, 'FIXTURE_OFFICIAL_BASELINE', 'official projection baseline drifted')
    sequence = 8
    values = { ...values }
    delete values.contextTimeline
    changed?.('contextTimeline', undefined, sequence)
    await new Promise(resolveImmediate => setImmediate(resolveImmediate))
    ensure(feature.snapshot?.facts.timeline === undefined, 'FIXTURE_OFFICIAL_UNLOAD', 'unloaded official projection stayed stale')
    const late = changed
    feature.dispose()
    late?.('tokenUsage', values.tokenUsage, 9)
    await new Promise(resolveImmediate => setImmediate(resolveImmediate))
    ensure(unsubscribed && feature.snapshot === undefined, 'FIXTURE_OFFICIAL_LATE_CALLBACK', 'official projection survived feature unload')
  })

  await scenario('remote.resume-action-lease-question-unload', async () => {
    let listener
    let detached = false
    let disposed = false
    let leaseReleased = false
    const actions = []
    const transport = {
      negotiate: async () => ({ protocol: 'fixture-v2', capabilities: ['session', 'action', 'projection', 'question', 'approval', 'writeLease'] }),
      snapshot: async sessionId => ({ watermark: 4, value: { id: sessionId, cwd: '/remote', status: 'idle', mode: 'normal' } }),
      subscribe: (_sessionId, _watermark, next) => { listener = next; return () => { listener = undefined } },
      request: async (_sessionId, action) => { actions.push(action.kind) },
      acquireWriteLease: async sessionId => ({ token: `fixture:${sessionId}`, expiresAt: Date.now() + 60_000 }),
      releaseWriteLease: async () => { leaseReleased = true },
      ask: async (_sessionId, question) => question.answer,
      approve: async (_sessionId, question) => question.outcome,
      detach: () => { detached = true },
      dispose: () => { disposed = true },
    }
    const remoteAdapter = new remote.RemoteSessionAdapter(transport)
    const connected = await remoteAdapter.connect('remote-one')
    ensure(connected.ok && remoteAdapter.protocol === 'fixture-v2', 'FIXTURE_REMOTE_CONNECT', 'remote connect failed')
    const seen = []
    remoteAdapter.subscribe(4, event => seen.push(event.seq))
    listener?.({ sessionId: 'remote-one', seq: 5, event: { id: 'remote-one', cwd: '/remote/live', status: 'running', mode: 'normal' } })
    await remoteAdapter.request({ kind: 'followup', text: 'hello' }, new AbortController().signal)
    const lease = await remoteAdapter.acquireWriteLease()
    ensure(lease.ok, 'FIXTURE_REMOTE_LEASE', 'remote lease failed')
    await remoteAdapter.releaseWriteLease()
    const questions = remoteAdapter.questionSource()
    ensure(await questions?.ask({ answer: 'answered' }, new AbortController().signal) === 'answered', 'FIXTURE_REMOTE_QUESTION', 'remote question failed')
    ensure(await questions?.approve({ outcome: 'allowed-once' }, new AbortController().signal) === 'allowed-once', 'FIXTURE_REMOTE_APPROVAL', 'remote approval failed')
    const late = listener
    remoteAdapter.disconnect()
    late?.({ sessionId: 'remote-one', seq: 6, event: { id: 'remote-one', cwd: '/late', status: 'idle', mode: 'normal' } })
    remoteAdapter.dispose()
    await new Promise(resolveImmediate => setImmediate(resolveImmediate))
    ensure(seen.join() === '5' && actions.join() === 'followup' && leaseReleased && detached && disposed, 'FIXTURE_REMOTE_UNLOAD', 'remote unload contract drifted')
  })

  await scenario('renderer.width-scan-20-40-80-120', async () => {
    const model = context.buildContextModel({ sessionId: 's1', watermark: 3, facts: { input: 123456, output: 7890, cacheRead: 42, cacheWrite: 8, used: 120, window: 1000, breakdown: { system: 1, tools: 2, messages: 3 } } })
    const nodes = [model.panel.node, ...model.status.nodes]
    for (const width of [20, 40, 80, 120]) {
      for (const node of nodes) {
        const rows = renderNode(node, width)
        ensure(!rows.some(row => core.visibleWidth(row) > width), 'FIXTURE_WIDTH_OVERFLOW', `frontend renderer exceeded width ${width}`)
      }
    }
  })

  if (manifest.name === '@dsh-blue/blue-harness-adapter') {
    const localeAdapter = await load('@dsh-blue/blue-harness-adapter/locale')
    const settingsModule = await load('@deepseek-ai/dsh-settings')
    const SettingsProvider = settingsModule.default
    const localeNamespace = settingsModule.settingsNamespace('locale')

    class MemorySettings extends SettingsProvider {
      writable = true
      constructor(ctx, document) {
        super(ctx)
        this.document = document
      }
      async load() { return this.document }
      async persist(ns, section) { this.document[String(ns)] = section }
    }

    await scenario('locale.preference-live-reload-unload', async () => {
      const ctx = new cordis.Context()
      const localeFiber = await ctx.plugin(localeAdapter)
      const retained = ctx.blueLocale
      const settingsFiber = await ctx.plugin(MemorySettings, { locale: { preference: 'zh' } })
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
      ensure(retained.preference === 'zh' && retained.locale === 'zh', 'FIXTURE_LOCALE_INITIAL', 'persisted locale preference was not applied')
      await ctx.settings.update(localeNamespace, { preference: 'en' })
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
      ensure(retained.preference === 'en' && retained.locale === 'en', 'FIXTURE_LOCALE_UPDATE', 'live locale preference did not update')
      await settingsFiber.dispose()
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
      ensure(retained.preference === undefined, 'FIXTURE_LOCALE_SETTINGS_UNLOAD', 'settings unload retained an explicit locale preference')
      const reloaded = await ctx.plugin(MemorySettings, { locale: { preference: 'zh' } })
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20))
      ensure(retained.preference === 'zh', 'FIXTURE_LOCALE_SETTINGS_RELOAD', 'settings reload did not restore the locale preference')
      await reloaded.dispose()
      await localeFiber.dispose()
      ensure(ctx.get('blueLocale') === undefined && !retained.setPreference('en'), 'FIXTURE_LOCALE_UNLOAD', 'locale service survived owner unload')
      await ctx.fiber.dispose()
    })
  }

  if (manifest.name === '@dsh-blue/blue-app') {
    const blueApi = await load('@dsh-blue/blue-api')
    const protocolV1 = await load('@dsh-blue/blue-api/protocol/v1')
    const sessionBridge = await load('@dsh-blue/blue-app/plugin-host-session-bridge')

    function effectOwner() {
      const cleanups = []
      return {
        effect(callback) {
          const cleanup = callback()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        },
        dispose() {
          for (const cleanup of cleanups.splice(0).reverse()) cleanup()
        },
      }
    }

    function sessionContext() {
      const ctx = new cordis.Context()
      const host = new blueApi.BluePluginHostService(ctx)
      let snapshot = { revision: 1, sessionEpoch: 1, id: 'packed-a', cwd: '/packed/a', status: 'idle', mode: 'normal', model: { id: 'packed-model', provider: 'packed-provider' } }
      let projection = { sessionEpoch: 1, asOfSeq: 1, values: { costUsage: { totalUsd: 1 } } }
      let sessionListener
      let projectionListener
      const reader = {
        current: () => snapshot,
        subscribe(next) {
          sessionListener = next
          next(snapshot)
          let disposed = false
          return {
            get disposed() { return disposed },
            dispose() { if (!disposed) { disposed = true; if (sessionListener === next) sessionListener = undefined } },
          }
        },
      }
      const projections = {
        currentMany(keys) {
          const values = {}
          for (const key of keys) {
            if (Object.hasOwn(projection.values, key)) Object.defineProperty(values, key, { enumerable: true, value: projection.values[key] })
          }
          return { sessionEpoch: projection.sessionEpoch, asOfSeq: projection.asOfSeq, values }
        },
        subscribe(next) {
          projectionListener = next
          return () => { if (projectionListener === next) projectionListener = undefined }
        },
      }
      ctx.reflect.provide('blueSessionReader', reader)
      ctx.reflect.provide('blueSessionProjections', projections)
      return {
        ctx,
        host,
        reader,
        publishSession(value) { snapshot = value; sessionListener?.(value) },
        publishProjection(value) {
          projection = value
          projectionListener?.('costUsage', value.values.costUsage, value.asOfSeq, value.sessionEpoch)
        },
        lateSessionListener: () => sessionListener,
        lateProjectionListener: () => projectionListener,
      }
    }

    await scenario('app.session-data-v1-scope-epoch-replay-unload', async () => {
      const fixture = sessionContext()
      let ownerFiber
      try {
        ownerFiber = await fixture.ctx.plugin(sessionBridge)
        const readConsumer = effectOwner()
        const read = fixture.host.open(readConsumer, {
          $schema: protocolV1.BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
          schemaVersion: 1,
          id: '@fixture/session-data-v1',
          entry: '.',
          api: '^1.0.0-beta.1',
          compatibility: { blue: '^0.1.1-rc.2', harness: '^0.1.1-rc.2', node: '>=22' },
          capabilities: {
            required: [
              { name: 'session.read', version: '^1.0.0', resources: { fields: ['identity', 'cwd', 'model'] } },
              { name: 'session.projections.read', version: '^1.0.0', resources: { keys: ['costUsage'] } },
            ],
            optional: [],
          },
        })
        ensure(read.ok && read.value.session !== undefined && read.value.projections !== undefined && !Object.hasOwn(read.value, 'sessionActions'), 'FIXTURE_SESSION_DATA_SCOPE', 'canonical manifest did not receive only granted session-data facets')
        const initialResult = read.value.session.current()
        ensure(initialResult.ok && initialResult.value !== null, 'FIXTURE_SESSION_READ_CURRENT', 'canonical session.read did not return its current result')
        const initial = initialResult.value
        ensure(Object.keys(initial).join() === 'revision,sessionEpoch,id,cwd,model' && !Object.hasOwn(initial, 'status'), 'FIXTURE_SESSION_READ_FIELDS', 'session.read leaked an ungranted field')
        ensure(initial !== fixture.reader.current() && initial.model !== fixture.reader.current().model, 'FIXTURE_SESSION_READ_COPY', 'host retained owner snapshot identity')
        ensure(Object.isFrozen(initial) && Object.isFrozen(initial.model), 'FIXTURE_SESSION_READ_FREEZE', 'session snapshot was not deeply frozen')
        fixture.reader.current().model.id = 'mutated-owner-model'
        ensure(initial?.model?.id === 'packed-model', 'FIXTURE_SESSION_READ_OWNER_MUTATION', 'owner mutation crossed the snapshot boundary')

        const seen = []
        const registrationResult = read.value.session.subscribe(result => {
          seen.push(result.ok ? result.value?.revision ?? -1 : result.code)
          if (result.ok && result.value?.revision === 1) fixture.publishSession({ revision: 2, sessionEpoch: 1, id: 'packed-a', cwd: '/packed/reentrant', status: 'running', mode: 'plan' })
        })
        ensure(registrationResult.ok, 'FIXTURE_SESSION_READ_SUBSCRIBE', 'canonical session subscription was rejected')
        ensure(seen.join() === '1,2' && read.value.session.current().value?.cwd === '/packed/reentrant', 'FIXTURE_SESSION_READ_REENTRANT', 'subscribe-before-replay missed a reentrant revision')
        fixture.publishSession({ revision: 2, sessionEpoch: 1, id: 'packed-a', cwd: '/packed/duplicate', status: 'failed', mode: 'normal' })
        fixture.publishSession({ revision: 1, sessionEpoch: 1, id: 'packed-a', cwd: '/packed/regressed', status: 'failed', mode: 'normal' })
        ensure(seen.join() === '1,2', 'FIXTURE_SESSION_READ_REVISION_FENCE', 'duplicate or regressing revision was admitted')
        registrationResult.value.dispose()
        registrationResult.value.dispose()
        fixture.publishSession({ revision: 3, sessionEpoch: 1, id: 'packed-a', cwd: '/packed/disposed', status: 'idle', mode: 'normal' })
        ensure(seen.join() === '1,2', 'FIXTURE_SESSION_READ_DISPOSE', 'disposed read subscription received an update')

        const projectionResult = read.value.projections.currentMany(['costUsage'])
        ensure(projectionResult.ok && projectionResult.value?.values.costUsage.totalUsd === 1, 'FIXTURE_PROJECTION_CURRENT', 'canonical projection cut was unavailable')
        const projected = projectionResult.value.values.costUsage
        ensure(Object.isFrozen(projectionResult.value) && Object.isFrozen(projectionResult.value.values) && Object.isFrozen(projected), 'FIXTURE_PROJECTION_FREEZE', 'projection cut was not deeply frozen')
        fixture.publishProjection({ sessionEpoch: 1, asOfSeq: 2, values: { costUsage: { totalUsd: 2 } } })
        ensure(read.value.projections.current('costUsage').value?.value.totalUsd === 2, 'FIXTURE_PROJECTION_UPDATE', 'projection update did not cross the packed owner bridge')
        ensure(read.value.projections.current('secret').code === 'BLUE_RESOURCE_DENIED', 'FIXTURE_PROJECTION_SCOPE', 'projection key grant did not reject an ungranted key')

        const removedConsumer = effectOwner()
        const removed = fixture.host.open(removedConsumer, { id: '@fixture/session-act-removed', api: '^1.0.0-beta.1', capabilities: ['session.act'] })
        ensure(!removed.ok && removed.code === 'BLUE_API_INCOMPATIBLE', 'FIXTURE_SESSION_ACT_REMOVED', 'removed session.act capability remained admissible')

        const retainedSession = read.value.session
        const retainedProjections = read.value.projections
        const lateSession = fixture.lateSessionListener()
        const lateProjection = fixture.lateProjectionListener()
        await ownerFiber.dispose()
        ownerFiber = undefined
        lateSession?.({ revision: 4, sessionEpoch: 1, id: 'packed-late', cwd: '/late', status: 'failed', mode: 'yolo' })
        lateProjection?.('costUsage', { totalUsd: 999 }, 99, 1)
        ensure(retainedSession.current().code === 'BLUE_CAPABILITY_ABSENT', 'FIXTURE_SESSION_READ_OWNER_UNLOAD', 'retained reader admitted an old-owner callback')
        ensure(retainedProjections.current('costUsage').code === 'BLUE_CAPABILITY_ABSENT', 'FIXTURE_PROJECTION_OWNER_UNLOAD', 'retained projection admitted an old-owner callback')
        fixture.publishSession({ revision: 1, sessionEpoch: 2, id: 'packed-a', cwd: '/packed/new-epoch', status: 'idle', mode: 'normal' })
        fixture.publishProjection({ sessionEpoch: 2, asOfSeq: 0, values: { costUsage: { totalUsd: 3 } } })
        ownerFiber = await fixture.ctx.plugin(sessionBridge)
        const reloadedSession = retainedSession.current()
        const reloadedProjection = retainedProjections.current('costUsage')
        ensure(reloadedSession.ok && reloadedSession.value?.sessionEpoch === 2 && reloadedSession.value.revision === 1, 'FIXTURE_SESSION_READ_OWNER_RELOAD', 'retained reader did not accept a same-id new epoch')
        ensure(reloadedProjection.ok && reloadedProjection.value?.sessionEpoch === 2 && reloadedProjection.value.asOfSeq === 0, 'FIXTURE_PROJECTION_OWNER_RELOAD', 'retained projection did not replay the replacement owner cut')

        removedConsumer.dispose()
        readConsumer.dispose()
        ensure(retainedSession.current().code === 'BLUE_ACTION_REJECTED', 'FIXTURE_SESSION_READ_CONSUMER_UNLOAD', 'disposed consumer retained a readable snapshot')
        ensure(retainedProjections.current('costUsage').code === 'BLUE_ACTION_REJECTED', 'FIXTURE_PROJECTION_CONSUMER_UNLOAD', 'disposed consumer retained a readable projection')
      } finally {
        await ownerFiber?.dispose()
        await fixture.ctx.fiber.dispose()
      }
    })

    report.observations.push('canonical session.read and session.projections.read exercised through packed API/app exports with exact scope, epoch replay, freeze, and unload fencing; generic session.act rejected')
  }

  if (manifest.name === '@dsh-blue/blue-interaction') {
    const cordis = await load('@deepseek-ai/cordis')
    const blueApi = await load('@dsh-blue/blue-api')
    const interaction = await load('@dsh-blue/blue-interaction')
    const interactionBridge = await load('@dsh-blue/blue-interaction/plugin-host-bridge')
    const editorProviderOwner = await load('@dsh-blue/blue-interaction/editor-provider-owner')

    function effectOwner() {
      const cleanups = []
      return {
        effect(callback) {
          const cleanup = callback()
          if (typeof cleanup === 'function') cleanups.push(cleanup)
        },
        dispose() {
          for (const cleanup of cleanups.splice(0).reverse()) cleanup()
        },
      }
    }

    function ownerSnapshot(lease) {
      const result = lease.snapshot()
      ensure(result.ok, 'FIXTURE_OWNER_STALE', result.message ?? 'fixture owner lease is stale')
      return result.value
    }

    function interactionContext() {
      const ctx = new cordis.Context()
      const host = new blueApi.BluePluginHostService(ctx)
      const control = ctx.get('bluePluginControl')
      const editorHost = new interaction.EditorHostService(ctx)
      ctx.reflect.provide('commands', { register: () => () => {} })
      const identity = value => value
      ctx.reflect.provide('blueTheme', { colors: new Proxy({}, { get: () => identity }) })
      return { ctx, host, control, editorHost }
    }

    class PackedEditor {
      constructor(components) {
        this.components = components
        this.focused = false
        this.disableSubmit = false
        this.text = ''
        this.cursor = 0
        this.history = []
        this.barrier = undefined
      }
      setSubmitBarrier(barrier) { this.barrier = barrier }
      submit() {
        if (this.disableSubmit) return
        if (this.barrier === undefined) { this.onSubmit?.(this.text); return }
        const controller = new AbortController()
        let settled = false
        this.barrier(Object.freeze({
          text: this.text.trim(),
          signal: controller.signal,
          revision: 1,
          commit: () => {
            if (settled) return false
            settled = true
            this.onSubmit?.(this.text)
            return true
          },
          cancel: () => { if (!settled) { settled = true; controller.abort() } },
        }))
      }
      isShowingAutocomplete() { return false }
      getText() { return this.text }
      setText(text) { this.text = text; this.cursor = text.length }
      addToHistory(text) { this.history.unshift(text) }
      getHistory() { return [...this.history] }
      removeLatestHistory(text) {
        if (this.history[0] !== text) return false
        this.history.shift()
        return true
      }
      setBorderColor() {}
      setPromptSymbol() {}
      setBorderLabel() {}
      setConnectedAbove() {}
      setGhostHint() {}
      setAutocompleteProvider(provider) { this.autocompleteProvider = provider }
      getExpandedText() { return this.text }
      renderContent(width) { return [this.components.truncateToWidth(this.text, Math.max(1, width), '')] }
      insertText(text) {
        this.text = `${this.text.slice(0, this.cursor)}${text}${this.text.slice(this.cursor)}`
        this.cursor += text.length
        this.onChange?.(this.text)
      }
      handleInput(data) {
        if (this.onKey?.(data) === true) return
        if (data === '\x1b[D') { this.cursor = Math.max(0, this.cursor - 1); return }
        if (data === '\x1b[C') { this.cursor = Math.min(this.text.length, this.cursor + 1); return }
        if (data === '\r' || data === '\n') { this.submit(); return }
        if (!/^[^\x00-\x1f\x7f-\x9f]+$/u.test(data)) return
        this.insertText(data)
      }
      render(width) { return this.renderContent(width) }
      invalidate() {}
    }

    async function editorProviderFixture() {
      const ctx = new cordis.Context()
      const host = new blueApi.BluePluginHostService(ctx)
      const control = ctx.get('bluePluginControl')
      const auditOwner = effectOwner()
      const auditLease = control.attachCapabilities(auditOwner, ['panes'])
      const identity = value => value
      const colors = new Proxy({ logoGradient: [identity] }, {
        get(target, key) { return key === 'logoGradient' ? target.logoGradient : identity },
      })
      const bottom = []
      const screen = {
        columns: 80,
        rows: 24,
        focus: null,
        requestRender() {},
        addBottomChild(component) {
          bottom.push(component)
          return () => {
            const index = bottom.indexOf(component)
            if (index >= 0) bottom.splice(index, 1)
          }
        },
        setFocus(component) {
          if (this.focus === component) return
          if (this.focus !== null) this.focus.focused = false
          this.focus = component
          if (component !== null) component.focused = true
        },
        scrollContent: () => false,
        followContent() {},
        setContentScrollHandler() { return () => {} },
        setTitle() {},
        async suspend(run) { return run() },
      }
      ctx.reflect.provide('blueScreen', screen)
      ctx.reflect.provide('blueTheme', { colors })
      class PackedComponents extends core.BlueComponentsService {
        createEditor() {
          const editor = new PackedEditor(this)
          this.editors ??= []
          this.editors.push(editor)
          return editor
        }
      }
      new PackedComponents(ctx, { theme: { colors }, tui: {} })
      new core.BlueKeymapService(ctx)
      ctx.reflect.provide('commands', { register: () => () => {} })
      const session = Object.freeze({ id: 'packed-session', cwd: '/packed', status: 'idle', mode: 'normal' })
      const sessionListeners = new Set()
      ctx.reflect.provide('blueSessionReader', {
        current: () => session,
        subscribe(listener) {
          sessionListeners.add(listener)
          return { dispose: () => sessionListeners.delete(listener) }
        },
        request: async () => ({ ok: true, value: undefined }),
      })
      ctx.reflect.provide('blueSessionActions', {
        commands: () => [],
        followup: () => ({ ok: true, value: { messageId: 'packed-message' } }),
        steer: () => ({ ok: true, value: undefined }),
        interrupt: () => ({ ok: true, value: undefined }),
        executeCommand: async () => undefined,
        skillSnapshot: async () => ({ ok: true, value: { complete: true, skills: [] } }),
        subscribeSkillChanges: () => ({ disposed: false, dispose() { this.disposed = true } }),
      })
      ctx.reflect.provide('blueRequests', { begin() {} })
      ctx.reflect.provide('blueRetractions', { tryRetract: () => false })
      const loaderGate = Promise.withResolvers()
      ctx.reflect.provide('loader', { await: () => loaderGate.promise })
      const interactionFiber = await ctx.plugin(interaction)
      ctx.blueInteractionState.settingsSource = () => ({ updateCheck: false, updateChannel: 'next' })
      loaderGate.resolve()
      await new Promise(resolveImmediate => setImmediate(resolveImmediate))
      const ownerFiber = await ctx.plugin(editorProviderOwner)
      const editor = ctx.blueEditorHost.current?.editor
      ensure(editor !== undefined && screen.focus !== null, 'FIXTURE_EDITOR_PROVIDER_MOUNT', 'packed blue-input did not publish its editor runtime')
      const outer = screen.focus
      const consumer = effectOwner()
      const opened = host.open(consumer, {
        id: '@fixture/editor-provider',
        api: '^1.0.0-beta.1',
        capabilities: ['editor.provider'],
      })
      ensure(opened.ok, 'FIXTURE_EDITOR_PROVIDER_OPEN', opened.ok ? '' : opened.message)
      return {
        ctx,
        host,
        auditLease,
        screen,
        editor,
        outer,
        opened: opened.value,
        ownerFiber,
        render(width = 60) { return outer.render(width) },
        select(id) { ctx.emit('blue/settings-source-ready', { editorProvider: id }) },
        async dispose() {
          consumer.dispose()
          auditOwner.dispose()
          await interactionFiber.dispose()
          await ctx.fiber.dispose()
        },
      }
    }

    const extensionManifest = Object.freeze({
      id: '@fixture/editor-extensions',
      api: '^1.0.0-beta.1',
      capabilities: Object.freeze(['editor.extensions']),
    })

    await scenario('interaction.editor-extensions-owner-replay-inert', async () => {
      const { ctx, host, editorHost } = interactionContext()
      const consumer = effectOwner()
      let bridgeFiber
      try {
        const absent = host.open(consumer, extensionManifest)
        ensure(!absent.ok && absent.code === 'BLUE_CAPABILITY_ABSENT', 'FIXTURE_EDITOR_EXTENSION_ABSENT', 'editor.extensions opened without an active interaction owner')

        bridgeFiber = await ctx.plugin(interactionBridge)
        const opened = host.open(consumer, extensionManifest)
        ensure(opened.ok, 'FIXTURE_EDITOR_EXTENSION_OPEN', opened.ok ? '' : opened.message)
        let completeCalls = 0
        let transformCalls = 0
        let eventCalls = 0
        const registration = opened.value.editorExtensions.register({
          id: 'packed.extension',
          priority: 40,
          before: { kind: 'text', content: 'packed before' },
          actions: [{ id: 'packed-action', label: 'Packed action' }],
          complete: () => { completeCalls += 1; return { ok: true, value: [] } },
          transformSubmit: request => { transformCalls += 1; return { ok: true, value: { text: request.text } } },
          onEvent: () => { eventCalls += 1; return { ok: true, value: undefined } },
        })
        ensure(registration.ok, 'FIXTURE_EDITOR_EXTENSION_REGISTER', registration.ok ? '' : registration.message)
        ensure(completeCalls === 0 && transformCalls === 0 && eventCalls === 0, 'FIXTURE_EDITOR_EXTENSION_INERT', 'registration invoked an editor extension callback')
        const firstBinding = editorHost.extensions
        ensure(firstBinding?.entries[0]?.id === 'packed.extension', 'FIXTURE_EDITOR_EXTENSION_BINDING', 'interaction owner did not project the registered extension')

        await bridgeFiber.dispose()
        bridgeFiber = undefined
        ensure(editorHost.extensions === undefined, 'FIXTURE_EDITOR_EXTENSION_OWNER_UNLOAD', 'editor extension binding survived interaction owner unload')
        ensure(!registration.value.refresh().ok, 'FIXTURE_EDITOR_EXTENSION_LATE_REFRESH', 'extension refresh survived owner unload')

        bridgeFiber = await ctx.plugin(interactionBridge)
        const replayed = editorHost.extensions
        ensure(replayed !== undefined && replayed !== firstBinding && replayed.entries[0]?.id === 'packed.extension', 'FIXTURE_EDITOR_EXTENSION_REPLAY', 'owner reload did not replay the packed extension')
        ensure(completeCalls === 0 && transformCalls === 0 && eventCalls === 0, 'FIXTURE_EDITOR_EXTENSION_REPLAY_INERT', 'bridge replay invoked an extension callback')

        registration.value.dispose()
        const replacement = opened.value.editorExtensions.register({
          id: 'packed.extension',
          hint: 'replacement',
          complete: () => { completeCalls += 1; return { ok: true, value: [] } },
        })
        ensure(replacement.ok && editorHost.extensions?.entries[0]?.hint === 'replacement', 'FIXTURE_EDITOR_EXTENSION_SAME_ID_RELOAD', 'same-id extension replacement failed after owner replay')
        ensure(completeCalls === 0, 'FIXTURE_EDITOR_EXTENSION_REPLACEMENT_INERT', 'same-id replacement invoked its callback')
        replacement.value.dispose()
      } finally {
        await bridgeFiber?.dispose()
        consumer.dispose()
        await ctx.fiber.dispose()
      }
    })

    await scenario('interaction.editor-extensions-context-abort-unload-late', async () => {
      const { ctx, host, control, editorHost } = interactionContext()
      const consumer = effectOwner()
      const auditOwner = effectOwner()
      const auditLease = control.attachCapabilities(auditOwner, ['panes'])
      let bridgeFiber
      try {
        bridgeFiber = await ctx.plugin(interactionBridge)
        const opened = host.open(consumer, extensionManifest)
        ensure(opened.ok, 'FIXTURE_EDITOR_CALLBACK_OPEN', opened.ok ? '' : opened.message)
        const contexts = new Map()
        const requests = new Map()
        const registration = opened.value.editorExtensions.register({
          id: 'packed.callbacks',
          completeV2(request, context) {
            requests.set('complete', request)
            contexts.set('complete', context)
            return { ok: true, value: [{ id: 'packed-item', label: 'Packed item', insertText: 'packed-value' }] }
          },
          transformSubmit(request, context) {
            requests.set('transform', request)
            contexts.set('transform', context)
            return { ok: true, value: { text: `packed:${request.text}` } }
          },
          onEvent(event, context) {
            requests.set('event', event)
            contexts.set('event', context)
            return { ok: true, value: undefined }
          },
        })
        ensure(registration.ok, 'FIXTURE_EDITOR_CALLBACK_REGISTER', registration.ok ? '' : registration.message)
        ensure(contexts.size === 0 && requests.size === 0, 'FIXTURE_EDITOR_CALLBACK_INERT', 'callback registration performed work')
        const binding = editorHost.extensions
        const entry = binding?.entries.find(candidate => candidate.id === 'packed.callbacks')
        ensure(binding !== undefined && entry !== undefined, 'FIXTURE_EDITOR_CALLBACK_BINDING', 'callback extension was not projected')

        const completeController = new AbortController()
        const transformController = new AbortController()
        const eventController = new AbortController()
        const completionRequest = Object.freeze({ trigger: '#', query: 'packed' })
        const submitRequest = Object.freeze({ text: 'draft', attachments: Object.freeze([]) })
        const eventRequest = Object.freeze({ kind: 'activate', controlId: 'packed-action' })
        const completed = await binding.complete(entry, completionRequest, completeController.signal, 11)
        const transformed = await binding.transform(entry, submitRequest, transformController.signal, 12)
        const dispatched = await binding.dispatch(entry, eventRequest, eventController.signal, 13)
        ensure(completed.ok && completed.value[0]?.insertText === 'packed-value', 'FIXTURE_EDITOR_COMPLETE_RESULT', 'completion callback result drifted')
        ensure(transformed.ok && transformed.value.text === 'packed:draft', 'FIXTURE_EDITOR_TRANSFORM_RESULT', 'submit transform result drifted')
        ensure(dispatched.ok, 'FIXTURE_EDITOR_EVENT_RESULT', 'editor action result drifted')
        for (const [kind, controller, revision] of [['complete', completeController, 11], ['transform', transformController, 12], ['event', eventController, 13]]) {
          const contextValue = contexts.get(kind)
          ensure(contextValue?.surfaceId === 'packed.callbacks' && contextValue.signal === controller.signal && contextValue.revision === revision && Object.isFrozen(contextValue), 'FIXTURE_EDITOR_CALLBACK_CONTEXT', `${kind} callback context drifted`)
        }
        ensure(contexts.get('event')?.userGesture !== undefined, 'FIXTURE_EDITOR_EVENT_GESTURE', 'editor action lacked a scoped user gesture')
        ensure(requests.get('complete') === completionRequest, 'FIXTURE_EDITOR_COMPLETE_REQUEST', 'completion request drifted')
        ensure(requests.get('transform') === submitRequest, 'FIXTURE_EDITOR_TRANSFORM_REQUEST', 'submit request drifted')
        ensure(requests.get('event') === eventRequest, 'FIXTURE_EDITOR_EVENT_REQUEST', 'editor action request drifted')

        const lateComplete = Promise.withResolvers()
        const lateTransform = Promise.withResolvers()
        const lateEvent = Promise.withResolvers()
        const lateContexts = new Map()
        const lateRegistration = opened.value.editorExtensions.register({
          id: 'packed.late',
          complete(_request, context) {
            lateContexts.set('complete', context)
            return lateComplete.promise
          },
          transformSubmit(_request, context) {
            lateContexts.set('transform', context)
            return lateTransform.promise
          },
          onEvent(_event, context) {
            lateContexts.set('event', context)
            return lateEvent.promise
          },
        })
        ensure(lateRegistration.ok, 'FIXTURE_EDITOR_LATE_REGISTER', lateRegistration.ok ? '' : lateRegistration.message)
        const lateBinding = editorHost.extensions
        const lateEntry = lateBinding?.entries.find(candidate => candidate.id === 'packed.late')
        ensure(lateBinding !== undefined && lateEntry !== undefined, 'FIXTURE_EDITOR_LATE_BINDING', 'late extension was not projected')
        const lateControllers = {
          complete: new AbortController(),
          transform: new AbortController(),
          event: new AbortController(),
        }
        const pending = [
          lateBinding.complete(lateEntry, { trigger: 'manual', query: 'late' }, lateControllers.complete.signal, 14),
          lateBinding.transform(lateEntry, { text: 'late', attachments: [] }, lateControllers.transform.signal, 15),
          lateBinding.dispatch(lateEntry, { kind: 'activate', controlId: 'late' }, lateControllers.event.signal, 16),
        ]
        await Promise.resolve()
        ensure([...lateContexts].every(([kind, contextValue]) => contextValue.signal === lateControllers[kind].signal && contextValue.signal.aborted === false), 'FIXTURE_EDITOR_ABORT_CONTEXT', 'late callback did not receive the caller signal')
        ensure(lateContexts.size === 3, 'FIXTURE_EDITOR_LATE_CALLBACKS', 'not every late callback started')
        const revisionBeforeUnload = ownerSnapshot(auditLease).editorExtensionsRevision
        for (const controller of Object.values(lateControllers)) controller.abort()
        await bridgeFiber.dispose()
        bridgeFiber = undefined
        ensure([...lateContexts.values()].every(contextValue => contextValue.signal.aborted) && editorHost.extensions === undefined, 'FIXTURE_EDITOR_ABORT_UNLOAD', 'abort or owner unload did not retire the active callback binding')
        lateComplete.resolve({ ok: true, value: [{ id: 'late', label: 'Late', insertText: 'late' }] })
        lateTransform.resolve({ ok: true, value: { text: 'late transformed' } })
        lateEvent.resolve({ ok: true, value: undefined })
        await Promise.all(pending)
        ensure(editorHost.extensions === undefined && ownerSnapshot(auditLease).editorExtensionsRevision === revisionBeforeUnload, 'FIXTURE_EDITOR_LATE_REJECTION', 'late completion republished into the unloaded interaction owner')
        ensure(!lateRegistration.value.refresh().ok, 'FIXTURE_EDITOR_LATE_HANDLE', 'late extension handle remained active without an owner')
        lateRegistration.value.dispose()
        registration.value.dispose()
      } finally {
        await bridgeFiber?.dispose()
        consumer.dispose()
        auditOwner.dispose()
        await ctx.fiber.dispose()
      }
    })

    await scenario('interaction.editor-provider-selection-identity-fallback-inert', async () => {
      const fixture = await editorProviderFixture()
      const shell = label => ({
        kind: 'stack',
        direction: 'column',
        children: [
          { node: { kind: 'text', content: label } },
          { node: { kind: 'editor-control' } },
        ],
      })
      let firstRenders = 0
      let secondRenders = 0
      let badRenders = 0
      let frozenSnapshot = false
      const first = fixture.opened.editorProviders.register({
        id: 'packed.first',
        render(snapshot) {
          firstRenders += 1
          frozenSnapshot = Object.isFrozen(snapshot)
            && Object.isFrozen(snapshot.attachments)
            && Object.isFrozen(snapshot.extensions)
            && !Object.hasOwn(snapshot, 'draft')
          return shell('packed first')
        },
      })
      const second = fixture.opened.editorProviders.register({
        id: 'packed.second',
        render() { secondRenders += 1; return shell('packed second') },
      })
      const bad = fixture.opened.editorProviders.register({
        id: 'packed.bad',
        render() {
          badRenders += 1
          return {
            kind: 'stack',
            direction: 'column',
            children: [
              { node: { kind: 'editor-control' } },
              { node: { kind: 'editor-control' } },
            ],
          }
        },
      })
      try {
        ensure(first.ok && second.ok && bad.ok, 'FIXTURE_EDITOR_PROVIDER_REGISTER', 'packed editor providers did not register')
        fixture.editor.handleInput('ab')
        fixture.editor.addToHistory('older')
        fixture.outer.handleInput('\x1b[D')
        fixture.render()
        ensure(firstRenders === 0 && secondRenders === 0 && badRenders === 0, 'FIXTURE_EDITOR_PROVIDER_INERT', 'installing editor provider candidates invoked one without user selection')

        fixture.select('packed.first')
        const firstRows = fixture.render().join('\n')
        ensure(firstRows.includes('packed first') && firstRenders === 1 && secondRenders === 0 && frozenSnapshot, 'FIXTURE_EDITOR_PROVIDER_PERSISTED_SELECTION', 'persisted selection did not activate only the chosen frozen candidate')
        fixture.select('packed.second')
        const secondRows = fixture.render().join('\n')
        ensure(secondRows.includes('packed second') && secondRenders === 1, 'FIXTURE_EDITOR_PROVIDER_SWITCH', 'settings selection did not atomically switch editor shells')
        ensure(fixture.ctx.blueEditorHost.current?.editor === fixture.editor && fixture.screen.focus === fixture.outer && fixture.outer.focused && fixture.editor.focused, 'FIXTURE_EDITOR_PROVIDER_IDENTITY_FOCUS', 'editor provider switch replaced the editor engine or stable focus delegate')
        ensure(fixture.editor.getText() === 'ab' && fixture.editor.getHistory().join() === 'older', 'FIXTURE_EDITOR_PROVIDER_DRAFT_HISTORY', 'editor provider switch lost draft or history state')
        fixture.outer.handleInput('X')
        ensure(fixture.editor.getText() === 'aXb', 'FIXTURE_EDITOR_PROVIDER_CURSOR', 'editor provider switch did not preserve the cursor position')

        fixture.select('packed.bad')
        const fallbackRows = fixture.render().join('\n')
        ensure(badRenders === 1 && fallbackRows.includes('packed second'), 'FIXTURE_EDITOR_PROVIDER_BAD_FALLBACK', 'bad candidate dismantled the last-known-good editor shell')
        bad.value.dispose()
        second.value.dispose()
        ensure(!fixture.render().join('\n').includes('packed second') && fixture.ctx.blueEditorHost.current?.editor === fixture.editor, 'FIXTURE_EDITOR_PROVIDER_UNLOAD_DEFAULT', 'active provider unload did not restore the default around the same editor')
      } finally {
        if (first.ok) first.value.dispose()
        if (second.ok) second.value.dispose()
        if (bad.ok) bad.value.dispose()
        await fixture.dispose()
      }
    })

    await scenario('interaction.editor-provider-owner-unload-event-abort-late', async () => {
      const fixture = await editorProviderFixture()
      const late = Promise.withResolvers()
      let eventContext
      let eventCalls = 0
      const provider = fixture.opened.editorProviders.register({
        id: 'packed.events',
        render: () => ({
          kind: 'stack',
          direction: 'column',
          children: [
            { node: { kind: 'actions', id: 'packed-actions', items: [{ id: 'go', label: 'Go' }] } },
            { node: { kind: 'text', content: 'packed event provider' } },
            { node: { kind: 'editor-control' } },
          ],
        }),
        onEvent(_event, context) {
          eventCalls += 1
          eventContext = context
          return late.promise
        },
      })
      let replayOwner
      try {
        ensure(provider.ok, 'FIXTURE_EDITOR_PROVIDER_EVENT_REGISTER', provider.ok ? '' : provider.message)
        fixture.render()
        fixture.select('packed.events')
        ensure(fixture.render().join('\n').includes('packed event provider'), 'FIXTURE_EDITOR_PROVIDER_EVENT_SELECTION', 'event provider did not activate')
        fixture.outer.handleInput('\t')
        fixture.outer.handleInput('\r')
        for (let turn = 0; turn < 8 && eventContext === undefined; turn += 1) await Promise.resolve()
        ensure(eventCalls === 1 && eventContext?.userGesture !== undefined && eventContext.signal.aborted === false, 'FIXTURE_EDITOR_PROVIDER_EVENT_CONTEXT', 'provider event did not receive one live owner-scoped context')

        const revisionBeforeUnload = ownerSnapshot(fixture.auditLease).editorProvidersRevision
        await fixture.ownerFiber.dispose()
        ensure(eventContext.signal.aborted && fixture.ctx.blueEditorHost.providers === undefined, 'FIXTURE_EDITOR_PROVIDER_EVENT_ABORT', 'owner unload did not abort the active provider event')
        ensure(!provider.value.refresh().ok, 'FIXTURE_EDITOR_PROVIDER_OWNER_GAP', 'provider refresh survived its owner gap')
        ensure(!fixture.render().join('\n').includes('packed event provider'), 'FIXTURE_EDITOR_PROVIDER_OWNER_FALLBACK', 'owner unload did not restore the default editor shell')
        late.resolve({ ok: true, value: undefined })
        await new Promise(resolveImmediate => setImmediate(resolveImmediate))
        ensure(!fixture.render().join('\n').includes('packed event provider') && ownerSnapshot(fixture.auditLease).editorProvidersRevision === revisionBeforeUnload, 'FIXTURE_EDITOR_PROVIDER_LATE_REJECTION', 'late provider event republished after owner unload')

        replayOwner = await fixture.ctx.plugin(editorProviderOwner)
        fixture.select('packed.events')
        ensure(fixture.render().join('\n').includes('packed event provider'), 'FIXTURE_EDITOR_PROVIDER_OWNER_REPLAY', 'owner reload did not replay the retained candidate and persisted selection')
        provider.value.dispose()
        ensure(!fixture.render().join('\n').includes('packed event provider'), 'FIXTURE_EDITOR_PROVIDER_CONSUMER_UNLOAD', 'provider consumer unload left its shell mounted')
      } finally {
        late.resolve({ ok: true, value: undefined })
        if (provider.ok) provider.value.dispose()
        await replayOwner?.dispose()
        await fixture.dispose()
      }
    })
    report.observations.push('interaction editor.extensions and editor.provider exercised through packed public host, editor runtime, owner, and bridge exports')
  }

  if (manifest.name === '@dsh-blue/blue-conversation' || manifest.name === '@dsh-blue/blue-transcript') {
    await scenario('conversation.registry-replay-live-checkpoint-restore-unload', async () => {
      const cordis = await load('@deepseek-ai/cordis')
      const llm = await load('@deepseek-ai/dsh-llm')
      const sessionRuntime = await load('@deepseek-ai/dsh-session')
      const projectionRuntime = await load('@deepseek-ai/dsh-session-projection')
      const ctx = new cordis.Context()
      await ctx.plugin(sessionRuntime.SessionStore)
      await ctx.plugin(projectionRuntime.SessionProjectionRegistry)
      const session = ctx.sessions.create(sessionRuntime.SessionId('packed-conversation'))
      session.append('turn/start', { turn: 0 })
      session.append('user/message', llm.createUserMessage({
        content: [{ type: 'text', text: 'packed replay' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      const fiber = await ctx.plugin(conversation)
      ensure(ctx.blueConversationProjection?.key === 'blueConversation', 'FIXTURE_CONVERSATION_CAPABILITY', 'conversation readiness capability was absent')
      ensure(ctx.sessionProjections.snapshot(session).values.blueConversation?.entries[0]?.text === 'packed replay', 'FIXTURE_CONVERSATION_REPLAY', 'conversation replay did not restore history')
      const changes = []
      const off = ctx.sessionProjections.onChanged((changedSession, key, _value, sequence) => {
        if (changedSession === session && key === 'blueConversation') changes.push(sequence)
      })
      session.append('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'packed live' } })
      ensure(changes.join() === '2', 'FIXTURE_CONVERSATION_LIVE', 'conversation live drive did not publish the next sequence')
      const checkpoint = ctx.sessionProjections.checkpoint(session)
      const floor = ctx.sessionProjections.restoreFloor(checkpoint)
      ensure(floor === 2, 'FIXTURE_CONVERSATION_CHECKPOINT', 'conversation checkpoint floor drifted')
      const restored = ctx.sessionProjections.restore(checkpoint, session.events.filter(row => row.seq >= floor), floor)
      ensure(JSON.stringify(restored.snapshot) === JSON.stringify(ctx.sessionProjections.snapshot(session)), 'FIXTURE_CONVERSATION_RESTORE', 'conversation checkpoint restore diverged')
      off()
      await fiber.dispose()
      ensure(ctx.get('blueConversationProjection') === undefined && ctx.sessionProjections.snapshot(session).values.blueConversation === undefined, 'FIXTURE_CONVERSATION_UNLOAD', 'conversation projection survived Fiber unload')
      await ctx.fiber.dispose()
    })

    await scenario('conversation.source-stale-malformed-and-inactive', async () => {
      let changed
      const baseline = { entries: [{ kind: 'assistant', id: 'assistant-1', seq: 1, turn: 0, step: 0, text: 'baseline', streaming: false }], streaming: false }
      const source = new officialTranscript.OfficialConversationModelSource({
        current: () => ({ asOfSeq: 4, value: baseline }),
        subscribe: listener => { changed = listener; return () => { changed = undefined } },
      }, { get: () => undefined }, () => undefined)
      source.attach(true)
      const live = { entries: [{ kind: 'assistant', id: 'assistant-2', seq: 5, turn: 0, step: 0, text: 'live', streaming: true }], streaming: true }
      changed?.('other', live, 5)
      changed?.('blueConversation', live, 4)
      changed?.('blueConversation', { entries: 'bad', streaming: false }, 5)
      ensure(source.snapshot().entries[0]?.text === 'baseline', 'FIXTURE_CONVERSATION_STALE', 'stale or malformed projection replaced the baseline')
      source.attach(false)
      changed?.('blueConversation', live, 5)
      ensure(source.snapshot().entries.length === 0, 'FIXTURE_CONVERSATION_INACTIVE', 'inactive source accepted a live projection')
      source.attach(true)
      changed?.('blueConversation', live, 5)
      ensure(source.snapshot().entries[0]?.text === 'live' && source.snapshot().streaming === true, 'FIXTURE_CONVERSATION_SEQUENCE', 'fresh conversation sequence was rejected')
      source.dispose()
    })

    await scenario('conversation.provider-unload-and-late-callback', async () => {
      let changed
      let unsubscribed = false
      const published = []
      const source = new officialTranscript.OfficialConversationModelSource({
        current: () => ({ asOfSeq: 0, value: { entries: [], streaming: false } }),
        subscribe: listener => { changed = listener; return () => { unsubscribed = true; changed = undefined } },
      }, { get: () => undefined }, model => published.push(model.entries.length))
      source.attach(true)
      const late = changed
      source.dispose()
      late?.('blueConversation', {
        entries: [{ kind: 'assistant', id: 'late', seq: 1, turn: 0, step: 0, text: 'late', streaming: false }],
        streaming: false,
      }, 1)
      ensure(unsubscribed && published.join() === '0' && source.snapshot().entries.length === 0, 'FIXTURE_CONVERSATION_LATE_CALLBACK', 'late projection callback survived provider unload')
    })

    await scenario('conversation.semantic-plain-width-20-40-80-120', async () => {
      const adversarial = '路径/非常长的目录/🙂🙂🙂/unbroken-supercalifragilisticexpialidocious\nsecond line'
      const semantic = transcriptModel.createTranscriptModel('packed-semantic', [
        { kind: 'transcript-user', id: 'user-1', seq: 1, turn: 0, text: adversarial, images: [] },
        { kind: 'transcript-assistant', id: 'assistant-1', seq: 2, turn: 0, step: 0, text: adversarial, streaming: false },
        { kind: 'transcript-error', id: 'error-1', seq: 3, turn: 0, message: adversarial },
      ], false)
      const component = new transcriptModel.TranscriptModelComponent(() => semantic, {
        components: compilerComponents,
        colors: themeDark.DARK_COLORS,
        images: () => ({}),
        requestRender: () => {},
        semantic: false,
      })
      for (const width of [20, 40, 80, 120]) {
        const semanticRows = component.render(width)
        const plainRows = renderNode({ kind: 'text', content: adversarial }, width)
        ensure(![...semanticRows, ...plainRows].some(row => core.visibleWidth(row) > width), 'FIXTURE_CONVERSATION_WIDTH', `conversation renderer exceeded width ${width}`)
      }
      component.dispose()
    })
  }

  if (manifest.name === '@dsh-blue/blue-transcript') {
    const cordis = await load('@deepseek-ai/cordis')
    const blueApi = await load('@dsh-blue/blue-api')
    const transcript = await load('@dsh-blue/blue-transcript')
    const statusProviderOwner = await load('@dsh-blue/blue-transcript/status-provider-owner')
    const themeDark = await load('@dsh-blue/blue-core/theme-dark')

    async function statusProviderFixture(selectedId = 'packed.custom') {
      const ctx = new cordis.Context()
      const bottom = []
      const screen = {
        columns: 80,
        rows: 24,
        requestRender() {},
        addBottomChild(component) {
          bottom.push(component)
          return () => {
            const index = bottom.indexOf(component)
            if (index >= 0) bottom.splice(index, 1)
          }
        },
      }
      const session = Object.freeze({ id: 'packed-session', cwd: '/packed', status: 'idle', mode: 'normal' })
      const sessionListeners = new Set()
      const sessionReader = {
        current: () => session,
        subscribe(listener) {
          sessionListeners.add(listener)
          listener(session)
          return { dispose: () => sessionListeners.delete(listener) }
        },
        request: async () => ({ ok: true, value: undefined }),
      }
      const projections = {
        current: () => undefined,
        subscribe: () => () => {},
        children: () => [],
        subscribeChildren: () => () => {},
      }
      ctx.reflect.provide('blueScreen', screen)
      ctx.reflect.provide('blueTheme', { colors: themeDark.DARK_COLORS })
      new core.BlueComponentsService(ctx, { theme: { colors: themeDark.DARK_COLORS }, tui: {} })
      ctx.reflect.provide('blueKeymap', { register: () => () => {} })
      ctx.reflect.provide('blueSessionReader', sessionReader)
      ctx.reflect.provide('blueSessionProjections', projections)
      let settingsValue = { statusProvider: selectedId }
      ctx.reflect.provide('settings', { get: namespace => namespace === 'blue' ? settingsValue : undefined })
      await ctx.plugin(blueApi)
      await ctx.plugin(transcript)
      const ownerFiber = await ctx.plugin(statusProviderOwner)
      ensure(bottom.length === 1, 'FIXTURE_STATUS_MOUNT', 'transcript did not mount one status composition')

      const cleanups = []
      const consumer = { effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup) } }
      const opened = ctx.bluePluginHost.open(consumer, {
        id: '@fixture/status-provider',
        api: '^1.0.0-beta.1',
        capabilities: ['status.provider'],
      })
      ensure(opened.ok, 'FIXTURE_STATUS_OPEN', opened.ok ? '' : opened.message)
      const disposeConsumer = () => {
        for (const cleanup of cleanups.splice(0)) cleanup()
      }
      return {
        ctx,
        bottom,
        opened: opened.value,
        ownerFiber,
        disposeConsumer,
        setSelection(id) {
          const previous = settingsValue
          settingsValue = { statusProvider: id }
          ctx.emit('settings/updated', 'blue', settingsValue, previous, 'fixture')
        },
        async dispose() {
          disposeConsumer()
          await ctx.fiber.dispose()
        },
      }
    }

    await scenario('transcript.status-provider-selection-refresh-inert', async () => {
      const fixture = await statusProviderFixture()
      let selectedRenders = 0
      let unselectedRenders = 0
      let content = 'packed one'
      let frozen = false
      const selected = fixture.opened.statusProviders.register({
        id: 'packed.custom',
        render(snapshot) {
          selectedRenders += 1
          frozen = Object.isFrozen(snapshot) && Object.isFrozen(snapshot.session) && Object.isFrozen(snapshot.entries)
          return { kind: 'text', content }
        },
      })
      const unselected = fixture.opened.statusProviders.register({
        id: 'packed.other',
        render() {
          unselectedRenders += 1
          return { kind: 'text', content: 'wrong provider' }
        },
      })
      ensure(selected.ok && unselected.ok, 'FIXTURE_STATUS_REGISTER', 'status provider registration failed')
      ensure(selectedRenders === 0 && unselectedRenders === 0, 'FIXTURE_STATUS_INERT', 'provider registration invoked a callback')
      const first = fixture.bottom[0].render(40)
      ensure(first.join('\n').includes('packed one') && selectedRenders === 1 && unselectedRenders === 0 && frozen, 'FIXTURE_STATUS_SELECTION', 'selected provider or frozen snapshot contract drifted')
      ensure(!first.some(row => core.visibleWidth(row) > 40), 'FIXTURE_STATUS_WIDTH', 'selected provider exceeded its gutter width')
      content = 'packed two'
      ensure(selected.value.refresh().ok, 'FIXTURE_STATUS_REFRESH', 'selected provider refresh was rejected')
      await Promise.resolve()
      const refreshed = fixture.bottom[0].render(40)
      ensure(refreshed.join('\n').includes('packed two') && selectedRenders === 2 && unselectedRenders === 0, 'FIXTURE_STATUS_REFRESH_RENDER', 'provider refresh did not atomically rebuild the selected status')
      await fixture.dispose()
    })

    await scenario('transcript.status-provider-fallback-unload-reload', async () => {
      const fixture = await statusProviderFixture('packed.bad')
      let badRenders = 0
      let goodRenders = 0
      const bad = fixture.opened.statusProviders.register({
        id: 'packed.bad',
        render() {
          badRenders += 1
          throw new Error('packed bad provider')
        },
      })
      const good = fixture.opened.statusProviders.register({
        id: 'packed.good',
        render() {
          goodRenders += 1
          return { kind: 'text', content: 'packed good' }
        },
      })
      ensure(bad.ok && good.ok, 'FIXTURE_STATUS_FALLBACK_REGISTER', 'fallback providers did not register')
      const fallbackRows = fixture.bottom[0].render(40)
      ensure(!fallbackRows.join('\n').includes('packed bad') && badRenders === 1 && goodRenders === 0 && !fallbackRows.some(row => core.visibleWidth(row) > 40), 'FIXTURE_STATUS_FALLBACK', 'failed selected provider did not use the default safely')
      fixture.setSelection('packed.good')
      ensure(fixture.bottom[0].render(40).join('\n').includes('packed good') && goodRenders === 1, 'FIXTURE_STATUS_SWITCH', 'settings selection did not activate the good provider')
      good.value.dispose()
      ensure(!fixture.bottom[0].render(40).join('\n').includes('packed good'), 'FIXTURE_STATUS_PROVIDER_UNLOAD', 'provider unload did not restore the default')
      let replacementContent = 'packed replacement'
      const replacement = fixture.opened.statusProviders.register({ id: 'packed.good', render: () => { goodRenders += 1; return { kind: 'text', content: replacementContent } } })
      ensure(replacement.ok && fixture.bottom[0].render(40).join('\n').includes('packed replacement'), 'FIXTURE_STATUS_PROVIDER_RELOAD', 'same-id provider generation did not reactivate')
      await fixture.ownerFiber.dispose()
      const beforeBufferedRefresh = goodRenders
      replacementContent = 'packed buffered refresh'
      ensure(replacement.value.refresh().ok, 'FIXTURE_STATUS_OWNER_GAP_REFRESH', 'durable host buffer rejected a provider refresh during the owner gap')
      await Promise.resolve()
      ensure(goodRenders === beforeBufferedRefresh && !fixture.bottom[0].render(40).join('\n').includes(replacementContent), 'FIXTURE_STATUS_OWNER_GAP_INERT', 'owner gap retained provider render or selection authority')
      const replacementOwner = await fixture.ctx.plugin(statusProviderOwner)
      ensure(fixture.bottom[0].render(40).join('\n').includes(replacementContent) && goodRenders === beforeBufferedRefresh + 1, 'FIXTURE_STATUS_OWNER_RELOAD', 'owner reload did not replay the buffered provider refresh and persisted selection')
      fixture.disposeConsumer()
      const beforeLateRefresh = goodRenders
      ensure(!replacement.value.refresh().ok && goodRenders === beforeLateRefresh && !fixture.bottom[0].render(40).join('\n').includes(replacementContent), 'FIXTURE_STATUS_CONSUMER_UNLOAD', 'consumer unload left its provider generation or refresh handle active')
      await replacementOwner.dispose()
      await fixture.dispose()
    })
  }

  if (manifest.name === '@dsh-blue/blue-openpencil') {
    const openpencil = await load('@dsh-blue/blue-openpencil')
    await scenario('openpencil.presentation-fallback-and-meta-elision', async () => {
      const models = new Map()
      const notes = new Map()
      const presentation = { presentCall: () => ({ card: 'generic', title: 'Render fixture.op' }), presentResult: (_args, outcome) => {
        ensure(!Object.hasOwn(outcome, 'meta'), 'FIXTURE_OPENPENCIL_META', 'signed presentation meta reached the Blue adapter')
        return { card: 'diff', title: 'Fixture', diffs: [{ path: 'fixture.op', oldText: '{}', newText: '{"ok":true}' }] }
      } }
      const adapterInstance = new openpencil.OpenPencilAdapter({
        tools: { register: model => { models.set(model.id, model); return () => models.delete(model.id) } },
        notifications: { push: model => { notes.set(model.id, model); return () => notes.delete(model.id) } },
      })
      const execution = { callId: 'packed-openpencil', rootCallId: 'packed-openpencil', name: 'openpencil_render', arguments: { path: 'fixture.op' }, signal: new AbortController().signal }
      adapterInstance.observe({ get: () => presentation }, execution, { isError: false, value: { ok: true }, content: [{ type: 'text', text: 'rendered' }], meta: { embeddedGrant: 'must-not-leak' } })
      const model = models.get('packed-openpencil')
      ensure(model?.result?.kind === 'sections' && !JSON.stringify(model).includes('must-not-leak'), 'FIXTURE_OPENPENCIL_PRESENTATION', 'OpenPencil diff fallback or meta elision failed')
      for (const width of [20, 40, 80, 120]) {
        for (const node of [model.call, model.result]) {
          const rows = renderNode(node, width)
          ensure(!rows.some(row => core.visibleWidth(row) > width), 'FIXTURE_OPENPENCIL_WIDTH', `OpenPencil node exceeded width ${width}`)
        }
      }
      adapterInstance.dispose()
      ensure(models.size === 0 && notes.size === 0, 'FIXTURE_OPENPENCIL_MODEL_UNLOAD', 'OpenPencil presentation survived unload')
    })
    await scenario('openpencil.dedupe-retention-unload', async () => {
      const models = new Map()
      const notes = new Map()
      let listener
      const source = { get: () => undefined, onResult: next => { listener = next; return () => { listener = undefined } } }
      const adapterInstance = new openpencil.OpenPencilAdapter({
        tools: { register: model => { models.set(model.id, model); return () => models.delete(model.id) } },
        notifications: { push: model => { notes.set(model.id, model); return () => notes.delete(model.id) } },
      }, { retention: 1 })
      const emit = (callId, isError = false) => listener?.({ callId, rootCallId: callId, name: 'openpencil_create', arguments: {}, signal: new AbortController().signal }, isError
        ? { isError: true, error: { code: 'FAILED', message: 'failed' }, content: [{ type: 'text', text: 'failed' }] }
        : { isError: false, value: { ok: true }, content: [{ type: 'text', text: 'ok' }] })
      adapterInstance.start(source)
      emit('one', true)
      emit('one', true)
      emit('two')
      ensure([...models.keys()].join() === 'two' && notes.size === 0, 'FIXTURE_OPENPENCIL_RETENTION', 'OpenPencil duplicate or retention contract drifted')
      const late = listener
      adapterInstance.dispose()
      late?.({ callId: 'late', rootCallId: 'late', name: 'openpencil_create', arguments: {}, signal: new AbortController().signal }, { isError: false, value: {}, content: [] })
      ensure(models.size === 0 && notes.size === 0, 'FIXTURE_OPENPENCIL_LATE_EVENT', 'OpenPencil late result survived unload')
    })
  }
  if (manifest.name === '@dsh-blue/blue-lark') {
    const lark = await load('@dsh-blue/blue-lark')
    await scenario('lark.command-notification-retry', async () => {
      const notes = new Map()
      let calls = 0
      const client = new lark.LarkSettingsClient('http://127.0.0.1:1', async (_input, init) => {
        calls += 1
        const value = init?.method === 'POST'
          ? { revision: 2, credential: { configured: true }, runtime: { state: 'connected' } }
          : { revision: 1, credential: { configured: false }, runtime: { state: 'unconfigured' } }
        return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
      })
      const adapterInstance = new lark.LarkAdapter(client, { push: model => { notes.set(model.id, model); return () => notes.delete(model.id) } })
      const operation = adapterInstance.execute('packed-lark', 'retry')
      const duplicate = adapterInstance.execute('packed-lark', 'status')
      ensure(operation === duplicate, 'FIXTURE_LARK_DEDUPE', 'Lark operation id was not deduplicated')
      const result = await operation
      ensure(result.kind === 'success' && calls === 2 && notes.get('lark.operation.packed-lark')?.severity === 'success', 'FIXTURE_LARK_RETRY', 'Lark retry state did not settle successfully')
      adapterInstance.dispose()
    })
    await scenario('lark.route-absent-abort-unload', async () => {
      const notes = new Map()
      const sink = { push: model => { notes.set(model.id, model); return () => notes.delete(model.id) } }
      const absent = new lark.LarkAdapter(new lark.LarkSettingsClient(), sink)
      const absentResult = await absent.execute('absent', 'status')
      ensure(absentResult.kind === 'error' && notes.get('lark.operation.absent')?.severity === 'warning', 'FIXTURE_LARK_ROUTE_ABSENT', 'Lark route absence did not use the plain fallback')
      absent.dispose()
      let settle
      const delayed = new lark.LarkAdapter(new lark.LarkSettingsClient('http://127.0.0.1:1', (_input, init) => new Promise((resolveResponse, rejectResponse) => {
        settle = resolveResponse
        init?.signal?.addEventListener('abort', () => rejectResponse(new Error('aborted')), { once: true })
      })), sink)
      const late = delayed.execute('late', 'status')
      delayed.dispose()
      settle?.(new Response(JSON.stringify({ revision: 1, runtime: { state: 'connected' } }), { status: 200 }))
      const lateResult = await late
      ensure(lateResult.kind === 'error' && notes.size === 0, 'FIXTURE_LARK_LATE_RESULT', 'Lark late result survived unload')
    })
  }

  report.observations.push(`installed ${packages.size} local tarballs`, 'all imports resolved through installed package exports')
} catch (error) {
  failure('fixture.setup', error, 'FIXTURE_SETUP_FAILED')
}

try {
  await compilerContext?.fiber.dispose()
} catch (error) {
  failure('fixture.compiler-cleanup', error, 'FIXTURE_COMPILER_CLEANUP_FAILED')
}

await finish()
