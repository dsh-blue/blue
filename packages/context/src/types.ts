/**
 * Renderer-neutral context projection contracts shared by the official
 * Harness adapter and Blue's interaction model.
 *
 * @module @dsh-blue/blue-context/types
 */

import type { PanelModel, ProviderModel, View } from '@dsh-blue/blue-frontend'

export interface UsageSample { readonly turn: number; readonly step: number; readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number }
export interface ContextTimelineCurrent { readonly system: number; readonly tools: number; readonly user: number; readonly inject: number; readonly assistant: number; readonly tool: number; readonly total: number }
export interface ContextTimelineRequest { readonly turn?: number; readonly step?: number; readonly time: number; readonly seq: number; readonly total: number; readonly prompt?: number; readonly output?: number }
export interface ContextTimelineEvent { readonly seq: number; readonly time: number; readonly kind: 'compaction' | 'prune' | 'inject' | 'model'; readonly form?: string; readonly tokens?: number; readonly count?: number; readonly name?: string; readonly from?: string; readonly to?: string }
export interface ContextTimelineFacts { readonly model?: string; readonly provider?: string; readonly current: ContextTimelineCurrent; readonly requests: readonly ContextTimelineRequest[]; readonly events: readonly ContextTimelineEvent[]; readonly droppedNodes: number; readonly images: number }
export interface OfficialContextProjection { readonly complete?: true; readonly usage?: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number }; readonly pressure?: { readonly projectedTokens?: number; readonly pressureTokens?: number; readonly contextWindow?: number }; readonly breakdown?: { readonly system: number; readonly tools: number; readonly messages: number }; readonly timeline?: ContextTimelineFacts }
export interface ContextEvent { readonly type: 'usage' | 'pressure' | 'breakdown' | 'official'; readonly usage?: UsageSample; readonly projectedTokens?: number; readonly pressureTokens?: number; readonly contextWindow?: number; readonly systemTokens?: number; readonly toolsTokens?: number; readonly messageTokens?: number; readonly official?: OfficialContextProjection }
export type ContextCapability = 'context' | 'breakdown' | 'refresh' | 'status'
export interface ContextFacts { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly used?: number; readonly window?: number; readonly breakdown?: { readonly system: number; readonly tools: number; readonly messages: number }; readonly timeline?: ContextTimelineFacts }
export interface ContextState { readonly usage: ContextFacts; readonly samples: Readonly<Record<string, UsageSample>> }
export interface ContextSnapshot { readonly sessionId: string; readonly watermark: number; readonly facts: ContextFacts }
export interface ContextSource {
  readonly capabilities?: readonly ContextCapability[]
  snapshot(sessionId: string, signal: AbortSignal): Promise<{ readonly watermark: number; readonly events: readonly ContextEvent[] }>
  subscribe(sessionId: string, afterWatermark: number, listener: (event: { readonly seq: number; readonly sessionId: string; readonly event: ContextEvent }) => void): () => void
  /** Ask the Harness token-meter to refresh its authoritative projection. */
  refresh?(sessionId: string, signal: AbortSignal): Promise<void>
  /** Release adapter subscriptions and buffered projection frames. */
  dispose?(): void
}
export interface ContextAction { readonly kind: 'context.open' | 'context.refresh'; readonly sessionId: string }
export type ContextModelState = 'loading' | 'ready' | 'empty' | 'absent' | 'error'
export type ContextModel = Readonly<{ readonly state: ContextModelState; readonly error?: string; readonly panel: PanelModel; readonly status: ProviderModel }>
export type ContextView = View
