/**
 * Child-session attach view over native dsh subagent, session-query, and
 * projection services. It is an interaction-owned temporary renderer, not a
 * Cordis service or compatibility facade.
 *
 * @module @dsh-blue/blue-interaction/attach-view
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import type {
  BlueComponents,
  BlueFocusable,
  BlueScreen,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import type { TranscriptModel, BlueTranslate } from '@dsh-blue/blue-frontend'
import { conversationProjectionSchema } from '@dsh-blue/blue-conversation'
import {
  conversationTranscriptModel,
  createTranscriptModel,
  TranscriptModelComponent,
  type ToolPresentationSource,
  type TranscriptModelRenderer,
} from '@dsh-blue/blue-transcript'
import { displayServices } from './display-services.ts'
import { mountEditorReplacement } from './editor-instance.ts'
import { interactionTranslator } from './locale.ts'
import { formatTokens } from './usage.ts'

const ATTACH_MIN_WIDTH = 5
const ATTACH_MIN_BODY_LINES = 3
const ATTACH_HEIGHT_FRACTION = 2
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const ATTACH_PROJECTION_KEYS = ['blueConversation', 'blueConversationFacts', 'subagentTiming'] as const

/** Translatable attach-view chrome. */
export const ATTACH_CHROME = Object.freeze({
  prompt: '› ',
  placeholder: 'Say to this subagent…',
  oneShotReadonly: 'one-shot subagent — read-only',
  guidanceFollowup: 'Enter follow up · Ctrl+C interrupt · q back',
  guidanceBack: 'q back',
  unavailable: 'attach view is unavailable: the Blue screen is not mounted',
})

interface ConversationFactsValue {
  readonly active?: unknown
  readonly epochTokens?: unknown
}

interface SubagentTimingValue {
  readonly settledMs?: unknown
  readonly active?: { readonly since?: unknown } | undefined
}

/** Child descriptor selected by `/agents`. */
export interface BlueChildAttachTarget {
  readonly id: string
  readonly label?: string | undefined
  readonly mode: 'one-shot' | 'continuable'
}

/** Elapsed format shared with the agent group. */
export function formatAttachElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

interface AttachMetrics {
  readonly tokens?: number | undefined
  readonly settledMs?: number | undefined
  readonly activeSince?: number | undefined
}

/** Format optional token and elapsed metrics. */
export function attachMetricsText(metrics: AttachMetrics, now: number): string {
  const parts: string[] = []
  if (metrics.tokens !== undefined) parts.push(`${formatTokens(metrics.tokens)} tok`)
  const elapsed = metrics.activeSince !== undefined ? now - metrics.activeSince : metrics.settledMs
  if (elapsed !== undefined) parts.push(formatAttachElapsed(elapsed))
  return parts.join(' · ')
}

export interface ChildAttachViewOptions {
  readonly ctx: Context
  readonly parent: Agent
  readonly target: BlueChildAttachTarget
  readonly screen: BlueScreen
  readonly components: BlueComponents
  readonly colors: BlueSemanticColors
  readonly t: BlueTranslate
  readonly tools: ToolPresentationSource
  readonly onClose: () => void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One native projection cut, live or observed from persistence. */
interface ChildProjectionCut {
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, unknown>>
}

/** Framed child transcript with follow-up, interrupt, and local scrolling. */
export class ChildAttachView implements BlueFocusable {
  focused = false
  private readonly transcript: TranscriptModelComponent
  private model: TranscriptModel
  private readonly watermarks = new Map<string, number>()
  private running = false
  private tokens: number | undefined
  private settledMs: number | undefined
  private activeSince: number | undefined
  private buffer = ''
  private note: string | undefined
  private disposed = false
  private opened = false
  private scrollOffset = 0
  private bodyTotal = 0
  private offChild: (() => void) | undefined
  private ticker: ReturnType<typeof setInterval> | undefined
  private readonly abort = new AbortController()

  constructor(private readonly options: ChildAttachViewOptions) {
    this.model = createTranscriptModel(`attach-${options.target.id}`, [], false)
    const renderer: TranscriptModelRenderer = {
      colors: options.colors,
      components: options.components,
      images: () => ({}),
      requestRender: options.screen.requestRender.bind(options.screen),
    }
    this.transcript = new TranscriptModelComponent(() => this.model, renderer)
  }

  private get childId(): string { return this.options.target.id }
  private get continuable(): boolean { return this.options.target.mode === 'continuable' }

