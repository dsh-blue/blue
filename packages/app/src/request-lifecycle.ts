/**
 * App-owned request lifecycle controller shared by Blue interaction and
 * presentation effects.
 *
 * @module @dsh-blue/blue-app/request-lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueRequestLifecycle, BlueRequestRef, BlueRequestState } from '@dsh-blue/blue-api'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueRequests: BlueRequestController
  }
}

/** Narrow controller that never exposes Agent or Session objects. */
export interface BlueRequestController {
  readonly sessionEpoch: number
  active(): BlueRequestRef | undefined
  begin(scope?: BlueRequestRef['scope']): BlueRequestRef
  transition(ref: BlueRequestRef, state: BlueRequestState, reason?: string): void
  interrupt(ref?: BlueRequestRef): void
  commitSession(): number
}

/** Create and provide a Fiber-owned lifecycle controller. */
export function createBlueRequestController(ctx: Context): BlueRequestController {
  let sessionEpoch = 0
  let requestEpoch = 0
  let active: BlueRequestRef | undefined
  let disposed = false
  const terminal = new Set<BlueRequestState>(['completed', 'failed', 'aborted', 'interrupted'])
  const allowed = new Map<BlueRequestState, ReadonlySet<BlueRequestState>>([
    ['started', new Set(['streaming', 'completed', 'failed', 'aborted', 'interrupted'])],
    ['streaming', new Set(['completed', 'failed', 'aborted', 'interrupted'])],
    ['completed', new Set()],
    ['failed', new Set()],
    ['aborted', new Set()],
    ['interrupted', new Set()],
  ])
  let state: BlueRequestState | undefined
  const emit = (lifecycle: BlueRequestLifecycle): void => {
    if (!disposed) ctx.emit('blue/request-state-changed', lifecycle)
  }
  const controller: BlueRequestController = {
    get sessionEpoch() {
      return sessionEpoch
    },
    active() {
      return active
    },
    begin(scope = 'main') {
      const ref: BlueRequestRef = { sessionEpoch, requestEpoch: ++requestEpoch, scope }
      active = ref
      state = 'started'
      emit({ ref, state: 'started' })
      return ref
    },
    transition(ref, nextState, reason) {
      if (ref.sessionEpoch !== sessionEpoch || active?.requestEpoch !== ref.requestEpoch || state === undefined) return
      if (!allowed.get(state)?.has(nextState)) return
      state = nextState
      emit({ ref, state: nextState, ...(reason === undefined ? {} : { reason }) })
      if (terminal.has(nextState)) active = undefined
    },
    interrupt(ref = active) {
      if (ref !== undefined) controller.transition(ref, 'interrupted', 'user')
    },
    commitSession() {
      sessionEpoch += 1
      active = undefined
      state = undefined
      ctx.emit('blue/session-epoch-changed', sessionEpoch)
      return sessionEpoch
    },
  }
  ctx.provide('blueRequests', controller)
  ctx.effect(() => () => {
    disposed = true
    active = undefined
  })
  return controller
}
