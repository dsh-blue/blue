#!/usr/bin/env node
/**
 * Build an independent local-tarball fixture and execute shared runtime
 * contract scenarios. Workspace peers are packed into the same fixture so an
 * unpublished package never falls through to the public registry.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const packageDir = resolve(process.argv.slice(2).find(value => value !== '--' && value !== '--install') ?? '.')
const install = process.argv.includes('--install')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const fixtureRoot = await mkdtemp(join(tmpdir(), 'blue-plugin-fixture-'))
const tarballRoot = join(fixtureRoot, 'tarballs')
mkdirSync(tarballRoot, { recursive: true })

const workspacePackages = new Map()
for (const group of ['api', 'frontend', 'harness-adapter', 'context', 'remote', 'core', 'interaction', 'transcript', 'app']) {
  const directory = join(root, 'packages', group)
  const file = join(directory, 'package.json')
  if (existsSync(file)) {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    workspacePackages.set(value.name, directory)
  }
}

function localClosure() {
  const names = new Set([manifest.name])
  const queue = [manifest.name]
  while (queue.length > 0) {
    const name = queue.shift()
    const directory = workspacePackages.get(name)
    if (directory === undefined) continue
    const value = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    for (const dependencyName of Object.keys({ ...value.dependencies, ...value.peerDependencies, ...value.devDependencies })) {
      if (!workspacePackages.has(dependencyName) || names.has(dependencyName)) continue
      names.add(dependencyName)
      queue.push(dependencyName)
    }
  }
  for (const name of ['@dsh-blue/blue-api', '@dsh-blue/blue-frontend', '@dsh-blue/blue-harness-adapter', '@dsh-blue/blue-context', '@dsh-blue/blue-remote', '@dsh-blue/blue-core']) {
    if (workspacePackages.has(name)) names.add(name)
  }
  return [...names]
}

function pack(directory) {
  const before = new Set(readdirSync(tarballRoot))
  execFileSync('pnpm', ['pack', '--pack-destination', tarballRoot], { cwd: directory, stdio: 'ignore' })
  const created = readdirSync(tarballRoot).find(name => name.endsWith('.tgz') && !before.has(name))
  if (created === undefined) throw new Error(`no tarball produced for ${directory}`)
  return join(tarballRoot, created)
}

const packages = new Map()
for (const name of localClosure()) packages.set(name, pack(workspacePackages.get(name)))
const dependencies = Object.fromEntries([...packages].map(([name, tarball]) => [name, `file:${tarball}`]))
writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }, null, 2))
if (install) execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: fixtureRoot, stdio: 'inherit' })

const imported = new Map()
async function load(name) {
  if (imported.has(name)) return imported.get(name)
  const value = JSON.parse(readFileSync(join(workspacePackages.get(name), 'package.json'), 'utf8'))
  const entry = typeof value.exports?.['.'] === 'object' ? value.exports['.'].default : value.exports?.['.'] ?? value.main
  const modulePath = join(fixtureRoot, 'node_modules', name, entry.replace(/^\.\//, ''))
  if (!existsSync(modulePath)) throw new Error(`built entry missing for ${name}: ${entry}; run pnpm run build first`)
  const module = await import(pathToFileURL(modulePath).href)
  imported.set(name, module)
  return module
}

const executed = []
const observations = []
const frontend = await load('@dsh-blue/blue-frontend')
const adapter = await load('@dsh-blue/blue-harness-adapter')
const core = await load('@dsh-blue/blue-core')
const context = await load('@dsh-blue/blue-context')
const remote = await load('@dsh-blue/blue-remote')

const host = new frontend.FrontendHost()
let latePublish
await host.activateInitial({ id: 'fixture-provider', activate: ctx => ctx.publish({ providerId: 'fixture-provider', capabilities: [], views: [{ kind: 'text', text: 'ready' }] }) })
await host.swap({ id: 'fixture-failing-provider', activate: () => { throw new Error('fixture failure') } })
if (host.snapshot.providerId !== 'plain') throw new Error('provider failure did not fall back to plain')
await host.activateInitial({ id: 'fixture-late-provider', activate: ctx => { latePublish = () => ctx.publish({ providerId: 'fixture-late-provider', capabilities: [], views: [{ kind: 'text', text: 'late' }] }); ctx.publish({ providerId: 'fixture-late-provider', capabilities: [], views: [] }) } })
await host.unload()
latePublish?.()
if (host.snapshot.providerId !== 'plain') throw new Error('late publish survived unload')
executed.push('provider swap and plain fallback', 'unload followed by late event')

const coordinator = new adapter.ActionCoordinator()
const stale = coordinator.execute('main', async () => 'late')
coordinator.switchSession()
const staleResult = await stale
if (staleResult.ok || staleResult.code !== 'BLUE_ACTION_REJECTED') throw new Error('stale action was accepted')
const abortController = new AbortController()
const aborted = coordinator.execute('main', async ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve('aborted'), { once: true })), { signal: abortController.signal })
abortController.abort()
const abortResult = await aborted
if (abortResult.ok || abortResult.code !== 'BLUE_ABORTED') throw new Error('aborted action was not rejected')
coordinator.dispose()
executed.push('action abort and stale-result rejection')

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
if (feature.snapshot?.facts.input !== 14) throw new Error('context duplicate sequence was applied')
const refreshResult = await feature.execute({ kind: 'context.refresh', sessionId: 's1' })
if (!refreshResult.ok || refreshCount !== 1) throw new Error('context refresh action did not call domain source')
feature.detach()
contextListener?.({ sessionId: 's1', seq: 4, event: { type: 'pressure', projectedTokens: 99 } })
feature.dispose()
executed.push('headless projection replay/resume')

let officialChanged
let officialSeq = 7
let officialValues = {
  tokenUsage: { uncachedInputTokens: 32, outputTokens: 4, cacheReadTokens: 8, cacheWriteTokens: 1 },
  contextPressure: { projectedTokens: 48, contextWindow: 1024 },
  contextBreakdown: { systemTokens: 2, toolsTokens: 3, messageTokens: 40 },
  contextTimeline: { current: { system: 2, tools: 3, user: 10, inject: 0, assistant: 20, tool: 5, total: 40 }, requests: [{ turn: 1, step: 1, time: 1, seq: 6, total: 40 }], events: [], droppedNodes: 0, images: 0 },
}
const sessionHandle = {}
const officialSource = new context.OfficialContextSource({
  snapshot: () => ({ asOfSeq: officialSeq, values: officialValues }),
  onChanged: listener => { officialChanged = listener; return () => { officialChanged = undefined } },
}, sessionId => sessionId === 'official' ? sessionHandle : undefined)
const officialFeature = new context.ContextFeature(officialSource)
await officialFeature.attach('official')
if (officialFeature.snapshot?.facts.timeline?.requests.length !== 1 || officialFeature.snapshot.facts.input !== 32) throw new Error('official context projection baseline drifted')
officialSeq = 8
officialValues = { ...officialValues }
delete officialValues.contextTimeline
officialChanged?.(sessionHandle, 'tokenUsage', officialValues.tokenUsage, officialSeq)
await new Promise(resolve => setImmediate(resolve))
if (officialFeature.snapshot?.facts.timeline !== undefined) throw new Error('official context projection unload stayed stale')
officialFeature.dispose()
executed.push('official session-projection baseline/push/unload')

let remoteListener
let remoteDetached = false
let remoteDisposed = false
let remoteLeaseReleased = false
const remoteActions = []
const remoteTransport = {
  negotiate: async () => ({ protocol: 'fixture-v2', capabilities: ['session', 'action', 'projection', 'question', 'approval', 'writeLease'] }),
  snapshot: async sessionId => ({ watermark: 4, value: { id: sessionId, cwd: '/remote', status: 'idle', mode: 'normal' } }),
  subscribe: (_sessionId, _watermark, listener) => { remoteListener = listener; return () => { remoteListener = undefined } },
  request: async (_sessionId, action) => { remoteActions.push(action.kind) },
  acquireWriteLease: async sessionId => ({ token: `fixture:${sessionId}`, expiresAt: 100 }),
  releaseWriteLease: async () => { remoteLeaseReleased = true },
  ask: async (_sessionId, question) => question.answer,
  approve: async (_sessionId, question) => question.outcome,
  detach: () => { remoteDetached = true },
  dispose: () => { remoteDisposed = true },
}
const remoteAdapter = new remote.RemoteSessionAdapter(remoteTransport)
const remoteConnected = await remoteAdapter.connect('remote-one')
if (!remoteConnected.ok || remoteAdapter.protocol !== 'fixture-v2') throw new Error('independent remote connect failed')
const remoteSeen = []
remoteAdapter.subscribe(4, event => remoteSeen.push(event.seq))
remoteListener?.({ sessionId: 'remote-one', seq: 5, event: { id: 'remote-one', cwd: '/remote/live', status: 'running', mode: 'normal' } })
await remoteAdapter.request({ kind: 'followup', text: 'hello' }, new AbortController().signal)
const remoteLease = await remoteAdapter.acquireWriteLease()
if (!remoteLease.ok) throw new Error('independent remote lease failed')
await remoteAdapter.releaseWriteLease()
const remoteQuestions = remoteAdapter.questionSource()
if (await remoteQuestions?.ask({ answer: 'answered' }, new AbortController().signal) !== 'answered') throw new Error('independent remote question failed')
if (await remoteQuestions?.approve({ outcome: 'allowed-once' }, new AbortController().signal) !== 'allowed-once') throw new Error('independent remote approval failed')
const lateRemote = remoteListener
remoteAdapter.disconnect()
lateRemote?.({ sessionId: 'remote-one', seq: 6, event: { id: 'remote-one', cwd: '/late', status: 'idle', mode: 'normal' } })
remoteAdapter.dispose()
await new Promise(resolve => setImmediate(resolve))
if (remoteSeen.join() !== '5' || remoteActions.join() !== 'followup' || !remoteLeaseReleased || !remoteDetached || !remoteDisposed) throw new Error('independent remote unload contract drifted')
executed.push('remote resume/action/lease/question/unload')

const model = context.buildContextModel({ sessionId: 's1', watermark: 3, facts: { input: 123456, output: 7890, cacheRead: 42, cacheWrite: 8, used: 120, window: 1000, breakdown: { system: 1, tools: 2, messages: 3 } } })
const views = [...model.panel.view ? [model.panel.view] : [], ...model.status.views]
for (const width of [20, 40, 80, 120]) {
  for (const view of views) {
    const rows = core.renderFrontendView(view, width)
    if (rows.some(row => core.visibleWidth?.(row) > width)) throw new Error(`frontend renderer exceeded width ${width}`)
  }
}
executed.push('width scan 20/40/80/120')
observations.push(`installed ${packages.size} local tarballs`, 'provider/action/projection/renderer contracts executed')
console.log(JSON.stringify({ package: manifest.name, fixtureRoot, installed: install, independentInstall: existsSync(join(fixtureRoot, 'node_modules')), scenarios: ['headless projection replay/resume', 'official session-projection baseline/push/unload', 'remote resume/action/lease/question/unload', 'action abort and stale-result rejection', 'provider swap and plain fallback', 'width scan 20/40/80/120', 'unload followed by late event'], executed, observations }, null, 2))