  /** Subscribe before seeding so a late cold cut cannot overwrite live data. */
  open(): void {
    if (this.opened || this.disposed) return
    this.opened = true
    this.offChild = this.options.ctx.sessionProjections.onChanged((session, key, value, seq) => {
      if (this.disposed || String(session.id) !== this.childId || !ATTACH_PROJECTION_KEYS.includes(key as never)) return
      if (seq <= (this.watermarks.get(key) ?? -1)) return
      this.watermarks.set(key, seq)
      this.applyValue(key, value)
      this.invalidate()
    })
    void this.seed().then(cut => {
      if (this.disposed || cut === undefined) return
      for (const key of ATTACH_PROJECTION_KEYS) {
        if (cut.asOfSeq <= (this.watermarks.get(key) ?? -1)) continue
        this.watermarks.set(key, cut.asOfSeq)
        this.applyValue(key, cut.values[key])
      }
      this.invalidate()
    }, error => {
      if (this.disposed || this.abort.signal.aborted) return
      this.note = describe(error)
      this.invalidate()
    })
  }

  private async seed(): Promise<ChildProjectionCut | undefined> {
    const { ctx, parent } = this.options
    const tree = await ctx.subagents.listDescendants(parent.id, this.abort.signal)
    if (ctx.blueCurrentAgent.current() !== parent) return undefined
    if (!tree.some(entry => String(entry.id) === this.childId)) {
      throw new Error(`session ${this.childId} is not in the current session's subagent tree`)
    }
    const live = [...ctx.sessions.list()].find(session => String(session.id) === this.childId)
    if (live !== undefined) return this.snapshot(live)
    const query = ctx.get('sessionQuery')
    if (query === undefined) throw new Error('the child session is not live and the host composes no session query service')
    const observation = await query.observeSession(SessionId(this.childId), {
      projectionMode: 'all',
      signal: this.abort.signal,
    })
    try {
      if (ctx.blueCurrentAgent.current() !== parent) return undefined
      return {
        asOfSeq: observation.projections?.asOfSeq ?? -1,
        values: observation.projections?.values ?? {},
      }
    } finally {
      observation[Symbol.dispose]()
    }
  }

  private snapshot(session: Session): ChildProjectionCut {
    const snapshot = this.options.ctx.sessionProjections.snapshot(session, [...ATTACH_PROJECTION_KEYS])
    return { asOfSeq: snapshot.asOfSeq, values: snapshot.values }
  }

