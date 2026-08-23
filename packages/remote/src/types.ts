import type { BlueSessionAction, BlueSessionSnapshot, BlueResult } from '@dsh-blue/blue-api'
import type { EventEnvelope, SnapshotEnvelope, Unsubscribe } from '@dsh-blue/blue-harness-adapter'

export type RemoteCapability = 'session' | 'action' | 'projection' | 'question' | 'approval' | 'writeLease'
export type RemoteCapabilities = Readonly<{ readonly capabilities: readonly RemoteCapability[]; readonly protocol: string }>
export type WriteLease = Readonly<{
  readonly token: string
  readonly expiresAt: number
  readonly leaseId?: string
  readonly fencingToken?: number
  readonly sessionId?: string
  readonly clientId?: string
  readonly frontendInstanceId?: string
}>

export interface RemoteTransport {
  negotiate(signal: AbortSignal): Promise<RemoteCapabilities>
  snapshot(sessionId: string, signal: AbortSignal): Promise<SnapshotEnvelope<BlueSessionSnapshot>>
  subscribe(sessionId: string, afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): Unsubscribe
  request(sessionId: string, action: BlueSessionAction, signal: AbortSignal): Promise<void>
  acquireWriteLease?(sessionId: string, signal: AbortSignal): Promise<WriteLease>
  releaseWriteLease?(sessionId: string, lease: WriteLease): Promise<void>
  ask?(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown>
  approve?(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown>
}

export type RemoteResult<T> = BlueResult<T> | { readonly ok: false; readonly code: 'BLUE_CAPABILITY_ABSENT'; readonly capability: RemoteCapability }
