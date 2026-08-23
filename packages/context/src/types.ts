import type { PanelModel, ProviderModel, View } from '@dsh-blue/blue-frontend'

export interface UsageSample { readonly turn: number; readonly step: number; readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens?: number; readonly cacheWriteTokens?: number }
export interface ContextEvent { readonly type: 'usage' | 'pressure' | 'breakdown'; readonly usage?: UsageSample; readonly projectedTokens?: number; readonly pressureTokens?: number; readonly contextWindow?: number; readonly systemTokens?: number; readonly toolsTokens?: number; readonly messageTokens?: number }
export interface ContextFacts { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly used?: number; readonly window?: number; readonly breakdown?: { readonly system: number; readonly tools: number; readonly messages: number } }
export interface ContextState { readonly usage: ContextFacts; readonly samples: Readonly<Record<string, UsageSample>> }
export interface ContextSnapshot { readonly sessionId: string; readonly watermark: number; readonly facts: ContextFacts }
export interface ContextSource { snapshot(sessionId: string, signal: AbortSignal): Promise<{ readonly watermark: number; readonly events: readonly ContextEvent[] }>; subscribe(sessionId: string, afterWatermark: number, listener: (event: { readonly seq: number; readonly sessionId: string; readonly event: ContextEvent }) => void): () => void }
export interface ContextAction { readonly kind: 'context.open' | 'context.refresh'; readonly sessionId: string }
export type ContextModel = Readonly<{ readonly panel: PanelModel; readonly status: ProviderModel }>
export type ContextView = View
