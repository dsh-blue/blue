import type { ProviderModel } from './models.ts'

export interface ProviderContext { readonly generation: number; readonly signal: AbortSignal; isCurrent(): boolean; publish(model: ProviderModel): void }
export interface FrontendProvider<State = unknown> {
  readonly id: string
  readonly capabilities?: readonly string[]
  capture?(signal: AbortSignal): State | Promise<State>
  activate(context: ProviderContext, state?: State): void | Promise<void>
  restore?(state: State, context: ProviderContext): void | Promise<void>
  dispose?(): void | Promise<void>
}

export const plainProvider: FrontendProvider<undefined> = {
  id: 'plain',
  capabilities: [],
  activate(context) { context.publish({ providerId: 'plain', capabilities: [], nodes: [] }) },
}
