/**
 * Renderer-neutral transcript model registry and the semantic TUI consumer.
 * Producers supply projected entries; this module owns only component
 * reconciliation, bounded mounting, width-safe rendering, and screen change
 * notification.
 *
 * @module @dsh-blue/blue-transcript/transcript-model
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { BlueUiNode } from '@dsh-blue/blue-api'
import {
  GutterComponent,
  type BlueComponent,
  type BlueComponents,
  type BlueScreen,
  type BlueSemanticColors,
} from '@dsh-blue/blue-core'
import {
  freezeModel,
  type TranscriptEntryModel,
  type TranscriptImageModel,
  type TranscriptModel,
  type TranscriptToolModel,
  type BlueTranslate,
} from '@dsh-blue/blue-frontend'
import {
  AssistantMessageComponent,
  ErrorMessageComponent,
  InterruptedMarkerComponent,
  ToolCallComponent,
  UserMessageComponent,
  type UserMessageImages,
} from './components.ts'
import { ThinkingComponent } from './thinking.ts'
import { ToolModelComponent, toolResultChip } from './tool-model.ts'
import { ReadGroupComponent, groupReadsByFile } from './read-group.ts'
import { SearchGroupComponent } from './search-group.ts'
import { parseToolArguments, summarizeToolCall } from './present.ts'
import { summarizeToolText } from './envelope.ts'
import { renderCanonicalNode, type CanonicalNodeRenderer } from './canonical-node-renderer.ts'
import type { TranscriptToolItem } from './types.ts'
import {
  DEFAULT_TRANSCRIPT_PRESENTATION,
  type TranscriptPresentationPolicy,
  type TranscriptPresentationSnapshot,
} from './presentation-policy.ts'

interface ExpandableComponent extends BlueComponent { setExpanded?(expanded: boolean): void }

declare module '@deepseek-ai/cordis' { interface Context { blueTranscriptModels: TranscriptModelService } }
type Source = TranscriptModel | (() => TranscriptModel | null)

/** Maximum semantic entries mounted by one transcript model component. */
export const TRANSCRIPT_MODEL_WINDOW = 200

/** Renderer-only dependencies for semantic transcript entries. */
export interface TranscriptModelRenderer extends CanonicalNodeRenderer {
  readonly colors: BlueSemanticColors
  readonly components: BlueComponents
  readonly images: () => UserMessageImages
  readonly requestRender: () => void
  readonly presentation?: TranscriptPresentationPolicy
  /** Dynamic translator for transcript-owned renderer chrome. */
  readonly t?: BlueTranslate
  /** Disable semantic component chrome while retaining canonical width-safe rendering. */
  readonly semantic?: boolean
}

/** Optional service hooks used by the legacy/plain fallback owner. */
export interface TranscriptModelServiceHooks {
  readonly renderer?: TranscriptModelRenderer
  readonly onPresenceChanged?: (present: boolean) => void
}

/** Build an immutable transcript model from already-projected entries. */
export function createTranscriptModel(
  id: string,
  entries: readonly (BlueUiNode | TranscriptEntryModel)[],
  streaming?: boolean,
): TranscriptModel {
  return freezeModel({ kind: 'transcript', id, entries: [...entries], ...(streaming === undefined ? {} : { streaming }) })
}

/** Append one projected canonical node or semantic entry without folding events. */
export function appendTranscriptNode(
  model: TranscriptModel,
  entry: BlueUiNode | TranscriptEntryModel,
  streaming = model.streaming,
): TranscriptModel {
  return createTranscriptModel(model.id, [...model.entries, entry], streaming)
}

function isSemantic(entry: BlueUiNode | TranscriptEntryModel): entry is TranscriptEntryModel {
  return entry.kind.startsWith('transcript-')
}

