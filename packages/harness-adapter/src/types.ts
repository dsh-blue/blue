import type { BlueErrorCode, BlueResult, BlueRequestRef } from '@dsh-blue/blue-api'

export type AdapterCapability = 'session' | 'projection' | 'action' | 'model' | 'question' | 'approval' | 'refresh' | 'jobs'
export type AdapterAbsent = { readonly kind: 'absent'; readonly capability: AdapterCapability; readonly reason: string }
export type AdapterResult<T> = BlueResult<T> | { readonly ok: false; readonly code: 'BLUE_CAPABILITY_ABSENT'; readonly absent: AdapterAbsent }
export type EventEnvelope<E> = { readonly seq: number; readonly sessionId: string; readonly event: E }
export type SnapshotEnvelope<S> = { readonly watermark: number; readonly value: S }
export type EventListener<E> = (event: EventEnvelope<E>) => void
export type Unsubscribe = () => void
export type AbortOptions = { readonly signal?: AbortSignal }
export type ActionRef = BlueRequestRef

/** Error carrier for a capability missing below an async adapter boundary. */
export class AdapterCapabilityAbsentError extends Error {
  readonly code = 'BLUE_CAPABILITY_ABSENT'
  constructor(readonly capability: AdapterCapability, message = `Harness capability "${capability}" is unavailable`) {
    super(message)
    this.name = 'AdapterCapabilityAbsentError'
  }
}

export function absent<T>(capability: AdapterCapability, reason = `Harness capability "${capability}" is unavailable`): AdapterResult<T> {
  return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', absent: { kind: 'absent', capability, reason } }
}

export function failure<T>(code: BlueErrorCode, message: string): BlueResult<T> { return { ok: false, code, message } }
export function success<T>(value: T): BlueResult<T> { return { ok: true, value } }

export function abortResult<T>(): BlueResult<T> { return failure('BLUE_ABORTED', 'The adapter operation was aborted') }
export function staleResult<T>(): BlueResult<T> { return failure('BLUE_ACTION_REJECTED', 'The adapter result is stale') }
