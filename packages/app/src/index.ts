/**
 * Blue application startup and current-Agent selection. Harness domain
 * behavior stays on the ordinary dsh Cordis services.
 *
 * @module @dsh-blue/blue-app
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BlueRequestLifecycle } from '@dsh-blue/blue-api'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { BlueCurrentAgentService } from './current-agent.ts'
import { armExitEpitaph, epitaphFor, profileFromArgv } from './exit-epitaph.ts'
import { createBlueRequestController } from './request-lifecycle.ts'
import { installRetractionService } from './retraction.ts'
import { installSessionTitleCadence } from './title-cadence.ts'

export { BlueCurrentAgentService } from './current-agent.ts'
export { createBlueRequestController, type BlueRequestController } from './request-lifecycle.ts'
export type { BlueRetractionService, BlueTurnRetraction } from './retraction.ts'
export type { BlueRequestLifecycle, BlueRequestRef, BlueRequestState } from '@dsh-blue/blue-api'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'blue/request-state-changed'(lifecycle: BlueRequestLifecycle): void
    'blue/session-epoch-changed'(sessionEpoch: number): void
    'blue/request-resume'(sessionId: string): void
    'blue/request-new'(): void
    'blue/request-fork'(): void
    'blue/request-rewind'(sessionId: string, atSeq: number): void
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-app'

/** Direct dsh services required by the startup coordinator. */
export const inject = ['blueStartup', 'agents', 'sessionController', 'blueScreen']

/** Launch values resolved by the startup provider. */
export interface Config {
  readonly task?: string
  readonly resume?: string
}

export const Config: z<Config> = z.object({
  task: z.string(),
  resume: z.string(),
})

interface BlueIo {
  stderr: { write(chunk: string): unknown }
  exit(code: number): void
}

/** Process-facing diagnostic stream; tests may replace it. */
export const internals: { stderr: BlueIo['stderr'] } = { stderr: process.stderr }

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolvedAgent(result: Awaited<ReturnType<SessionController['resolveAgent']>>): Agent {
  if ('error' in result) throw result.error
  return result.agent
}

/** Mount startup, navigation, request lifecycle, and current-Agent selection. */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('blue-app: the launcher must provide ctx.appExit before the tree mounts')
  const io: BlueIo = { stderr: internals.stderr, exit }
  const current = new BlueCurrentAgentService(ctx)
  const requests = createBlueRequestController(ctx)
  const controller = ctx.sessionController

  const offTitleCadence = installSessionTitleCadence(ctx, () => current.current()?.session)
  ctx.effect(() => offTitleCadence)
  installRetractionService(
    ctx,
    () => current.current(),
    requests,
    message => { io.stderr.write(`dsh: ${message}\n`) },
  )

  ctx.on('session/event', (session, event) => {
    if (session !== current.current()?.session || event.type !== 'turn/end') return
    const ref = requests.active()
    if (ref === undefined) return
    const reason = event.data.reason.kind
    requests.transition(
      ref,
      reason === 'aborted' || reason === 'interrupted'
        ? 'interrupted'
        : reason === 'error'
          ? 'failed'
          : 'completed',
      reason,
    )
  })

  ctx.effect(() => () => {
    const agent = current.current()
    armExitEpitaph(agent !== null && agent.session.events.length > 0
      ? epitaphFor(String(agent.id), profileFromArgv(process.argv))
      : undefined)
  })

  let chain = Promise.resolve()
  const enqueue = (operation: () => Promise<void>): void => {
    chain = chain.then(operation).catch((error: unknown) => {
      io.stderr.write(`dsh: ${describe(error)}\n`)
    })
  }

  const select = (agent: Agent): void => {
    current.select(agent)
    requests.commitSession()
  }

  const resolve = async (sessionId: string): Promise<Agent> => {
    return resolvedAgent(await controller.resolveAgent(SessionId(sessionId)))
  }

  const create = async (): Promise<Agent> => {
    const created = await controller.create({ cwd: process.cwd() })
    return resolve(String(created.sessionId))
  }

  enqueue(async () => {
    await ctx.get('loader')?.await()
    try {
      const agent = config.resume === undefined ? await create() : await resolve(config.resume)
      select(agent)
      /* v8 ignore else -- the no-task startup path is covered explicitly; V8 retains a synthetic empty else arm. */
      if (config.task !== undefined) {
        requests.begin('main')
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: config.task }],
          source: { kind: 'user' },
        }))
      }
    } catch (error) {
      io.stderr.write(`dsh: ${describe(error)}\n`)
      io.exit(1)
    }
  })

  ctx.on('blue/request-resume', (sessionId) => {
    enqueue(async () => {
      try { select(await resolve(sessionId)) }
      catch (error) { io.stderr.write(`dsh: could not resume session ${sessionId}: ${describe(error)}\n`) }
    })
  })

  ctx.on('blue/request-new', () => {
    enqueue(async () => {
      try { select(await create()) }
      catch (error) { io.stderr.write(`dsh: could not start a new session: ${describe(error)}\n`) }
    })
  })

  ctx.on('blue/request-fork', () => {
    enqueue(async () => {
      const agent = current.current()
      if (agent === null) {
        io.stderr.write('dsh: no live session to fork\n')
        return
      }
      try {
        const forked = await controller.fork({ sessionId: agent.id })
        select(await resolve(String(forked.sessionId)))
      } catch (error) {
        io.stderr.write(`dsh: could not fork session ${String(agent.id)}: ${describe(error)}\n`)
      }
    })
  })

  ctx.on('blue/request-rewind', (sessionId, atSeq) => {
    enqueue(async () => {
      const agent = current.current()
      if (agent === null || String(agent.id) !== sessionId) {
        io.stderr.write(`dsh: rewind request is stale for session ${sessionId}\n`)
        return
      }
      try {
        const forked = await controller.fork({ sessionId: agent.id, atSeq })
        select(await resolve(String(forked.sessionId)))
      } catch (error) {
        io.stderr.write(`dsh: could not rewind session ${sessionId}: ${describe(error)}\n`)
      }
    })
  })
}