function asToolItem(entry: TranscriptToolModel): TranscriptToolItem {
  const parsedArguments = parseToolArguments(entry.arguments)
  return {
    kind: 'tool',
    seq: entry.seq,
    turn: entry.turn,
    step: entry.step,
    callId: entry.callId,
    name: entry.name,
    arguments: entry.arguments,
    ...(parsedArguments === undefined ? {} : { parsedArguments }),
    startedAt: entry.startedAt,
    ...(entry.result === undefined ? {} : { result: entry.result }),
  }
}

function asImageRef(image: TranscriptImageModel): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
    ...(image.originalDimensions === undefined ? {} : {
      originalDimensions: { ...image.originalDimensions },
    }),
  }
}

function signature(entry: TranscriptEntryModel): string {
  return JSON.stringify(entry)
}

interface CachedComponent {
  readonly signature: string
  readonly component: BlueComponent
  readonly target: BlueComponent
}

interface RenderedRowsCache {
  readonly model: TranscriptModel
  readonly width: number
  readonly expanded: boolean
  readonly policy: TranscriptPresentationSnapshot
  readonly rows: string[]
}

/** Bounded semantic transcript component with id-based reconciliation. */
export class TranscriptModelComponent implements BlueComponent {
  private readonly cached = new Map<string, CachedComponent>()
  private expanded = false
  private renderedRows: RenderedRowsCache | undefined

  constructor(
    private readonly source: () => TranscriptModel | null,
    private readonly renderer: TranscriptModelRenderer,
  ) {}

  render(width: number): string[] {
    const model = this.source()
    if (model === null) {
      this.renderedRows = undefined
      this.prune(new Set())
      return []
    }
    const bounded = model.entries.slice(-TRANSCRIPT_MODEL_WINDOW)
    const policy = this.presentation()
    const rendered = this.renderedRows
    if (rendered?.model === model
      && rendered.width === width
      && rendered.expanded === this.expanded
      && rendered.policy === policy) return rendered.rows
    const turns = [...new Set(bounded.filter(isSemantic).map(entry => entry.turn))]
    const visibleTurns = new Set(turns.slice(-policy.windowTurns))
    const entries = bounded.filter(entry => !isSemantic(entry) || visibleTurns.has(entry.turn))
    const expandableTurns = new Set(turns.slice(-policy.expandTurns))
    const live = new Set(entries.filter(isSemantic).map(entry => entry.id))
    this.prune(live)
    const rows = entries.flatMap(entry => isSemantic(entry)
      ? this.renderSemantic(entry, width, expandableTurns.has(entry.turn))
      : renderCanonicalNode(entry, width, this.renderer))
    this.renderedRows = { model, width, expanded: this.expanded, policy, rows }
    return rows
  }

