/** Minimal structural types shared with the external dsh-remote wire client. */
export interface RemoteWireHealth { protocolVersion: number; incarnation: string; pluginVersion: string }
export interface RemoteSessionList { items: Array<{ sessionId: string; cwd?: string; running?: boolean; projections?: { asOfSeq: number } }> }
export interface MuxFrame { type: string; sessionId?: string; event?: { type: string; seq: number } }
export interface RemoteWireClient {
  getTui<T>(path: string): Promise<T>
  call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T>
  respond(rpcId: string, value: unknown): Promise<boolean>
  start(handlers: { onMuxFrame(rpcId: string, frame: MuxFrame): void; onHostFrame(frame: unknown): void; onReopen(): void }): void
  stop(): void
}
