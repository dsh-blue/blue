/**
 * App-owned safe message retraction: match one submitted message to the
 * currently open main turn, reject tool-bearing turns, cancel the driver,
 * and replace that turn's model-visible surface after its close commits.
 *
 * @module @dsh-blue/blue-app/retraction
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { BlueRequestController } from './request-lifecycle.ts'

/** Identity of one live turn removed from Blue's visible conversation. */
export interface BlueTurnRetraction {
  readonly sessionEpoch: number
  readonly requestEpoch: number
  readonly turn: number
}

/** App-owned gate for retracting the currently running human message. */
export interface BlueRetractionService { tryRetract(messageId: string): boolean }

declare module '@deepseek-ai/cordis' {
  interface Context { blueRetractions: BlueRetractionService }
  interface Events { 'blue/turn-retracted'(retraction: BlueTurnRetraction): void }
}

/** One open turn reconstructed from the append-only boundary log. */
interface OpenTurn {
  readonly turn: number
  readonly startSeq: number
  readonly step: number
}

/** A successful retraction waiting for the host's authoritative turn close. */
interface PendingRetraction extends OpenTurn {
  readonly agent: Agent
  readonly session: Session
  readonly lifecycle: BlueTurnRetraction
}

/** Find the session's currently open turn and its latest entered step. */
function openTurn(events: readonly SessionEvent[]): OpenTurn | undefined {
  let open: OpenTurn | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      open = { turn: event.data.turn, startSeq: event.seq, step: 0 }
    } else if (event.type === 'step/start' && open?.turn === event.data.turn) {
      open = { ...open, step: event.data.step }
    } else if (event.type === 'turn/end' && open?.turn === event.data.turn) {
      open = undefined
    }
  }
  return open
}

/** Whether this turn has crossed the no-side-effect retraction boundary. */
function hasToolActivity(events: readonly SessionEvent[], turn: number): boolean {
  return events.some((event) => {
    if (event.type === 'tool/call' || event.type === 'tool/result') return event.data.turn === turn
    if (event.type !== 'assistant/message' || event.data.turn !== turn) return false
    return event.data.message.content.some(block => block.type === 'tool-call')
  })
}

/** Whether the requested human message entered this exact open turn. */
function turnContainsMessage(events: readonly SessionEvent[], open: OpenTurn, messageId: string): boolean {
  return events.some(event => event.seq > open.startSeq
    && event.type === 'user/message'
    && event.data.source.kind === 'user'
    && String(event.data.id) === messageId)
}

/**
 * Install the retraction service and its turn-close persistence coordinator.
 * @param ctx - app context carrying the request lifecycle and session events.
 * @param currentAgent - live-agent reader; never caches across session switches.
 * @param requests - app-owned request lifecycle controller.
 * @param report - diagnostic sink for an unexpected replacement failure.
 * @returns the provided retraction service.
 */
export function installRetractionService(
  ctx: Context,
  currentAgent: () => Agent | null,
  requests: BlueRequestController,
  report: (message: string) => void,
): BlueRetractionService {
  let pending: PendingRetraction | undefined

  const persist = (entry: PendingRetraction, endSeq: number): void => {
    queueMicrotask(() => {
      const nodes = entry.session.surface.nodes.filter(seq => seq > entry.startSeq && seq < endSeq)
      const start = nodes[0]
      const end = nodes.at(-1)
      /* v8 ignore next -- a matched human surface message guarantees at least one node before turn/end */
      if (start === undefined || end === undefined) return
      const config = entry.session.requestHeader()?.config
      try {
        entry.session.append('assistant/message', {
          turn: entry.turn,
          step: entry.step,
          message: createAssistantMessage({
            content: [],
            source: {
              provider: config?.provider ?? entry.agent.options.provider ?? '',
              model: config?.model ?? entry.agent.options.model ?? '',
            },
          }),
          interrupted: true,
        }, {
          surfaceOp: { op: 'replace', start, end },
          sourceEventSeqs: nodes,
        })
      } catch (error) {
        report(`could not persist message retraction: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  ctx.on('session/event', (session, event) => {
    const entry = pending
    if (entry === undefined || session !== entry.session) return
    if (event.type !== 'turn/end' || event.data.turn !== entry.turn) return
    pending = undefined
    persist(entry, event.seq)
  })

  const service: BlueRetractionService = {
    tryRetract(messageId) {
      const agent = currentAgent()
      const ref = requests.active()
      if (agent === null || agent.status !== 'running' || ref?.scope !== 'main' || pending !== undefined) return false
      const events = agent.session.events
      const open = openTurn(events)
      if (open === undefined || !turnContainsMessage(events, open, messageId)) return false
      if (hasToolActivity(events, open.turn)) return false
      const lifecycle: BlueTurnRetraction = {
        sessionEpoch: ref.sessionEpoch,
        requestEpoch: ref.requestEpoch,
        turn: open.turn,
      }
      pending = { ...open, agent, session: agent.session, lifecycle }
      requests.transition(ref, 'aborted', 'retracted')
      ctx.emit('blue/turn-retracted', lifecycle)
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      return true
    },
  }
  ctx.provide('blueRetractions', service)
  ctx.effect(() => () => {
    pending = undefined
  })
  return service
}
