/**
 * `blue-attach-view` plugin: the `blueChildAttach` service owning the
 * child-session attach view. `open` swaps the editor slot (D30) for a framed
 * panel rendering one subagent-tree member's transcript through the same
 * `TranscriptModelComponent`/`conversationTranscriptModel` pipeline as the
 * main conversation: `blueSessionProjections.childCut` seeds the initial
 * (possibly cold) value, `subscribeChild` follows live pushes, and the title
 * rule carries the label, run state, tokens, and elapsed time derived from
 * the child's `blueConversationFacts`/`subagentTiming` projections. A
 * continuable child gets a bottom input row whose submit crosses
 * `blueSessionActions.childFollowup`; a one-shot child degrades to
 * read-only with an explanatory footer. While the view is focused, Up/Down
 * (also the wheel, which core's dock route normalizes to arrows) and
 * PageUp/PageDown scroll the transcript window: the viewport tail-follows
 * at the bottom and holds its rows stable under live pushes when scrolled
 * up; text, cursor, and submit keys stay with the input row. Ctrl+C clears
 * a pending follow-up first and otherwise interrupts the child through
 * `interruptChild`; q/Escape closes. The current session never switches — the child is
 * addressed by (current session, child id) — while a main-session switch,
 * session unload, or fiber unload force-closes the view and restores the
 * pre-attach editor (buffer and draft survive the swap). At most one attach
 * is live at a time: a repeat `open` closes the old view first. Chrome copy
 * translates through the interaction locale catalog ({@link ATTACH_CHROME}
 * keeps the English source strings, which double as the catalog keys);
 * user/domain text (labels, ids, upstream error messages) is never
 * translated as UI chrome.
 *
 * @module @dsh-blue/blue-interaction/attach-view
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  BlueComponents,
  BlueFocusable,
  BlueScreen,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import type { TranscriptModel, BlueTranslate } from '@dsh-blue/blue-frontend'
// The named type imports also carry the app-owned session service Context merges.
import type {
  BlueSessionActions,
  BlueSessionProjectionReader,
} from '@dsh-blue/blue-app'
import { conversationProjectionSchema } from '@dsh-blue/blue-conversation'
import {
  conversationTranscriptModel,
  createTranscriptModel,
  TranscriptModelComponent,
  type ToolPresentationSource,
  type TranscriptModelRenderer,
} from '@dsh-blue/blue-transcript'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { interactionTranslator } from './locale.ts'
import { formatTokens } from './usage.ts'

/**
 * Below this viewport width the attach view renders nothing rather than
 * overflow: the frame furniture (`│ x │`) alone needs five columns.
 */
const ATTACH_MIN_WIDTH = 5

/** The attach body never renders shorter than this (the btw-pane precedent). */
const ATTACH_MIN_BODY_LINES = 3

/** The attach panel may occupy at most this fraction of the terminal height. */
const ATTACH_HEIGHT_FRACTION = 2

/**
 * Scroll keys the attach viewport consumes while focused. The panel is
 * focused in the editor dock, so core already delivers these — plus the
 * wheel, normalized to Up/Down by the terminal's bottom-dock route — instead
 * of the main transcript's viewport (the `terminal.ts` contextual chain).
 */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'

/** Projection keys one attach view reads and follows. */
const ATTACH_PROJECTION_KEYS = ['blueConversation', 'blueConversationFacts', 'subagentTiming'] as const

/**
 * The attach view's chrome copy (English source strings doubling as the
 * interaction locale catalog keys). Title, status, and guidance assemble
 * from smaller keys at render time — the status dots, the `·` separators,
 * and the guidance mode prefixes (`continuable`, `one-shot`) stay literal
 * chrome, never translated.
 */
export const ATTACH_CHROME = Object.freeze({
  prompt: '› ',
  placeholder: 'Say to this subagent…',
  oneShotReadonly: 'one-shot subagent — read-only',
  guidanceFollowup: 'Enter follow up · Ctrl+C interrupt · q back',
  guidanceBack: 'q back',
  unavailable: 'attach view is unavailable: the Blue screen is not mounted',
})

/** The projected conversation-facts shape this view reads (structural). */
interface ConversationFactsValue {
  readonly epochTokens?: unknown
}

/** The projected subagent-timing shape this view reads (structural). */
interface SubagentTimingValue {
  readonly settledMs?: unknown
  readonly active?: { readonly since?: unknown } | undefined
}

/**
 * The child session one `open` attaches to. The descriptor carries only what
 * the caller (e.g. the `/agents` tree browser) already knows; run state and
 * metrics arrive through the child's projections.
 */