  /** Release listeners, timers, pending reads, and transcript components. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort()
    this.offChild?.()
    this.disarmTicker()
    this.transcript.dispose()
  }

  private disarmTicker(): void {
    if (this.ticker === undefined) return
    clearInterval(this.ticker)
    this.ticker = undefined
  }

  private applyValue(key: string, value: unknown): void {
    if (key === 'blueConversation') {
      const parsed = conversationProjectionSchema.safeParse(value)
      if (parsed.success) this.model = conversationTranscriptModel(parsed.data, this.options.tools)
      return
    }
    if (key === 'blueConversationFacts') {
      const facts = value as ConversationFactsValue | undefined
      if (typeof facts?.epochTokens === 'number') this.tokens = facts.epochTokens
      if (typeof facts?.active === 'boolean') this.running = facts.active
      this.armTicker()
      return
    }
    if (key !== 'subagentTiming' || value === undefined || value === null) return
    const timing = value as SubagentTimingValue
    if (typeof timing.settledMs === 'number') this.settledMs = timing.settledMs
    if (typeof timing.active?.since === 'number') this.activeSince = timing.active.since
    this.running = timing.active !== undefined && timing.active !== null
    this.armTicker()
  }

  private armTicker(): void {
    if (this.ticker !== undefined || !this.running) return
    this.ticker = setInterval(() => {
      if (!this.running) {
        this.disarmTicker()
        return
      }
      this.invalidate()
    }, 1000)
    this.ticker.unref()
  }

  private close(): void {
    this.dispose()
    this.options.onClose()
  }

  handleInput(data: string): void {
    if (this.disposed) return
    if (data === '\x03') {
      if (this.buffer !== '') {
        this.buffer = ''
      } else {
        try {
          this.options.ctx.subagents.interrupt(SessionId(this.childId), { kind: 'ancestor', agent: this.options.parent })
          this.note = undefined
        } catch (error) {
          this.note = describe(error)
        }
      }
      this.invalidate()
      return
    }
    if (data === '\x1b' || (data === 'q' && this.buffer === '')) {
      this.close()
      return
    }
    if (data === KEY_UP || data === KEY_DOWN) {
      this.scrollBy(data === KEY_UP ? 1 : -1)
      return
    }
    if (data === KEY_PAGE_UP || data === KEY_PAGE_DOWN) {
      this.scrollBy((data === KEY_PAGE_UP ? 1 : -1) * Math.max(1, this.bodyBudget() - 1))
      return
    }
    if (!this.continuable) return
    if (data === '\r') {
      const text = this.buffer.trim()
      if (text === '') return
      this.buffer = ''
      this.note = undefined
      void this.options.ctx.subagents.followup(
        this.options.parent,
        SessionId(this.childId),
        [{ type: 'text', text }],
        { source: { kind: 'user' }, signal: this.abort.signal },
      ).then(() => {
        if (!this.disposed) this.invalidate()
      }, error => {
        if (this.disposed || this.abort.signal.aborted) return
        this.note = describe(error)
        this.invalidate()
      })
      this.invalidate()
      return
    }
    if (data === '\x7f') {
      this.buffer = this.buffer.slice(0, -1)
      this.invalidate()
      return
    }
    if (data.startsWith('\x1b') || /[\x00-\x1f\x7f]/.test(data)) return
    this.buffer += data
    this.invalidate()
  }

  invalidate(): void { this.options.screen.requestRender() }

  private scrollBy(delta: number): void {
    const maxOffset = Math.max(0, this.bodyTotal - this.bodyBudget())
    const next = Math.min(maxOffset, Math.max(0, this.scrollOffset + delta))
    if (next === this.scrollOffset) return
    this.scrollOffset = next
    this.invalidate()
  }

  render(width: number): string[] {
    if (width < ATTACH_MIN_WIDTH) return []
    const { colors, components, t } = this.options
    const contentWidth = Math.max(1, width - 4)
    const label = this.options.target.label ?? this.options.target.id
    const status = this.running ? `● ${t('running')}` : `○ ${t('idle')}`
    const metrics = attachMetricsText({
      ...(this.tokens === undefined ? {} : { tokens: this.tokens }),
      ...(this.settledMs === undefined ? {} : { settledMs: this.settledMs }),
      ...(this.activeSince === undefined ? {} : { activeSince: this.activeSince }),
    }, Date.now())
    const hint = [status, ...(metrics === '' ? [] : [metrics])].join(' · ')
    const lines = [components.topRule(width, {
      title: colors.primary(` ${t('Subagent')} · ${label} `),
      hint: colors.textMuted(`${hint} `),
      paint: colors.border,
    })]
    const budget = this.bodyBudget()
    const all = this.transcript.render(contentWidth)
    if (this.scrollOffset > 0 && all.length > this.bodyTotal) this.scrollOffset += all.length - this.bodyTotal
    this.bodyTotal = all.length
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, all.length - budget))
    const end = all.length - this.scrollOffset
    const body = all.slice(Math.max(0, end - budget), end)
    while (body.length < budget) body.push('')
    for (const line of body) lines.push(this.frame(line, contentWidth))
    const footer = this.continuable
      ? `${colors.roleUser(ATTACH_CHROME.prompt)}${this.buffer === '' ? colors.muted(t(ATTACH_CHROME.placeholder)) : `${this.buffer}▌`}`
      : colors.muted(t(ATTACH_CHROME.oneShotReadonly))
    lines.push(this.frame(footer, contentWidth))
    const guidance = this.note ?? (this.continuable
      ? `continuable · ${t(ATTACH_CHROME.guidanceFollowup)}`
      : `one-shot · ${t(ATTACH_CHROME.guidanceBack)}`)
    lines.push(this.frame(colors.textMuted(guidance), contentWidth))
    return lines
  }

  private bodyBudget(): number {
    const rows = this.options.screen.rows
    if (!Number.isFinite(rows) || rows <= 0) return ATTACH_MIN_BODY_LINES
    return Math.max(ATTACH_MIN_BODY_LINES, Math.floor(rows / ATTACH_HEIGHT_FRACTION) - 2)
  }

  private frame(line: string, width: number): string {
    const { colors, components } = this.options
    const clipped = components.truncateToWidth(line, width, '…')
    const padding = Math.max(0, width - components.visibleWidth(clipped))
    return colors.border('│') + ' ' + clipped + ' '.repeat(padding) + ' ' + colors.border('│')
  }
}

/** Mounted attach handle owned by the `/agents` command. */
export interface ChildAttachHandle {
  close(): void
}

/** Mount one child attach view into the editor slot. */
export function mountChildAttach(
  ctx: Context,
  parent: Agent,
  child: BlueChildAttachTarget,
  onClosed: () => void,
): ChildAttachHandle | undefined {
  const display = displayServices(ctx)
  if (display === undefined) return undefined
  const t = interactionTranslator(ctx)
  const childAgent = ctx.agents.get(SessionId(child.id))
  const tools: ToolPresentationSource = {
    get: name => ctx.tools.get(name, childAgent ?? undefined),
  }
  let closed = false
  let restore: (() => void) | undefined
  const close = (): void => {
    if (closed) return
    closed = true
    view.dispose()
    restore?.()
    onClosed()
  }
  const view = new ChildAttachView({
    ctx,
    parent,
    target: child,
    ...display,
    t,
    tools,
    onClose: close,
  })
  restore = mountEditorReplacement(ctx, view)
  view.open()
  return { close }
}
