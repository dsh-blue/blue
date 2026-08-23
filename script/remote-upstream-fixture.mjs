#!/usr/bin/env node
/**
 * Real dsh-remote integration fixture. Boots the upstream authenticated daemon
 * over a Unix socket and drives Blue through the documented structural
 * DshRemoteConnection surface.
 */

import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const pathIndex = argv.indexOf('--upstream')
const upstream = resolve(pathIndex >= 0 ? argv[pathIndex + 1] ?? '' : process.env.DSH_REMOTE_DIR ?? '')
if (upstream === root || !existsSync(join(upstream, 'package.json'))) {
  throw new Error('pass --upstream <dsh-remote-core checkout> or set DSH_REMOTE_DIR')
}
if (argv.includes('--prepare')) {
  execFileSync('pnpm', ['install', '--config.confirmModulesPurge=false'], { cwd: upstream, stdio: 'inherit' })
  execFileSync('pnpm', ['run', 'build'], { cwd: upstream, stdio: 'inherit' })
}

const required = [
  'packages/backend/dist/server.js',
  'packages/backend/dist/state.js',
  'packages/daemon/dist/backend.js',
  'packages/protocol/dist/index.js',
  'packages/ssh/dist/connection.js',
  'packages/ssh/dist/connect.js',
  'packages/compat-rc6/dist/policy.js',
]
for (const path of required) {
  if (!existsSync(join(upstream, path))) throw new Error(`upstream build missing ${path}; rerun with --prepare`)
}
if (!existsSync(join(root, 'packages/remote/lib/index.js'))) throw new Error('Blue remote build is missing; run pnpm run build')

const load = path => import(pathToFileURL(join(upstream, path)).href)
const [backendModule, stateModule, daemonModule, protocolModule, connectionModule, connectModule, policyModule, blueRemote] = await Promise.all([
  load('packages/backend/dist/server.js'),
  load('packages/backend/dist/state.js'),
  load('packages/daemon/dist/backend.js'),
  load('packages/protocol/dist/index.js'),
  load('packages/ssh/dist/connection.js'),
  load('packages/ssh/dist/connect.js'),
  load('packages/compat-rc6/dist/policy.js'),
  import(pathToFileURL(join(root, 'packages/remote/lib/index.js')).href),
])

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
  throw new Error(message)
}

class Broadcast {
  queues = new Set()

  publish(value) {
    for (const queue of this.queues) queue.push(value)
  }

