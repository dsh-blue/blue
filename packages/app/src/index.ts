/**
 * @dsh-blue/blue-app — the Blue terminal UI application driver. The
 * bundle patch rides over dsh-base; the startup provider parses the launch
 * values, and this driver creates or resumes the Agent once the Loader
 * settles, publishes it through `blueSession`, answers the
 * `'blue/request-resume'`/`'blue/request-new'`/`'blue/request-fork'`
 * switches for the interaction layer's session commands, and arms the
 * exit epitaph (D47) that the process 'exit' hook flushes after the
 * teardown — the saved session id and its resume command.
 *
 * @module @dsh-blue/blue-app
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle, AgentSetup, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await,
// the cmdline Context merge for the appExit host value, and the
// agent-presets merges: the optional `agentPresets` roster service plus the
// `agent-preset/selected` SessionEventMap member the fold below narrows on.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { armExitEpitaph, epitaphFor, profileFromArgv } from './exit-epitaph.ts'
import { createModelSelectionRef } from './model-ref.ts'
import { createBlueRequestController } from './request-lifecycle.ts'
import { installRetractionService } from './retraction.ts'
import type { BlueModelSelectionRef } from './model-ref.ts'
import type { BlueSessionRef } from './types.ts'

export type { BlueRetractionService, BlueSessionRef, BlueTurnRetraction } from './types.ts'
export type { BlueModelSelectionRef } from './model-ref.ts'
export { createBlueRequestController, type BlueRequestController } from './request-lifecycle.ts'
export type { BlueRequestLifecycle, BlueRequestRef, BlueRequestState } from '@dsh-blue/blue-api'

/** Stable Cordis plugin name. */
export const name = 'blue-app'

/** Core services required before the session can start; `blueScreen` keeps the terminal up before the driver runs. */
export const inject = ['blueStartup', 'agentDefaultModel', 'agents', 'sessions', 'blueScreen']

/** Plugin config: the launch values resolved from this app's injected provider service. */
export interface Config {
  /** The task to send immediately after the Agent starts; absent opens the UI idle. */
  task?: string
  /** The persisted session id to resume; absent creates a fresh session. */
  resume?: string
}

export const Config: z<Config> = z.object({
  task: z.string(),
  resume: z.string(),
})