  /** Apply the global recent-detail expansion state to mounted entries. */
  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return
    this.expanded = expanded
    this.renderedRows = undefined
    for (const { target } of this.cached.values()) target.invalidate()
  }

  invalidate(): void {
    this.renderedRows = undefined
    for (const { component } of this.cached.values()) component.invalidate()
  }

  /** Dispose timers and async renderer resources held by cached components. */
  dispose(): void {
    this.renderedRows = undefined
    this.prune(new Set())
  }

  private renderSemantic(entry: TranscriptEntryModel, width: number, expandable: boolean): string[] {
    if (this.renderer.semantic === false) return renderCanonicalNode({ kind: 'text', content: this.plainText(entry) }, width, this.renderer)
    const currentSignature = signature(entry)
    let cached = this.cached.get(entry.id)
    if (cached?.signature !== currentSignature) {
      if (cached !== undefined) this.disposeComponent(cached.target)
      const target = this.createComponent(entry)
      cached = { signature: currentSignature, target, component: new GutterComponent(target) }
      this.cached.set(entry.id, cached)
    }
    this.applyExpansion(cached.target, entry, expandable)
    return cached.component.render(width)
  }

  /** Current tree policy, or immutable shipped defaults for standalone consumers. */
  private presentation(): TranscriptPresentationSnapshot {
    return this.renderer?.presentation?.snapshot() ?? DEFAULT_TRANSCRIPT_PRESENTATION
  }

  /** Compose Ctrl-O's recent-turn override over category defaults. */
  private applyExpansion(target: BlueComponent, entry: TranscriptEntryModel, expandable: boolean): void {
    const policy = this.presentation()
    const expanded = this.expanded && expandable
      ? true
      : entry.kind === 'transcript-thinking'
        ? policy.thinkingExpanded
        : entry.kind === 'transcript-tool' || entry.kind === 'transcript-read-group' || entry.kind === 'transcript-search-group'
          ? policy.toolsExpanded
          : false
    ;(target as ExpandableComponent).setExpanded?.(expanded)
  }

  private createComponent(entry: TranscriptEntryModel): BlueComponent {
    const renderer = this.renderer
    switch (entry.kind) {
      case 'transcript-user': {
        const images = renderer.images()
        const component = new UserMessageComponent({
          kind: 'user', seq: entry.seq, turn: entry.turn, text: entry.text, images: entry.images.map(asImageRef),
        }, renderer.colors, renderer.components, {
          ...images,
          onReady: () => {
            this.invalidate()
            images.onReady?.()
          },
          presentation: () => this.presentation(),
          ...(renderer.t === undefined ? {} : { t: renderer.t }),
        })
        return component
      }
      case 'transcript-assistant':
        return new AssistantMessageComponent({
          kind: 'assistant', seq: entry.seq, turn: entry.turn, step: entry.step, text: entry.text,
        }, renderer.colors, renderer.components)
      case 'transcript-thinking': {
        const component = new ThinkingComponent({
          kind: 'thinking', seq: entry.seq, turn: entry.turn, step: entry.step, text: entry.text, streaming: entry.streaming,
        }, renderer.colors, renderer.components, () => {
          this.renderedRows = undefined
          renderer.requestRender()
        })
        return component
      }
      case 'transcript-tool': {
        const presentation = entry.presentation
        const body = presentation === undefined ? undefined : new ToolModelComponent(() => presentation, renderer)
        return new ToolCallComponent(asToolItem(entry), renderer.colors, renderer.components, body, toolResultChip(presentation))
      }
      case 'transcript-read-group':
        return new ReadGroupComponent(entry, renderer.colors, renderer.components)
      case 'transcript-search-group':
        return new SearchGroupComponent(entry, renderer.colors, renderer.components)
      case 'transcript-error':
        return new ErrorMessageComponent({
          kind: 'error', seq: entry.seq, turn: entry.turn, message: entry.message,
          ...(entry.code === undefined ? {} : { code: entry.code }),
        }, renderer.colors, renderer.components)
      case 'transcript-interrupted':
        return new InterruptedMarkerComponent(renderer.colors, renderer.components, renderer.t)
    }
  }

  private plainText(entry: TranscriptEntryModel): string {
    switch (entry.kind) {
      case 'transcript-user': return entry.text
      case 'transcript-assistant': return entry.text
      case 'transcript-thinking': return entry.text
      case 'transcript-tool': {
        const text = entry.result?.fullText ?? entry.result?.text
        return text === undefined ? summarizeToolCall(entry.name, entry.arguments) : summarizeToolText(text)
      }
      case 'transcript-read-group': {
        const paths = groupReadsByFile(entry.reads).map(group => group.path)
        return `Read ${String(entry.reads.length)} ${entry.reads.length === 1 ? 'call' : 'calls'}${paths.length === 0 ? '' : `: ${paths.join(', ')}`}`
      }
      case 'transcript-search-group': {
        const patterns = entry.searches.map(call => call.pattern ?? 'search')
        return `Searched ${String(entry.searches.length)} ${entry.searches.length === 1 ? 'time' : 'times'}: ${patterns.join(', ')}`
      }
      case 'transcript-error': return entry.code === undefined ? entry.message : `${entry.message} (${entry.code})`
      case 'transcript-interrupted': return 'Interrupted'
    }
  }

  private prune(live: ReadonlySet<string>): void {
    for (const [id, cached] of this.cached) {
      if (live.has(id)) continue
      this.disposeComponent(cached.target)
      this.cached.delete(id)
    }
  }

  private disposeComponent(component: BlueComponent): void {
    ;(component as BlueComponent & { dispose?: () => void }).dispose?.()
  }
}