  async *open(signal) {
    const values = []
    let wake
    const queue = { push(value) { values.push(value); wake?.(); wake = undefined } }
    this.queues.add(queue)
    const abort = () => { wake?.(); wake = undefined }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      while (!signal?.aborted) {
        if (values.length === 0) await new Promise(resolveWake => { wake = resolveWake })
        const value = values.shift()
        if (value !== undefined) yield value
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      this.queues.delete(queue)
    }
  }
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'blue-remote-upstream-'))
let server
let disposeBridge = () => undefined
const transports = []
try {
  const store = new stateModule.StateStore(join(fixtureRoot, 'state'))
  const state = await store.initialize({ allowedRoots: [fixtureRoot] })
  const backend = new backendModule.RemoteBackendServer(store)
  const mux = new Broadcast()
  const host = new Broadcast()
  const responses = []
  const mutations = []
  const summaries = new Map([
    ['session-one', { sessionId: 'session-one', updatedAt: 1, running: false, blank: false, cwd: join(fixtureRoot, 'one'), projections: { asOfSeq: 3, values: {} } }],
    ['session-two', { sessionId: 'session-two', updatedAt: 2, running: false, blank: false, cwd: join(fixtureRoot, 'two'), projections: { asOfSeq: 5, values: {} } }],
  ])
  const histories = new Map([
    ['session-one', [{ event: { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } } } }]],
    ['session-two', [{ event: { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } } }]],
  ])
  const success = (request, value) => ({ rpcId: request.rpcId, result: { ok: true, value } })
  const apiProxy = {
    sessions: {
      list: async request => success(request, { items: [...summaries.values()] }),
      history: async request => {
        const sessionId = request.payload.sessionId
        return success(request, { events: histories.get(sessionId) ?? [], hasMore: false, projections: summaries.get(sessionId)?.projections })
      },
      prompt: async request => {
        mutations.push({ method: 'session.prompt', payload: request.payload })
        const summary = summaries.get(request.payload.sessionId)
        if (summary !== undefined) summary.running = true
        return success(request, { accepted: true })
      },
      cancel: async request => {
        mutations.push({ method: 'session.cancel', payload: request.payload })
        const summary = summaries.get(request.payload.sessionId)
        if (summary !== undefined) summary.running = false
        return success(request, { accepted: true })
      },
    },
    events: {
      mux: (_request, signal) => mux.open(signal),
      host: (_request, signal) => host.open(signal),
    },
    respond: async message => { responses.push(message); return { accepted: true } },
  }
  const connectionHost = { createSharedFetchHandler: (_channel, fallback) => fallback }
  disposeBridge = await daemonModule.apply({ remoteBackend: backend, apiProxy, connection: connectionHost })
  server = await backend.listen()

  async function lowLevel(clientId, instanceId) {
    const transport = await connectModule.connectLocalSocket(server.socketPath)
    transports.push(transport)
    const connection = new connectionModule.RemoteConnection(transport.rpc, {
      clientId,
      label: clientId,
      ...protocolModule.generateIdentity(),
    }, instanceId)
    const code = await store.issuePairingCode()
    await connection.pair(code.code, state.server.fingerprint)
    await connection.authenticate(state.server.fingerprint)
    return connection
  }

  const low = await lowLevel('blue-primary', 'frontend-blue-primary')
  const contract = await low.negotiate({ bridge: { major: 2, minMinor: 0, maxMinor: 0 }, acceptedAbis: [policyModule.DSH_RC6_ABI] })
  const leases = new Map()
  const writer = async sessionId => {
    const existing = leases.get(sessionId)
    if (existing !== undefined) return existing
    const lease = await low.acquireWriter(sessionId)
    leases.set(sessionId, lease)
    return lease
  }
  const hostCarrier = {
    async fetch(request, options = {}) {
      if (options.authorization === undefined) throw new Error('fixture connection requires explicit authorization')
      const payload = {
        path: request.path,
        method: request.method,
        headers: request.headers ?? [],
        ...(request.body === undefined ? {} : { body: Buffer.from(request.body).toString('base64') }),
      }
      const sessionId = options.authorization.kind === 'host-write'
        ? '@host'
        : options.authorization.kind === 'session-write'
          ? options.authorization.sessionId
          : undefined
      const response = sessionId === undefined
        ? await low.read('host.fetch.read', payload, options)
        : await low.write('host.fetch.write', { ...payload, leaseSessionId: sessionId }, await writer(sessionId), options)
      return { status: response.status, headers: response.headers, body: Buffer.from(response.body, 'base64') }
    },
    async subscribe(kind, signal) {
      const subscription = await low.subscribe('host.events.open', 'host.events.cancel', { kind }, signal)
      return {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of subscription) yield Buffer.from(chunk.data, 'base64')
        },
      }
    },
  }
  const officialConnection = {
    contract,
    host: hostCarrier,
    agents: {
      async invoke(action, payload, options) {
        const rpcId = randomUUID()
        const response = await hostCarrier.fetch({
          path: `/api/${action}`,
          method: 'POST',
          headers: [['content-type', 'application/json']],
          body: Buffer.from(JSON.stringify({ type: 'client-request', rpcId, method: action, payload })),
        }, options)
        const envelope = JSON.parse(Buffer.from(response.body).toString('utf8'))
        if (response.status < 200 || response.status >= 300 || envelope.rpcId !== rpcId || !envelope.result?.ok) {
          throw new Error(envelope.result?.error?.message ?? `remote action returned HTTP ${response.status}`)
        }
        return envelope.result.value
      },
    },
    async attach(sessionId, access) {
      if (access === 'write') await writer(sessionId)
      let released = false
      return {
        async release() {
          if (released || access === 'read') return
          released = true
          const lease = leases.get(sessionId)
          if (lease === undefined) return
          leases.delete(sessionId)
          await low.releaseWriter(lease)
        },
      }
    },
  }

  const wire = blueRemote.createDshRemoteWireClient(officialConnection)
  const remote = new blueRemote.DshRemoteTransport(wire)
  const capabilities = await remote.negotiate(new AbortController().signal)
  for (const capability of ['session', 'projection', 'action', 'question', 'approval', 'writeLease']) {
    if (!capabilities.capabilities.includes(capability)) throw new Error(`Blue did not map remote capability ${capability}`)
  }

  const one = await remote.snapshot('session-one', new AbortController().signal)
  const two = await remote.snapshot('session-two', new AbortController().signal)
  if (one.watermark !== 3 || two.watermark !== 5 || one.value.cwd !== join(fixtureRoot, 'one')) throw new Error('two-session baseline drifted')
  const seenOne = []
  const seenTwo = []
  const offOne = remote.subscribe('session-one', one.watermark, event => seenOne.push(event.seq))
  const offTwo = remote.subscribe('session-two', two.watermark, event => seenTwo.push(event.seq))
  mux.publish({ rpcId: 'mux-one-4', payload: { type: 'session/event', sessionId: 'session-one', event: { type: 'turn/start', seq: 4, time: 4, data: { turn: 2 } } } })
  mux.publish({ rpcId: 'mux-two-6', payload: { type: 'session/event', sessionId: 'session-two', event: { type: 'turn/start', seq: 6, time: 6, data: { turn: 2 } } } })
  await waitFor(() => seenOne.join() === '4' && seenTwo.join() === '6', `multi-session event routing drifted: ${seenOne.join()} / ${seenTwo.join()}`)

  await remote.request('session-one', { kind: 'followup', text: 'remote prompt' }, new AbortController().signal)
  await remote.request('session-one', { kind: 'interrupt' }, new AbortController().signal)
  if (mutations.map(item => item.method).join(',') !== 'session.prompt,session.cancel') throw new Error('official action carrier drifted')

  const contender = await lowLevel('blue-contender', 'frontend-blue-contender')
  await contender.negotiate({ bridge: { major: 2, minMinor: 0, maxMinor: 0 }, acceptedAbis: [policyModule.DSH_RC6_ABI] })
  let contended = false
  try { await contender.acquireWriter('session-one') } catch (error) { contended = error?.code === 'LEASE_HELD' }
  if (!contended) throw new Error('writer lease contention was not fenced')

  await remote.ask('session-one', { rpcId: 'question-1', answer: { answers: [{ id: 'q1', selected: ['yes'] }] } }, new AbortController().signal)
  await remote.approve('session-one', { rpcId: 'approval-rpc-1', approvalId: 'approval-1', outcome: 'allowed-once' }, new AbortController().signal)
  if (responses.length !== 2 || responses[0]?.type !== 'client-response' || responses[1]?.result?.value?.outcome !== 'allowed-once') throw new Error('question/approval response carrier drifted')

  offOne()
  remote.detach('session-one')
  await new Promise(resolve => setImmediate(resolve))
  const contenderLease = await contender.acquireWriter('session-one')
  await contender.releaseWriter(contenderLease)
  mux.publish({ rpcId: 'late-one-7', payload: { type: 'session/event', sessionId: 'session-one', event: { type: 'turn/end', seq: 7, time: 7, data: { turn: 2, reason: { kind: 'completed' } } } } })
  await new Promise(resolve => setImmediate(resolve))
  if (seenOne.join() !== '4') throw new Error('late event survived detach')

  offTwo()
  remote.detach('session-two')
  remote.dispose()

  let commit = 'unknown'
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() } catch {}
  const manifest = JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8'))
  console.log(JSON.stringify({
    upstream: { name: manifest.name, commit, abi: contract.abi },
    protocol: contract.bridge,
    scenarios: [
      'Unix socket pairing/authentication/negotiation',
      'two-session baseline and live routing',
      'prompt and cancel with explicit authorization',
      'writer lease contention and release',
      'question and approval client-response carriers',
      'detach drops late events and releases leases',
    ],
  }, null, 2))
} finally {
  disposeBridge()
  for (const transport of transports) transport.close()
  if (server !== undefined) await server.close()
  await rm(fixtureRoot, { recursive: true, force: true })
}
