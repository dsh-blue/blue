#!/usr/bin/env node
/**
 * Real dsh-context integration fixture. Loads the upstream host plugin, the
 * published Harness projection/token-meter services, and Blue's built context
 * adapter in one Cordis tree. No upstream implementation is copied here.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const pathIndex = argv.indexOf('--upstream')
const upstream = resolve(pathIndex >= 0 ? argv[pathIndex + 1] ?? '' : process.env.DSH_CONTEXT_DIR ?? '')
if (upstream === root || !existsSync(join(upstream, 'package.json'))) {
  throw new Error('pass --upstream <dsh-context checkout> or set DSH_CONTEXT_DIR')
}
if (argv.includes('--prepare')) {
  execFileSync('pnpm', ['install', '--config.confirmModulesPurge=false'], { cwd: upstream, stdio: 'inherit' })
  execFileSync('pnpm', ['run', 'build'], { cwd: upstream, stdio: 'inherit' })
}

const upstreamManifest = JSON.parse(readFileSync(join(upstream, 'package.json'), 'utf8'))
const upstreamEntry = join(upstream, upstreamManifest.main ?? 'lib/index.js')
if (!existsSync(upstreamEntry)) throw new Error(`dsh-context build missing at ${upstreamEntry}; rerun with --prepare`)

const requireFromBundle = createRequire(join(root, 'packages/bundle/blue/package.json'))
const requireFromInteraction = createRequire(join(root, 'packages/interaction/package.json'))
const load = async (name, resolver = requireFromBundle) => import(pathToFileURL(resolver.resolve(name)).href)
const [{ Context }, sessionModule, projectionModule, tokenMeterModule, llmModule, upstreamModule, blueContext] = await Promise.all([
  load('@deepseek-ai/cordis'),
  load('@deepseek-ai/dsh-session', requireFromInteraction),
  load('@deepseek-ai/dsh-session-projection'),
  load('@deepseek-ai/dsh-token-meter'),
  load('@deepseek-ai/dsh-llm', requireFromInteraction),
  import(pathToFileURL(upstreamEntry).href),
  import(pathToFileURL(join(root, 'packages/context/lib/index.js')).href),
])

const ctx = new Context()
await ctx.plugin(sessionModule.default)
await ctx.plugin(projectionModule.SessionProjectionRegistry)
await ctx.plugin(tokenMeterModule.default)
const domainFiber = await ctx.plugin(upstreamModule)

const session = ctx.sessions.create(sessionModule.SessionId('blue-context-upstream-fixture'))
session.append('request/header', {
  reason: 'initial',
  header: { system: 'You are a context fixture.', config: { provider: 'mock', model: 'mock' } },
})
session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 8192 })
session.append('turn/start', { turn: 1 })
session.append('step/start', { turn: 1, step: 1 })
session.append('user/message', llmModule.createUserMessage({ content: [{ type: 'text', text: '你好, inspect the official context timeline.' }], source: { kind: 'human' } }), { surfaceOp: 'append' })
session.append('assistant/message', {
  turn: 1,
  step: 1,
  message: llmModule.createAssistantMessage({ content: [{ type: 'text', text: 'official projection ready' }], source: { provider: 'mock', model: 'mock' } }),
  usage: { inputTokens: 128, outputTokens: 16, cacheReadTokens: 32, cacheWriteTokens: 4 },
}, { surfaceOp: 'append' })
session.append('step/end', { turn: 1, step: 1 })
session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

const official = ctx.sessionProjections.snapshot(session)
for (const key of ['contextTimeline', 'contextPressure', 'contextBreakdown', 'tokenUsage']) {
  if (!(key in official.values)) throw new Error(`official projection ${key} is absent`)
}

const source = new blueContext.OfficialContextSource(ctx.sessionProjections, id => id === String(session.id) ? session : undefined)
const feature = new blueContext.ContextFeature(source)
const attached = await feature.attach(String(session.id))
if (!attached.ok || feature.snapshot?.facts.timeline === undefined) throw new Error('Blue did not consume contextTimeline')
if (feature.snapshot.facts.input !== 128 || feature.snapshot.facts.cacheRead !== 32) throw new Error('Blue tokenUsage mapping drifted')
const baseline = feature.snapshot.watermark

session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 16384 })
await new Promise(resolve => setImmediate(resolve))
if ((feature.snapshot?.watermark ?? -1) <= baseline || feature.snapshot?.facts.window !== 16384) throw new Error('live projection push did not advance')

await domainFiber.dispose()
session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 32768 })
await new Promise(resolve => setImmediate(resolve))
if (feature.snapshot?.facts.timeline !== undefined) throw new Error('unloaded contextTimeline remained in the Blue model')
if (feature.model?.status.capabilities.includes('context.timeline')) throw new Error('unloaded timeline capability remained advertised')

const beforeDispose = feature.snapshot?.watermark
feature.dispose()
session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 65536 })
await new Promise(resolve => setImmediate(resolve))
if (feature.snapshot !== undefined) throw new Error('disposed feature retained a snapshot')
await ctx.fiber.dispose()

let commit = 'unknown'
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim() } catch {}
console.log(JSON.stringify({
  upstream: { name: upstreamManifest.name, version: upstreamManifest.version, commit },
  harness: { projection: projectionModule.SessionProjectionRegistry.name, tokenMeter: tokenMeterModule.default.name },
  scenarios: ['official four-key baseline', 'live seq push', 'domain unload clears timeline', 'Blue unload drops late push'],
  baseline,
  beforeDispose,
}, null, 2))
