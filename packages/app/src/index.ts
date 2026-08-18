/**
 * @deepseek-ai/dsh-blue-app — the Blue terminal UI application driver. The
 * bundle patch rides over dsh-base; the startup provider parses the launch
 * values, and this driver creates or resumes the Agent once the Loader
 * settles, publishes it through `blueSession`, and answers the
 * `'blue/request-resume'`/`'blue/request-new'`/`'blue/request-fork'`
 * switches for the interaction layer's session commands.
 *
 * @module @deepseek-ai/dsh-blue-app
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { AgentHandle, AgentSetup, CreateAgentOptions, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { BlueSessionRef } from './types.ts'

export type { BlueSessionRef } from './types.ts'

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

/**
 * Build the model-selection setup shared by Agent creation and both resume
 * paths. The initial selection is the current default; on resume the session
 * header's model wins once prompt assembly snapshots the selection, as
 * `installModelSelection` routes requests from the assembled value.
 * @param defaultModel - the default-model service supplying the initial selection.
 * @returns an Agent setup installing the mutable selection onto the agent scope.
 */
function modelSelectionSetup(defaultModel: AgentDefaultModelConfig): AgentSetup {
  return (agentCtx) => {
    const selection: ModelSelectionRef = { current: defaultModel.currentSelection(), assembled: undefined }
    installModelSelection(agentCtx, selection)
  }
}

/**
 * Build the Agent-creation options shared by startup creation and the
 * `'blue/request-new'`/`'blue/request-fork'` switches: a fresh session id,
 * the current working directory, and the default model's provider/model
 * with the model-selection setup. Fork callers spread the result and
 * override `meta`/`seed` with the lineage fields.
 * @param defaultModel - the default-model service supplying provider/model.
 * @returns the creation options for a fresh session.
 */
function createOptions(defaultModel: AgentDefaultModelConfig): CreateAgentOptions {
  // This bundle composes no preset roster, so the model-facing rows sit in
  // the host plane and the agent reads them from the global layer (same
  // construction as the headless runner).
  const selection = defaultModel.currentSelection()
  return {
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: modelSelectionSetup(defaultModel),
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
  const session: BlueSessionRef = { current: null }
  ctx.provide('blueSession', session)
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

  enqueue(async () => {
    // Loader siblings mount concurrently. Await the complete application
    // before creating an Agent so its scoped tools and adapters are not
    // half-composed.
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    // Early process shutdown can dispose the tree while settlement is pending.
    if (agents === undefined || defaultModel === undefined) return
    let handle: AgentHandle
    try {
      if (config.resume !== undefined) {
        handle = await agents.resume({
          resumeSessionId: SessionId(config.resume),
          setup: modelSelectionSetup(defaultModel),
        })
      } else {
        handle = await agents.create(createOptions(defaultModel))
      }
    } catch (error) {
      // Startup has no live session to fall back to; fail the launch.
      io.stderr.write(`dsh: ${describe(error)}\n`)
      io.exit(1)
      return
    }
    current = handle
    session.current = handle.agent
    ctx.emit('blue/session-changed', handle.agent)
    if (config.task !== undefined) {
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
      let next: AgentHandle
      try {
        // Resume before disposing: a failed switch keeps the live session.
        next = await agents.resume({
          resumeSessionId: SessionId(sessionId),
          setup: modelSelectionSetup(defaultModel),
        })
      } catch (error) {
        io.stderr.write(`dsh: could not resume session ${sessionId}: ${describe(error)}\n`)
        return
      }
      const previous = current
      current = next
      if (previous !== undefined) await previous.dispose()
      // Publish only at the commit point: the new Agent is live and the old
      // one disposed before consumers re-read blueSession.
      session.current = next.agent
      ctx.emit('blue/session-changed', next.agent)
    })
  })

  // The shared commit point of the create-based switches (`request-new`,
  // `request-fork`): same ordering discipline as the resume switch above.
  const commitSwitch = async (next: AgentHandle): Promise<void> => {
    const previous = current
    current = next
    if (previous !== undefined) await previous.dispose()
    session.current = next.agent
    ctx.emit('blue/session-changed', next.agent)
  }

  ctx.on('blue/request-new', () => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      let next: AgentHandle
      try {
        // Create before disposing: a failed switch keeps the live session.
        next = await agents.create(createOptions(defaultModel))
      } catch (error) {
        io.stderr.write(`dsh: could not start a new session: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next)
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
      let next: AgentHandle
      try {
        next = await agents.create({
          ...createOptions(defaultModel),
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
      await commitSwitch(next)
    })
  })
}