interface MountedModel {
  readonly component: TranscriptModelComponent
  readonly unmount: () => void
}

/** Renderer-neutral transcript registry with an additive/replacement TUI bridge. */
export class TranscriptModelService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, MountedModel>()
  private screen: BlueScreen | undefined
  private expanded = false

  constructor(
    private readonly owner: Context,
    screen?: BlueScreen,
    private readonly hooks: TranscriptModelServiceHooks = {},
  ) {
    super(owner, 'blueTranscriptModels')
    this.screen = screen
  }

  attach(screen: BlueScreen): void {
    for (const id of this.mounted.keys()) this.unmount(id)
    this.screen = screen
    for (const id of this.models.keys()) this.mount(id)
  }

  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`transcript model "${initial.id}" is already registered`)
    const wasEmpty = this.models.size === 0
    this.models.set(initial.id, source)
    this.mount(initial.id)
    if (wasEmpty) this.hooks.onPresenceChanged?.(true)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.models.delete(initial.id)
      this.unmount(initial.id)
      this.screen?.requestRender()
      if (this.models.size === 0) this.hooks.onPresenceChanged?.(false)
    }
  }

  refresh(id: string): void {
    if (!this.models.has(id)) return
    const screen = this.screen
    if (screen === undefined) return
    const paused = screen.contentChanged()
    this.owner.emit('blue/transcript-content-changed', paused)
    screen.requestRender()
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    for (const { component } of this.mounted.values()) component.setExpanded(expanded)
  }

  /** Re-read presentation policy and invalidate mounted semantic components. */
  refreshPresentationPolicy(): void {
    for (const { component } of this.mounted.values()) component.invalidate()
    this.screen?.requestRender(true)
  }

  /** Invalidate renderer-owned copy after a locale provider revision. */
  refreshLocale(): void {
    for (const { component } of this.mounted.values()) component.invalidate()
    this.screen?.requestRender(true)
  }

  /** Expose the current immutable policy for diagnostics and tests. */
  presentationPolicy(): TranscriptPresentationSnapshot {
    return this.hooks.renderer?.presentation?.snapshot() ?? DEFAULT_TRANSCRIPT_PRESENTATION
  }

  hasModels(): boolean {
    return this.models.size > 0
  }

  list(): readonly TranscriptModel[] {
    return [...this.models.values()]
      .map(source => typeof source === 'function' ? source() : source)
      .filter((model): model is TranscriptModel => model !== null)
  }

  dispose(): void {
    const hadModels = this.models.size > 0
    for (const id of this.mounted.keys()) this.unmount(id)
    this.models.clear()
    this.screen = undefined
    if (hadModels) this.hooks.onPresenceChanged?.(false)
  }

  private mount(id: string): void {
    const screen = this.screen
    const source = this.models.get(id)
    const renderer = this.hooks.renderer
    if (screen === undefined || source === undefined || renderer === undefined) return
    this.unmount(id)
    const component = new TranscriptModelComponent(() => {
      const current = this.models.get(id)
      return current === undefined ? null : typeof current === 'function' ? current() : current
    }, renderer)
    component.setExpanded(this.expanded)
    this.mounted.set(id, { component, unmount: screen.addChild(component) })
    screen.requestRender()
  }

  private unmount(id: string): void {
    const mounted = this.mounted.get(id)
    if (mounted === undefined) return
    mounted.component.dispose()
    mounted.unmount()
    this.mounted.delete(id)
  }
}