/** Process-facing effects: the diagnostic stream plus the launcher's bounded exit request. */
interface BlueIo {
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process stream the driver writes diagnostics to; tests substitute a capture. */
export const internals: { stderr: BlueIo['stderr'] } = {
  stderr: process.stderr,
}

/** Render one failure reason for a diagnostic line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Receives the selection reference an Agent setup creates; read at the switch's commit point. */
interface SelectionHolder {
  selection?: BlueModelSelectionRef
}

/** The session facts the preset fold reads; the Agent's own session satisfies it. */
interface PresetBearingSession {
  readonly header: { readonly agentPreset?: string }
  readonly events: readonly SessionEvent[]
}

/**
 * The preset a session's own record names: the newest `agent-preset/selected`
 * event wins over the header's creation-time value (the upstream
 * `resolveSessionPreset` rule, folded locally so the roster stays an optional
 * composition — a host without it never loads this package at runtime).
 * @param session - the session whose log and header name the preset.
 * @returns the preset id the session runs, or `undefined` for the roster default.
 */
function sessionPreset(session: PresetBearingSession): string | undefined {
  let preset: string | undefined
  for (const event of session.events) {
    if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
  }
  return preset ?? session.header.agentPreset
}

/**
 * The Agent setup every create/resume path shares: the model-selection
 * install, then the preset mount. The selection reference resolves three
 * tiers on read — an in-session pick, the session log's last request header,
 * then the process default — so a resumed session keeps the model it was
 * already using while a fresh one starts from the default;
 * `installModelSelection` snapshots that merged read when a step enters
 * prompt assembly, so a switch lands on the next request.
 *
 * The mount is the thin-host half of the S28 migration — the bundle patch
 * disables the base's global agent-plane rows, so joining an agent to its
 * preset's standing composition is what gives it a tool surface at all. The
 * roster is a bundle-level optional: a composition without one (the row
 * stripped, or Blue mounted into a host that keeps its own agent plane)
 * skips the mount and the agent reads whatever the global layer offers,
 * exactly as before the migration. A resumed or forked session re-mounts
 * the composition its own log names, so a `/preset` switch outlives the
 * process (the upstream composeAgent precedent).
 * @param host - the driver's plugin context, where the roster is probed.
 * @param defaultModel - the default-model service supplying the fallback tier.
 * @param holder - receives the created reference for the commit-point publication.
 * @returns the Agent setup for every create/resume path.
 */
function agentSetup(host: Context, defaultModel: AgentDefaultModelConfig, holder: SelectionHolder): AgentSetup {
  return async (agentCtx) => {
    const agent = agentCtx.agent
    if (agent === undefined) throw new Error('blue-app: agent setup ran without a scoped agent')
    const selection = createModelSelectionRef(agent, defaultModel)
    installModelSelection(agentCtx, selection)
    holder.selection = selection
    const roster = host.get('agentPresets')
    if (roster === undefined) return
    await roster.mount(agentCtx, sessionPreset(agent.session))
  }
}

/**
 * Build the Agent-creation options shared by startup creation and the
 * `'blue/request-new'`/`'blue/request-fork'` switches: a fresh session id,
 * the current working directory, and the default model's provider/model
 * with the shared agent setup. Fork callers spread the result and override
 * `meta`/`seed` with the lineage fields.
 * @param host - the driver's plugin context, carried to the shared setup.
 * @param defaultModel - the default-model service supplying provider/model.
 * @param holder - receives the selection reference the setup creates.
 * @returns the creation options for a fresh session.
 */
function createOptions(host: Context, defaultModel: AgentDefaultModelConfig, holder: SelectionHolder): CreateAgentOptions {
  const selection = defaultModel.currentSelection()
  return {
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: agentSetup(host, defaultModel, holder),
  }
}

/**
 * Mount the Blue application driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated launch config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('blue-app: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: BlueIo = { stderr: internals.stderr, exit }
  const session: BlueSessionRef = { current: null, modelRef: undefined }
  ctx.provide('blueSession', session)
  const requests = createBlueRequestController(ctx)
  installRetractionService(
    ctx,
    () => session.current,
    requests,
    /* v8 ignore next -- retraction.spec covers the injected diagnostic sink; app wiring is declarative */
    message => { io.stderr.write(`dsh: ${message}\n`) },
  )
  ctx.on('session/event', (eventSession, event) => {
    if (eventSession !== session.current?.session) return
    const ref = requests.active()
    if (ref === undefined || event.type !== 'turn/end') return
    const reason = event.data.reason.kind
    requests.transition(ref,
      reason === 'aborted' || reason === 'interrupted' ? 'interrupted' : reason === 'error' ? 'failed' : 'completed',
      reason,
    )
  })
  // The exit epitaph (D47): arm on tree dispose — every deliberate exit
  // path funnels through the launcher's dispose-then-exit, and the
  // process 'exit' hook flushes strictly after the screen restore and the
  // persistence flush (the base rows unload after this fiber). The
  // session object survives the fiber unload, so the closure read stays
  // valid; a session with no events has nothing to resume and arms
  // nothing.
  ctx.effect(() => () => {
    const active = session.current
    armExitEpitaph(active !== null && active.session.events.length > 0
      ? epitaphFor(String(active.id), profileFromArgv(process.argv))
      : undefined)
  })
  let current: AgentHandle | undefined
  // Session operations serialize on this chain so a `/resume` issued while
  // startup (or another switch) is in flight cannot interleave two resumes.
  // Every operation reports its own failure; the trailing catch is the last
  // resort that keeps one wedged operation from blocking the queue.
  let chain: Promise<void> = Promise.resolve()
  const enqueue = (operation: () => Promise<void>): void => {
    chain = chain.then(operation).catch((error: unknown) => {
      io.stderr.write(`dsh: ${describe(error)}\n`)
    })
  }

  // The shared commit point of every create/resume switch: dispose the
  // previous Agent (if any), then publish the new Agent and its selection
  // reference together, and only then broadcast. A failed switch never
  // reaches here, so the live session and its modelRef stay untouched.
  const commitSwitch = async (next: AgentHandle, holder: SelectionHolder): Promise<void> => {
    const previous = current
    current = next
    if (previous !== undefined) await previous.dispose()
    session.current = next.agent
    session.modelRef = holder.selection
    requests.commitSession()
    ctx.emit('blue/session-changed', next.agent)
  }

  enqueue(async () => {
    // Loader siblings mount concurrently. Await the complete application
    // before creating an Agent so its scoped tools and adapters are not
    // half-composed.
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    // Early process shutdown can dispose the tree while settlement is pending.
    if (agents === undefined || defaultModel === undefined) return
    const holder: SelectionHolder = {}
    let handle: AgentHandle
    try {
      if (config.resume !== undefined) {
        handle = await agents.resume({
          resumeSessionId: SessionId(config.resume),
          setup: agentSetup(ctx, defaultModel, holder),
        })
      } else {
        handle = await agents.create(createOptions(ctx, defaultModel, holder))
      }
    } catch (error) {
      // Startup has no live session to fall back to; fail the launch.
      io.stderr.write(`dsh: ${describe(error)}\n`)
      io.exit(1)
      return
    }
    await commitSwitch(handle, holder)
    if (config.task !== undefined) {
      requests.begin('main')
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: config.task }],
        source: { kind: 'user' },
      }))
    }
  })

  ctx.on('blue/request-resume', (sessionId: string) => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      const holder: SelectionHolder = {}
      let next: AgentHandle
      try {
        // Resume before disposing: a failed switch keeps the live session.
        next = await agents.resume({
          resumeSessionId: SessionId(sessionId),
          setup: agentSetup(ctx, defaultModel, holder),
        })
      } catch (error) {
        io.stderr.write(`dsh: could not resume session ${sessionId}: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next, holder)
    })
  })

  ctx.on('blue/request-new', () => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      const holder: SelectionHolder = {}
      let next: AgentHandle
      try {
        // Create before disposing: a failed switch keeps the live session.
        next = await agents.create(createOptions(ctx, defaultModel, holder))
      } catch (error) {
        io.stderr.write(`dsh: could not start a new session: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next, holder)
    })
  })

  ctx.on('blue/request-fork', () => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      const active = session.current
      if (active === null) {
        io.stderr.write('dsh: no live session to fork\n')
        return
      }
      if (active.status !== 'idle') {
        io.stderr.write(`dsh: cannot fork session ${String(active.id)} while it is ${active.status}\n`)
        return
      }
      // The fork inherits the parent's full event log as its seed prefix.
      const seed = active.session.events
      const holder: SelectionHolder = {}
      let next: AgentHandle
      try {
        next = await agents.create({
          ...createOptions(ctx, defaultModel, holder),
          meta: {
            cwd: active.session.header.cwd ?? process.cwd(),
            parentSession: active.id,
            seedLength: seed.length,
          },
          seed,
        })
      } catch (error) {
        io.stderr.write(`dsh: could not fork session ${String(active.id)}: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next, holder)
    })
  })
}