export interface BlueChildAttachTarget {
  readonly id: string
  readonly label?: string | undefined
  readonly mode: 'one-shot' | 'continuable'
}

/**
 * The attach-view owner registered by the `blue-attach-view` plugin as
 * `ctx.blueChildAttach`.
 */
export interface BlueChildAttachService {
  /** Whether an attach view is currently mounted. */
  readonly active: boolean
  /**
   * Attach to one child of the current session. A repeat call closes the
   * previous attach first; when the display services are absent the call is
   * a no-op (noticing through the shared editor when one is live).
   * @param child - the child descriptor from the subagent tree.
   */
  open(child: BlueChildAttachTarget): void
  /** Close the live attach view, restoring the pre-attach editor slot. */
  close(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { blueChildAttach: BlueChildAttachService }
}

/** Elapsed format (the agent-group convention): `45s`, or `2m 10s` past a minute. */
export function formatAttachElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`
}

/** The token/elapsed facts one attach view tracks from the child projections. */
interface AttachMetrics {
  readonly tokens?: number | undefined
  readonly settledMs?: number | undefined
  readonly activeSince?: number | undefined
}

/** One metrics summary (`12.3k tok · 3m 42s`), omitting absent facts. */
export function attachMetricsText(metrics: AttachMetrics, now: number): string {
  const parts: string[] = []
  if (metrics.tokens !== undefined) parts.push(`${formatTokens(metrics.tokens)} tok`)
  const elapsed = metrics.activeSince !== undefined ? now - metrics.activeSince : metrics.settledMs
  if (elapsed !== undefined) parts.push(formatAttachElapsed(elapsed))
  return parts.join(' · ')
}

/** Construction options for {@link ChildAttachView}. */
export interface ChildAttachViewOptions {
  /** The child being attached; fixes id, label, and mode. */
  readonly target: BlueChildAttachTarget
  readonly screen: BlueScreen
  readonly components: BlueComponents
  readonly colors: BlueSemanticColors
  /** The interaction-catalog translator the chrome copy renders through. */
  readonly t: BlueTranslate
  /** The app-owned projection reader seam (`childCut` + `subscribeChild`). */
  readonly projections: BlueSessionProjectionReader
  /** The app-owned child-addressed action seam (`childFollowup` + `interruptChild`). */
  readonly actions: BlueSessionActions
  /** The tool-presenter view the transcript model resolves cards against. */
  readonly tools: ToolPresentationSource
  /** Close hook: the owner restores the pre-attach editor slot. */
  readonly onClose: () => void
}

/**
 * The attach view: one child session's transcript framed in the editor slot.
 * The viewport tail-follows while pinned to the bottom; Up/Down (also the
 * wheel, arriving as arrows), PageUp/PageDown scroll the transcript window
 * inside the frame and a live push keeps a scrolled-away viewport stable.
 * Every subscription and the elapsed ticker release on
 * {@link ChildAttachView.dispose}.
 */
export class ChildAttachView implements BlueFocusable {
  focused = false
  private readonly transcript: TranscriptModelComponent
  private model: TranscriptModel
  private watermark = -1
  private running = false
  private tokens: number | undefined
  private settledMs: number | undefined
  private activeSince: number | undefined
  private buffer = ''
  private note: string | undefined
  private disposed = false
  private opened = false
  /** Rows scrolled up from the transcript tail; 0 pins the viewport to it. */
  private scrollOffset = 0
  /** The transcript row count from the latest render; clamps the offset. */
  private bodyTotal = 0
  private offChild: (() => void) | undefined
  private ticker: ReturnType<typeof setInterval> | undefined
  private readonly requestRender: () => void

  constructor(private readonly options: ChildAttachViewOptions) {
    this.model = createTranscriptModel(`attach-${options.target.id}`, [], false)
    const requestRender = (): void => {
      options.screen.requestRender()
    }
    this.requestRender = requestRender
    const renderer: TranscriptModelRenderer = {
      colors: options.colors,
      components: options.components,
      images: () => ({}),
      requestRender,
    }
    this.transcript = new TranscriptModelComponent(() => this.model, renderer)
  }

  private get childId(): string {
    return this.options.target.id
  }

  private get continuable(): boolean {
    return this.options.target.mode === 'continuable'
  }

  /**
   * Read the initial (possibly cold) projection cut, then follow live
   * pushes. Idempotent; safe to call right after mounting. A failed cut
   * surfaces its message in the footer; a rejecting cut is swallowed.
   */
  open(): void {
    if (this.opened || this.disposed) return
    this.opened = true
    void this.options.projections.childCut(this.childId, [...ATTACH_PROJECTION_KEYS]).then(cut => {
      if (this.disposed) return
      if (!cut.ok) {
        this.note = cut.message
        this.invalidate()
        return
      }
      this.watermark = cut.value.asOfSeq
      this.applyValue('blueConversation', cut.value.values['blueConversation'])
      this.applyValue('blueConversationFacts', cut.value.values['blueConversationFacts'])
      this.applyValue('subagentTiming', cut.value.values['subagentTiming'])
      this.invalidate()
    }, () => {})
    this.offChild = this.options.projections.subscribeChild(this.childId, (key, value, seq) => {
      if (this.disposed || seq <= this.watermark) return
      this.watermark = seq
      this.applyValue(key, value)
      this.invalidate()
    })
    this.armTicker()
  }

  /** Release the subscription and the elapsed ticker; later input is ignored. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.offChild?.()
    this.disarmTicker()
  }

  /** Stop the elapsed ticker, if armed. */
  private disarmTicker(): void {
    if (this.ticker === undefined) return
    clearInterval(this.ticker)
    this.ticker = undefined
  }

  /** Rebuild the transcript model or the metrics from one projection value. */
  private applyValue(key: string, value: unknown): void {
    if (key === 'blueConversation') {
      const parsed = conversationProjectionSchema.safeParse(value)
      if (!parsed.success) return
      this.model = conversationTranscriptModel(parsed.data, this.options.tools)
      return
    }
    if (key === 'blueConversationFacts') {
      const facts = value as ConversationFactsValue | undefined
      if (typeof facts?.epochTokens === 'number') this.tokens = facts.epochTokens
      return
    }
    if (key !== 'subagentTiming') return
    // An absent timing value (a cold cut without the projection) keeps the
    // seeded idle state; only a folded value arbitrates running state.
    if (value === undefined || value === null) return
    const timing = value as SubagentTimingValue
    if (typeof timing.settledMs === 'number') this.settledMs = timing.settledMs
    if (typeof timing.active?.since === 'number') this.activeSince = timing.active.since
    this.running = timing.active !== undefined && timing.active !== null
    this.armTicker()
  }

  /** The elapsed ticker runs only while the child has an open turn. */
  private armTicker(): void {
    if (this.ticker !== undefined || !this.running) return
    this.ticker = setInterval(() => {
      if (!this.running) {
        this.disarmTicker()
        return
      }
      this.invalidate()
    }, 1000)
  }

  private close(): void {
    this.dispose()
    this.options.onClose()
  }

  handleInput(data: string): void {
    if (this.disposed) return
    if (data === '\x03') {
      // Ctrl+C clears a pending follow-up first, then interrupts the child.
      if (this.buffer !== '') {
        this.buffer = ''
        this.invalidate()
        return
      }
      const result = this.options.actions.interruptChild(this.childId)
      this.note = result.ok ? undefined : result.message
      this.invalidate()
      return
    }
    if (data === '\x1b' || (data === 'q' && this.buffer === '')) {
      this.close()
      return
    }
    // Scroll keys own the transcript viewport in both modes — while the
    // panel is focused they never reach editor history (the /sessions panel
    // precedent), and the input row keeps only text, cursor, and submit.
    if (data === KEY_UP) {
      this.scrollBy(1)
      return
    }
    if (data === KEY_DOWN) {
      this.scrollBy(-1)
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
      void this.options.actions.childFollowup(this.childId, [{ type: 'text', text }]).then(result => {
        if (this.disposed) return
        if (!result.ok) this.note = result.message
        this.invalidate()
      }, () => {})
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

  invalidate(): void {
    this.requestRender()
  }

  /**
   * Move the transcript viewport by `delta` rows (positive scrolls toward
   * older rows), clamped to both bounds; at a bound the key is a no-op. The
   * clamp reads the latest rendered row count, so scrolling is inert until
   * the first frame laid the transcript out.
   */
  private scrollBy(delta: number): void {
    const maxOffset = Math.max(0, this.bodyTotal - this.bodyBudget())
    const next = Math.min(maxOffset, Math.max(0, this.scrollOffset + delta))
    if (next === this.scrollOffset) return
    this.scrollOffset = next
    this.invalidate()
  }

  /**
   * The framed panel rows: the `topRule` title/hint, the tail of the child
   * transcript padded to a stable height, and the footer (input row for a
   * continuable child, an explanatory line for a one-shot) above the
   * guidance row.
   * @param width - current viewport width in columns.
   * @returns the panel rows, or none below the minimum width.
   */
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
    // A live push appends below a scrolled viewport: carry the offset down
    // with the growth so the visible rows hold stable (the tail viewport,
    // offset 0, follows instead).
    if (this.scrollOffset > 0 && all.length > this.bodyTotal) {
      this.scrollOffset += all.length - this.bodyTotal
    }
    this.bodyTotal = all.length
    // Re-clamp against the freshest row count (a model rebuild can shrink
    // the transcript under a scrolled viewport), then window the body.
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, all.length - budget))
    const end = all.length - this.scrollOffset
    const body = all.slice(Math.max(0, end - budget), end)
    // Pad to the full budget so the panel height never jitters as content grows.
    while (body.length < budget) body.push('')
    for (const line of body) lines.push(this.frame(line, contentWidth))
    const footer = this.continuable
      ? `${colors.roleUser(ATTACH_CHROME.prompt)}${this.buffer === '' ? colors.muted(t(ATTACH_CHROME.placeholder)) : `${this.buffer}▌`}`
      : colors.muted(t(ATTACH_CHROME.oneShotReadonly))
    lines.push(this.frame(footer, contentWidth))
    const guidance = this.note ?? (this.continuable ? `continuable · ${t(ATTACH_CHROME.guidanceFollowup)}` : `one-shot · ${t(ATTACH_CHROME.guidanceBack)}`)
    lines.push(this.frame(colors.textMuted(guidance), contentWidth))
    return lines
  }

  /** The body row budget: at most half the terminal, at least the floor. */
  private bodyBudget(): number {
    const rows = this.options.screen.rows
    if (!Number.isFinite(rows) || rows <= 0) return ATTACH_MIN_BODY_LINES
    return Math.max(ATTACH_MIN_BODY_LINES, Math.floor(rows / ATTACH_HEIGHT_FRACTION) - 2)
  }

  /** Frame one content row with the border columns, ANSI-safe. */
  private frame(line: string, width: number): string {
    const { colors, components } = this.options
    const clipped = components.truncateToWidth(line, width, '…')
    const padding = Math.max(0, width - components.visibleWidth(clipped))
    return colors.border('│') + ' ' + clipped + ' '.repeat(padding) + ' ' + colors.border('│')
  }
}

/**
 * The `blueChildAttach` service implementation. State is fiber-owned: the
 * session-switch guard and the live attach both release with the plugin.
 */
class ChildAttachService extends Service implements BlueChildAttachService {
  private current: { readonly view: ChildAttachView, readonly restore: () => void } | undefined
  private readonly t: BlueTranslate

  constructor(ctx: Context) {
    super(ctx, 'blueChildAttach')
    this.t = interactionTranslator(ctx)
    // The view addresses (current session, child id): a main-session switch
    // or unload strands it, so force-close and restore the editor slot.
    let sessionId = ctx.blueSessionReader.current()?.id
    const registration = ctx.blueSessionReader.subscribe(snapshot => {
      const next = snapshot?.id
      if (next === sessionId) return
      sessionId = next
      this.close()
    })
    ctx.effect(() => () => {
      registration.dispose()
      this.close()
    })
  }

  get active(): boolean {
    return this.current !== undefined
  }

  open(child: BlueChildAttachTarget): void {
    // At most one attach is live: a repeat open closes the old view first.
    this.close()
    const display = displayServices(this.ctx)
    if (display === undefined) {
      getSharedEditor(this.ctx)?.notice?.(this.t(ATTACH_CHROME.unavailable))
      return
    }
    // Tool presentations are additive: without the seam the child transcript
    // renders the generic fallback cards.
    const tools = this.ctx.get('blueToolPresentations') as ToolPresentationSource | undefined
      ?? { get: () => undefined }
    const view = new ChildAttachView({
      target: child,
      screen: display.screen,
      components: display.components,
      colors: display.colors,
      t: this.t,
      projections: this.ctx.blueSessionProjections,
      actions: this.ctx.blueSessionActions,
      tools,
      onClose: () => {
        this.close()
      },
    })
    const restore = mountEditorReplacement(this.ctx, view)
    this.current = { view, restore }
    view.open()
  }

  close(): void {
    const current = this.current
    if (current === undefined) return
    this.current = undefined
    current.view.dispose()
    current.restore()
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-attach-view'

/** Services required before the attach owner can register. */
export const inject = ['blueSessionReader', 'blueSessionProjections', 'blueSessionActions', 'blueEditorHost']

/**
 * Register the `blueChildAttach` service; the session guard and any live
 * attach view are effect-bound, so a fiber unload restores the pre-attach
 * editor state.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  new ChildAttachService(ctx)
}
