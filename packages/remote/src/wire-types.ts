/** Minimal structural types shared with the external dsh-remote wire client. */
export interface RemoteWireHealth { protocolVersion: number; protocolMinor?: number; incarnation?: string; pluginVersion?: string; capabilities?: readonly string[]; serverFingerprint?: string }
export interface RemoteWireNegotiation { bridge: { major: number; minMinor: number; maxMinor: number }; requiredCapabilities?: readonly string[]; acceptedAbis: readonly Record<string, string>[] }
export interface RemoteWireContract { contractId?: string; bridge?: { major: number; minor: number }; capabilities?: readonly string[]; abi?: Record<string, string>; limits?: Record<string, number> }
export interface RemoteSessionList { items: Array<{ sessionId: string; cwd?: string; running?: boolean; projections?: { asOfSeq: number } }> }
export interface MuxFrame { type: string; sessionId?: string; event?: { type: string; seq: number } }
export interface HostEventFrame { type?: string; payload?: unknown; data?: unknown; sessionId?: string; event?: { type: string; seq: number } }
export interface RemoteEventChunk { data: string }
/** Structural view of the authenticated `@dsh-remote/core` connection. */
export interface DshRemoteConnectionClient {
  readonly contract: RemoteWireContract
  readonly host: { subscribe(kind: 'mux' | 'host', signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> }
  readonly agents: { invoke<T>(action: string, payload: unknown, options?: { readonly signal?: AbortSignal }): Promise<T> }
  attach?(sessionId: string, access: 'read' | 'write'): Promise<{ release(): Promise<void> }>
}
export interface RemoteWireClient {
  getTui?<T>(path: string): Promise<T>
  call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T>
  subscribeEvents?(kind: 'mux' | 'host', signal?: AbortSignal): Promise<AsyncIterable<RemoteEventChunk>>
  subscribe?(openMethod: 'host.events.open', cancelMethod: 'host.events.cancel', payload: { kind: 'mux' | 'host' }, signal?: AbortSignal): Promise<AsyncIterable<RemoteEventChunk>>
  respond(rpcId: string, value: unknown): Promise<boolean>
  start(handlers: { onMuxFrame(rpcId: string, frame: MuxFrame): void; onHostFrame(frame: HostEventFrame): void; onReopen(): void }): void
  stop(): void
}
