/**
 * Renderer-neutral `/context` panel and status models.
 *
 * @module @dsh-blue/blue-context/model
 */

import type { BlueUiNode } from '@dsh-blue/blue-api'
import { freezeModel, type ProviderModel } from '@dsh-blue/blue-frontend'
import type { ContextAction, ContextFacts, ContextModel, ContextModelState, ContextSnapshot, ContextTimelineEvent, ContextTimelineFacts } from './types.ts'

/** Format a token count with Blue's binary compact notation. */
export function formatContextTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1024) return `${(value / 1024).toFixed(value >= 102400 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(value)
}

/** Compute a non-zero, whole-percent occupancy clamped to 100. */
export function contextPercent(used: number | undefined, window: number | undefined): number | undefined {
  if (used === undefined || window === undefined || !Number.isFinite(used) || !Number.isFinite(window) || used <= 0 || window <= 0) return undefined
  return Math.min(100, Math.max(1, Math.ceil(used / window * 100)))
}

function factsNode(facts: ContextFacts): BlueUiNode {
  return {
    kind: 'fields',
    rows: [
      { label: 'input', value: [{ text: formatContextTokens(facts.input) }] },
      { label: 'cache read', value: [{ text: formatContextTokens(facts.cacheRead) }] },
      { label: 'cache write', value: [{ text: formatContextTokens(facts.cacheWrite) }] },
      { label: 'output', value: [{ text: formatContextTokens(facts.output) }] },
    ],
  }
}

function eventDetail(event: ContextTimelineEvent): string {
  if (event.kind === 'model') return [event.from, event.to].filter(value => value !== undefined).join(' -> ') || 'model changed'
  if (event.kind === 'inject') return event.name ?? event.form ?? 'context injected'
  if (event.kind === 'prune') return `${formatContextTokens(event.tokens ?? 0)} removed`
  return `${String(event.count ?? 0)} items compacted`
}

function timelineSections(timeline: ContextTimelineFacts): readonly { readonly title: string; readonly body: BlueUiNode }[] {
  const current = timeline.current
  const latest = timeline.requests.at(-1)
  const events = timeline.events.slice(-8)
  return [
    {
      title: 'current surface',
      body: {
        kind: 'fields',
        rows: [
          { label: 'model', value: [{ text: timeline.model === undefined ? 'not recorded' : `${timeline.model}${timeline.provider === undefined ? '' : ` (${timeline.provider})`}` }] },
          { label: 'system', value: [{ text: formatContextTokens(current.system) }] },
          { label: 'tools', value: [{ text: formatContextTokens(current.tools) }] },
          { label: 'user', value: [{ text: formatContextTokens(current.user) }] },
          { label: 'inject', value: [{ text: formatContextTokens(current.inject) }] },
          { label: 'assistant', value: [{ text: formatContextTokens(current.assistant) }] },
          { label: 'tool results', value: [{ text: formatContextTokens(current.tool) }] },
          { label: 'surface total', value: [{ text: formatContextTokens(current.total) }] },
        ],
      },
    },
    {
      title: 'timeline',
      body: {
        kind: 'fields',
        rows: [
          { label: 'requests', value: [{ text: String(timeline.requests.length) }] },
          { label: 'latest', value: [{ text: latest === undefined ? 'none' : `turn ${String(latest.turn ?? '?')} step ${String(latest.step ?? '?')} · ${formatContextTokens(latest.total)}` }] },
          { label: 'events', value: [{ text: String(timeline.events.length) }] },
          { label: 'images', value: [{ text: String(timeline.images) }] },
          { label: 'omitted nodes', value: [{ text: String(timeline.droppedNodes) }] },
        ],
      },
    },
    ...(events.length === 0 ? [] : [{
      title: 'recent context events',
      body: {
        kind: 'list' as const,
        id: 'context-list',
        selectedIds: [],
        items: events.map(event => ({ id: String(event.seq), label: event.kind, detail: eventDetail(event), disabled: true })),
      },
    }]),
  ]
}

/** Build the immutable context model from one authoritative projection cut. */
export function buildContextModel(snapshot: ContextSnapshot, state: ContextModelState = 'ready', error?: string, canRefresh = true): ContextModel {
  const facts = snapshot.facts
  const percent = contextPercent(facts.used, facts.window)
  const sections = [
    { title: 'usage', body: factsNode(facts) },
    ...(percent === undefined ? [] : [{
      title: 'context pressure',
      body: {
        kind: 'fields' as const,
        rows: [
          { label: 'used', value: [{ text: `${formatContextTokens(facts.used!)} / ${formatContextTokens(facts.window!)}` }] },
          { label: 'percent', value: [{ text: `${String(percent)}%` }] },
        ],
      },
    }]),
    ...(facts.breakdown === undefined ? [] : [{
      title: 'composition',
      body: {
        kind: 'fields' as const,
        rows: [
          { label: 'system', value: [{ text: formatContextTokens(facts.breakdown.system) }] },
          { label: 'tools', value: [{ text: formatContextTokens(facts.breakdown.tools) }] },
          { label: 'messages', value: [{ text: formatContextTokens(facts.breakdown.messages) }] },
        ],
      },
    }]),
    ...(facts.timeline === undefined ? [] : timelineSections(facts.timeline)),
  ]
  const action: ContextAction = { kind: 'context.refresh', sessionId: snapshot.sessionId }
  const statusText = state === 'loading'
    ? 'loading context'
    : state === 'empty'
      ? 'no context data'
      : state === 'absent'
        ? 'context unavailable'
        : state === 'error'
          ? `context error: ${error ?? 'request failed'}`
          : percent === undefined
            ? facts.timeline === undefined ? 'context unavailable' : `context · ${String(facts.timeline.requests.length)} requests`
            : `context ${String(percent)}%`
  const panel = {
    title: 'Context',
    node: {
      kind: 'stack' as const,
      direction: 'column' as const,
      gap: 1 as const,
      children: (state === 'loading' || state === 'error' || state === 'absent'
        ? [{ title: 'status', body: { kind: 'text' as const, content: statusText } }]
        : sections).flatMap(section => [
          { node: { kind: 'divider' as const, label: section.title } },
          { node: section.body },
        ]),
    },
    ...(state === 'loading' || !canRefresh ? {} : { refresh: action }),
  }
  const status: ProviderModel = {
    providerId: 'dsh-context',
    capabilities: [
      'context',
      ...(facts.breakdown === undefined ? [] : ['context.breakdown']),
      ...(facts.timeline === undefined ? [] : ['context.timeline']),
    ],
    nodes: [{ kind: 'text', content: statusText }],
  }
  return freezeModel({ state, ...(error === undefined ? {} : { error }), panel, status })
}

/** Build the `/context` command contribution for the attached session. */
export function contextCommand(sessionId: string): Readonly<{ readonly kind: 'command'; readonly id: string; readonly label: string; readonly enabled: boolean; readonly action: ContextAction }> {
  return { kind: 'command', id: 'context', label: '/context', enabled: true, action: { kind: 'context.open', sessionId } }
}
