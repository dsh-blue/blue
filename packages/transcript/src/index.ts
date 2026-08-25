/**
 * @dsh-blue/blue-transcript — Blue terminal UI transcript layer. On
 * `'blue/session-changed'` (emitted by `@dsh-blue/blue-app` after
 * create/resume) the plugin first folds the `agent.session.events` snapshot
 * — resume seeds do not replay `session/event` — then subscribes to the live
 * feed, dropping events at or below the snapshot's last seq. Every applied
 * branch ends in `blueScreen.requestRender()`. A global `ctrl+o` keymap
 * action (`blue.transcript.toggle-collapse`) toggles tool-card components
 * between the collapsed result preview and the full output, scoped to the
 * most recent {@link EXPAND_TURNS} turns (the S20 kimi range). Tool cards are
 * created through the `blueIntents` render-intent registry: the item's
 * resolved view selects an intent entry, and the entry's factory builds the
 * component (the built-in `'generic'` entry is the `ToolCallComponent`
 * baseline). Consecutive same-step Reads group into one
 * `ReadGroupComponent` at mount time (the S20 kimi contiguity rule). Long
 * sessions stay bounded: after each applied event the window
 * policy evicts turns older than the newest completed `windowTurns` turns
 * (silent destruction, no replacement UI), and in-turn step folding slides a
 * retention window (the most recent `DEFAULT_RECENT_STEPS_RETENTION` steps
 * stay expanded, older ones collapse into one `step-summary` line). The
 * plugin also
 * owns the status line's extension seam: it provides the `blueStatus`
 * registry and mounts the persistent two-row footer shell bottom-pinned
 * above the input editor; the entries themselves ship as the `status-basic`
 * / `status-git` / `status-context` subpath plugins so the composing bundle
 * lists them as its own patch rows. Unloading the plugin unmounts every
 * mounted component, the footer included, and unregisters the action.
 *
 * @module @dsh-blue/blue-transcript
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueRequestLifecycle } from '@dsh-blue/blue-api'
import {
  GutterComponent,
  type BlueComponent,
  type BlueComponents,
  type BlueScreen,
  type BlueSemanticColors,
} from '@dsh-blue/blue-core'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type { BlueTurnRetraction } from '@dsh-blue/blue-app'
// Carries the optional host `settings` service Context merge.
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  AssistantMessageComponent,
  ErrorMessageComponent,
  InterruptedMarkerComponent,
  setUserFoldThresholds,
  StepSummaryComponent,
  ToolCallComponent,
  UserMessageComponent,
  userFoldThresholds,
  type UserMessageImages,
} from './components.ts'
import { retractedTurnNumbers, TranscriptFolder, type FoldUpdate } from './fold.ts'
import { BlueIntentsService } from './intents.ts'
import { isReadItem, resolveCallView, resolveResultView } from './present.ts'
import { ReadGroupComponent } from './read-group.ts'
import { BlueStatusService, FooterShellComponent } from './status.ts'
import { BlueStatusModelService } from './status-model.ts'
import { BlueDockModelService } from './dock-model.ts'
import { BlueModelToolService } from './tool-model.ts'
import { TranscriptModelService } from './transcript-model.ts'
import { ThinkingComponent } from './thinking.ts'
import { defaultExpansion, setDefaultExpansion } from './fold-defaults.ts'
import type { BlueIntentComponent, TranscriptItem } from './types.ts'
import { currentWindowTurns, setRecentStepsRetention, setWindowTurns, windowEvictTurn } from './window.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** New transcript content arrived while the user was scrolled away. */
    'blue/transcript-content-changed'(paused: boolean): void
  }
}

export type { FoldUpdate } from './fold.ts'
export { ellipsize, foldSessionEvents, RESULT_SUMMARY_MAX_CHARS, TranscriptFolder } from './fold.ts'
export {
  AssistantMessageComponent,
  DEFAULT_USER_FOLD_CHARS,
  DEFAULT_USER_FOLD_LINES,
  setUserFoldThresholds,
  StepSummaryComponent,
  TOOL_ARGUMENTS_MAX_CHARS,
  ToolCallComponent,
  USER_PREVIEW_LINES,
  UserMessageComponent,
} from './components.ts'
export { ReadGroupComponent } from './read-group.ts'
export { defaultExpansion, setDefaultExpansion } from './fold-defaults.ts'
export { AgentGroupComponent, setAgentGroupTimers, type AgentGroupTimers } from './agent-group.ts'
export { BlueIntentsError, BlueIntentsService } from './intents.ts'
export { BlueStatusError, BlueStatusService, FOOTER_MAX_ROWS, FooterShellComponent } from './status.ts'
export { BlueStatusModelService, plainView } from './status-model.ts'
export { BlueDockModelService, ModelDockComponent } from './dock-model.ts'
export { createToolPresentationModel, toolCallView, toolResultView, BlueModelToolService, ToolModelComponent, ToolModelService } from './tool-model.ts'
export type { ToolPresentationFacts } from './tool-model.ts'
export { appendTranscriptView, createTranscriptModel, TRANSCRIPT_MODEL_WINDOW, TranscriptModelService, TranscriptModelComponent } from './transcript-model.ts'
export { StreamingPhaseTracker, type StreamingPhase } from './phase.ts'
export {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  MOON_SPINNER_FRAMES,
  MOON_SPINNER_INTERVAL_MS,
} from './spinners.ts'
export { ThinkingComponent, THINKING_PREVIEW_LINES } from './thinking.ts'
export type { BlueIntentComponent, BlueIntentEntry, BlueIntentProps, BlueIntents, BlueStatus, BlueStatusEntry } from './types.ts'
export type {
  TranscriptAssistantItem,
  TranscriptItem,
  TranscriptStepSummaryItem,
  TranscriptThinkingItem,
  TranscriptToolItem,
  TranscriptToolResult,
  TranscriptUserItem,
} from './types.ts'
export {
  DEFAULT_RECENT_STEPS_RETENTION,
  DEFAULT_WINDOW_TURNS,
  currentWindowTurns,
  recentStepsRetention,
  setRecentStepsRetention,
  setStepFoldingEnabled,
  setWindowTurns,
} from './window.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-transcript'

/** Services the plugin requires before it can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'tools']

/** The global action toggling tool-output expansion (Ctrl-O). */
export const ACTION_TOGGLE_COLLAPSE = 'blue.transcript.toggle-collapse'

/**
 * The Ctrl-O expansion range (kimi `TRANSCRIPT_EXPAND_TURNS`): only cards in
 * the most recent turns flip; older turns stay collapsed.
 */
export const EXPAND_TURNS = 3

/** The live Ctrl-O range; the settings driver and tests replace it (the `window.ts` setter precedent). */
let expandTurns = EXPAND_TURNS

/**
 * Replace the Ctrl-O expansion range.
 * @param n - the replacement, or `undefined` to restore the default.
 */
export function setExpandTurns(n: number | undefined): void {
  expandTurns = n ?? EXPAND_TURNS
}

/**
 * Read the live Ctrl-O expansion range (the `window.ts` reader precedent:
 * the settings driver's specs assert through it).
 * @returns the number of most-recent turns Ctrl-O reaches back.
 */
export function currentExpandTurns(): number {
  return expandTurns
}

/**
 * The plugin-wide expansion toggle state plus the live session's mounted
 * entries in mount order — the S20 position-based scope reads turn
 * boundaries from them. `expanded` resets to collapsed and the entries
 * reference clears whenever the mounted session unmounts. Entries whose
 * component lacks a `setExpanded` (an intent component that never
 * collapses) are skipped by the toggle.
 */
interface CollapseToggle {
  expanded: boolean
  entries: readonly MountedEntry[]
}

/** One mounted component and the bookkeeping to retire it. */
interface MountedEntry {
  /** The folded item the component renders (identity-stable per item). */
  item: TranscriptItem
  /** The mounted component. */
  component: BlueComponent
  /** Unmounts the component from the screen. */
  dispose(): void
}

/**
 * Retire one mounted entry: unmount it from the screen and stand down any
 * component-owned machinery (the thinking block's spinner timer stops here,
 * so an evicted or abandoned live block cannot outlive its component).
 */
function retireEntry(entry: MountedEntry): void {
  ;(entry.component as { dispose?: () => void }).dispose?.()
  entry.dispose()
}

/**
 * Create the component rendering one folded item (non-tool kinds; tool items
 * resolve through the intent registry instead).
 */
function createPlainComponent(
  item: Exclude<TranscriptItem, { kind: 'tool' }>,
  colors: BlueSemanticColors,
  components: BlueComponents,
  images: UserMessageImages,
  requestRender: () => void,
): BlueComponent {
  switch (item.kind) {
    case 'user':
      return new UserMessageComponent(item, colors, components, images)
    case 'assistant':
      return new AssistantMessageComponent(item, colors, components)
    case 'thinking':
      return new ThinkingComponent(item, colors, components, requestRender)
    case 'step-summary':
      return new StepSummaryComponent(item, colors, components)
    case 'error':
      return new ErrorMessageComponent(item, colors, components)
    case 'interrupted':
      return new InterruptedMarkerComponent(colors, components)
  }
}

/**
 * Mount one agent's transcript: snapshot fold, then the live `session/event`
 * subscription. Tool items resolve components through `intents`; every mount
 * is tracked in `entries` so replacements and window eviction can retire
 * exactly the components they supersede. Returns the disposer unmounting
 * everything this session mounted and resetting the toggle to its collapsed
 * default.
 */
function mountSession(
  ctx: Context,
  screen: BlueScreen,
  colors: BlueSemanticColors,
  intents: BlueIntentsService,
  agent: Agent,
  toggle: CollapseToggle,
  images: UserMessageImages,
): () => void {
  const components = ctx.blueComponents
  const entries: MountedEntry[] = []
  toggle.entries = entries
  const folder = new TranscriptFolder({
    present: {
      call: (name, args) => resolveCallView(ctx.tools, name, args),
      result: (name, args, result) => resolveResultView(ctx.tools, name, args, result),
    },
    retractedTurns: retractedTurnNumbers(agent.session.events),
  })

  /** Dispose and drop every entry matching the predicate. */
  const retire = (matches: (item: TranscriptItem) => boolean): void => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]!
      if (!matches(entry.item)) continue
      retireEntry(entry)
      entries.splice(index, 1)
    }
  }

  /** Window eviction: silently destroy components of evicted turns. */
  const evict = (): void => {
    const turn = windowEvictTurn(folder.completedTurns, currentWindowTurns())
    if (turn === undefined) return
    folder.evictThrough(turn)
    retire(item => item.turn <= turn)
  }

  // One shared redraw nudge: the thinking block's spinner ticks call it,
  // and every mount site hands the same arrow to its component.
  const requestRender = (): void => {
    screen.requestRender()
  }

  /** Mount one newly created item's component (the fold's mount order). */
  const mount = (item: TranscriptItem): void => {
    // The S20 back half: consecutive same-step Reads group into one
    // `ReadGroupComponent` (the kimi contiguity rule — any other tool
    // between two Reads breaks the chain, which the last-entry check
    // expresses). The lone first card retires when the second Read mounts;
    // the group's bookkeeping item is the first member, so step folding and
    // window eviction retire it exactly when the members' items fold.
    if (item.kind === 'tool' && isReadItem(item)) {
      const previous = entries.at(-1)
      if (previous !== undefined && previous.item.kind === 'tool'
        && previous.item.turn === item.turn && previous.item.step === item.step
        && isReadItem(previous.item)) {
        if (previous.component instanceof ReadGroupComponent) {
          previous.component.attach(item)
          return
        }
        retireEntry(previous)
        // `previous` is the last entry by construction, so the pop drops it.
        entries.pop()
        const group = new ReadGroupComponent(previous.item, colors, components)
        group.attach(item)
        entries.push({ item: previous.item, component: group, dispose: screen.addChild(new GutterComponent(group)) })
        return
      }
    }
    let component: BlueComponent
    if (item.kind === 'tool') {
      const intent = intents.resolve(item.view !== undefined && 'card' in item.view ? item.view.card : 'generic')
      component = intent.create({ item, colors, components, expanded: toggle.expanded || defaultExpansion('tools') })
    } else {
      component = createPlainComponent(item, colors, components, images, requestRender)
    }
    const expandable = component as BlueIntentComponent
    if (item.kind === 'thinking' || item.kind === 'user') {
      // The thinking block and a foldable long user message mount at the
      // live expansion state (kimi applies toolOutputExpanded at
      // ThinkingComponent creation too); a freshly mounted entry is always
      // in the newest turn, so the creation-time state below is the same
      // shortcut for it.
      expandable.setExpanded?.(toggle.expanded || (item.kind === 'thinking' && defaultExpansion('thinking')))
    }
    // The kimi one-column gutter (D29, S21): every transcript entry mounts
    // inset on both sides; the component itself never knows.
    entries.push({ item, component, dispose: screen.addChild(new GutterComponent(component)) })
  }

  const present = (updates: readonly FoldUpdate[] | null): void => {
    if (updates === null) return
    for (const update of updates) {
      if ('removed' in update) {
        const removed = new Set(update.removed)
        retire(item => removed.has(item))
        continue
      }
      if ('replaced' in update) {
        // In-turn step folding: dispose the folded items' components and mount
        // the summary. screen.addChild appends positionally correctly here
        // because folding fires at a step boundary, before anything newer than
        // the folded step has mounted.
        const folded = new Set<TranscriptItem>(update.replaced)
        retire(item => folded.has(item))
        const summary = createPlainComponent(update.item, colors, components, images, requestRender)
        entries.push({ item: update.item, component: summary, dispose: screen.addChild(new GutterComponent(summary)) })
        continue
      }
      if (update.isNew) mount(update.item)
    }
  }

  // Snapshot first: resume seeds never replay session/event, so history
  // renders from agent.session.events; the subscription below then carries
  // only newer seqs. Both happen in one synchronous turn, so no committed
  // event can fall between them. Eviction runs per event so a long resume
  // seed lands already-windowed.
  let lastSeq = -1
  for (const event of agent.session.events) {
    lastSeq = Math.max(lastSeq, event.seq)
    present(folder.apply(event))
    evict()
  }

  const offEvent = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.seq <= lastSeq) return
    lastSeq = event.seq
    present(folder.apply(event))
    evict()
    const paused = (screen as BlueScreen & { contentChanged?: () => boolean }).contentChanged?.() ?? false
    ctx.emit('blue/transcript-content-changed', paused)
    screen.requestRender()
  })

  // Request lifecycle is the authoritative cancellation projection.  An
  // interrupt can reach the UI before persistence emits `turn/end`; create
  // the tombstone immediately and let TranscriptFolder merge the later host
  // close idempotently.  The controller has already rejected stale session
  // and request epochs, so this listener only needs to scope to main turns.
  const offLifecycle = ctx.on('blue/request-state-changed', (lifecycle: BlueRequestLifecycle) => {
    if (lifecycle.state !== 'interrupted' || lifecycle.ref.scope !== 'main') return
    const requests = ctx.get('blueRequests') as { readonly sessionEpoch: number } | undefined
    if (requests !== undefined && lifecycle.ref.sessionEpoch !== requests.sessionEpoch) return
    present(folder.interrupt())
    evict()
    const paused = (screen as BlueScreen & { contentChanged?: () => boolean }).contentChanged?.() ?? false
    ctx.emit('blue/transcript-content-changed', paused)
    screen.requestRender(true)
  })

  const offRetraction = ctx.on('blue/turn-retracted', (retraction: BlueTurnRetraction) => {
    const requests = ctx.get('blueRequests') as { readonly sessionEpoch: number } | undefined
    if (requests !== undefined && retraction.sessionEpoch !== requests.sessionEpoch) return
    present(folder.retract(retraction.turn))
    evict()
    screen.requestRender()
  })

  screen.requestRender(true)
  return () => {
    offEvent()
    offLifecycle()
    offRetraction()
    toggle.expanded = false
    toggle.entries = []
    for (const entry of entries.splice(0)) retireEntry(entry)
  }
}

/**
 * Mount the transcript renderer. Renders `blueSession.current` when an agent
 * already exists at load time, then remounts on every
 * `'blue/session-changed'`. Also provides the `blueStatus` registry and the
 * `blueIntents` registry (with the built-in `'generic'` entry as the
 * `ToolCallComponent` baseline), mounts the footer shell once, bottom-pinned
 * (the transcript patch row precedes the interaction row, so the footer lands
 * right above the input editor); entry plugins register into the registries
 * independently of session mounts. Finally registers the global Ctrl-O
 * action whose handler flips detail expansion for the mounted session's
 * tool cards, thinking blocks, and foldable long user messages.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const screen = ctx.blueScreen
  const colors = ctx.blueTheme.colors
  const toggle: CollapseToggle = { expanded: false, entries: [] }

  const BLUE_NS = 'blue' as SettingsNamespace
  const syncExpansionDefaults = (value: unknown): void => {
    const section = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
    const before = `${defaultExpansion('thinking')}:${defaultExpansion('tools')}`
    setDefaultExpansion({
      thinking: typeof section.collapseThinking === 'boolean' ? !section.collapseThinking : defaultExpansion('thinking'),
      tools: typeof section.collapseToolCalls === 'boolean' ? !section.collapseToolCalls : defaultExpansion('tools'),
    })
    if (`${defaultExpansion('thinking')}:${defaultExpansion('tools')}` === before) return
    for (const entry of toggle.entries) {
      const expandable = entry.component as BlueIntentComponent
      if (typeof expandable.setExpanded !== 'function') continue
      const base = toggle.expanded
        || (entry.item.kind === 'thinking' ? defaultExpansion('thinking')
          : entry.item.kind === 'tool' ? defaultExpansion('tools') : false)
      expandable.setExpanded(base)
    }
    screen.requestRender(true)
  }
  syncExpansionDefaults(ctx.get('settings')?.get(BLUE_NS))
  ctx.on('settings/updated', (ns, next) => {
    if (ns === BLUE_NS) syncExpansionDefaults(next)
  })

  // Optional image wiring is renderer-owned. Both the legacy baseline and the
  // official model consumer receive the same byte loader; the projected model
  // itself carries only durable references.
  const imageDependencies = (): UserMessageImages => {
    const attachments = ctx.get('attachments') as
      | { readImage(ref: unknown): Promise<{ data: Uint8Array }> }
      | undefined
    return attachments === undefined ? {} : {
      loadImage: async (ref: unknown) => {
        try {
          return (await attachments.readImage(ref)).data
        } catch {
          return undefined
        }
      },
      onReady: () => screen.requestRender(),
    }
  }

  // Instantiated directly, like BlueStatusService below: a Cordis Context
  // proxy rejects uninjected services and a service cannot inject itself,
  // yet the built-in generic entry must register before any downstream
  // intent plugin resolves through the registry.
  const intents = new BlueIntentsService(ctx)
  ctx.effect(() => intents.register({
    intent: 'generic',
    create: props => new ToolCallComponent(props.item, props.colors, props.components),
  }))

  const status = new BlueStatusService(ctx, screen)
  const statusModels = new BlueStatusModelService(ctx)
  const dockModels = new BlueDockModelService(ctx)
  const toolModels = new BlueModelToolService(ctx)
  let activeAgent = ctx.get('blueSession')?.current ?? undefined
  let unmount: (() => void) | null = null
  let closing = false
  const mountLegacy = (): void => {
    if (closing || activeAgent === undefined) return
    unmount = mountSession(ctx, screen, colors, intents, activeAgent, toggle, imageDependencies())
  }
  const transcriptModels = new TranscriptModelService(ctx, undefined, {
    renderer: {
      colors,
      components: ctx.blueComponents,
      images: imageDependencies,
      intents,
      requestRender: () => screen.requestRender(),
    },
    onPresenceChanged: (present) => {
      if (closing) return
      if (present) {
        unmount?.()
        unmount = null
      } else {
        mountLegacy()
      }
    },
  })
  ctx.effect(() => () => transcriptModels.dispose())
  const footer = new FooterShellComponent(status, ctx.blueComponents)
  status.attach(footer)
  statusModels.attach(status, screen, colors, ctx.blueComponents)
  dockModels.attach(screen)
  toolModels.attach(screen)
  transcriptModels.attach(screen)
  // The footer pins to the dock's lowest slot (S12): the two-row status
  // stays on the terminal's last rows beneath the editor, the kimi layout
  // dialog panels pull up over.
  ctx.effect(() => screen.addBottomChild(new GutterComponent(footer), 'bottom'))

  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_TOGGLE_COLLAPSE,
    keys: 'ctrl+o',
    description: 'Toggle detail expansion (tool output, long messages)',
    handler: () => {
      toggle.expanded = !toggle.expanded
      // The kimi `toggleToolOutputExpansion` scope (S20): a component is
      // expandable only when it sits at or after the start of the
      // (totalTurns - EXPAND_TURNS)-th turn — position-based over the mount
      // order, so streaming cards without any metadata still resolve. User
      // items are the turn boundaries; everything before the cutoff turns'
      // start collapses (never expands), everything at/after it flips.
      const entries = toggle.entries
      const boundaries: number[] = []
      for (let index = 0; index < entries.length; index += 1) {
        if (entries[index]!.item.kind === 'user') boundaries.push(index)
      }
      const cutoff = boundaries.length > expandTurns
        ? boundaries[boundaries.length - expandTurns]!
        : 0
      for (let index = 0; index < entries.length; index += 1) {
        const expandable = entries[index]!.component as BlueIntentComponent
        if (typeof expandable.setExpanded === 'function') {
          const item = entries[index]!.item
          const fallback = item.kind === 'thinking'
            ? defaultExpansion('thinking')
            : item.kind === 'tool'
              ? defaultExpansion('tools')
              : false
          expandable.setExpanded((toggle.expanded || fallback) && index >= cutoff)
        }
      }
      transcriptModels.setExpanded(toggle.expanded)
      screen.requestRender(true)
    },
  }]))

  // Blue settings ride the host settings document: the resolved `blue`
  // namespace (schema owned by interaction) carries the fold defaults
  // (`collapseThinking` / `collapseToolCalls`) and the transcript tunables
  // (`windowTurns` / `recentStepsRetention` / `expandTurns` /
  // `userFoldLines` / `userFoldChars`). The service is optional and its
  // value unknown here, so every read parses defensively — absent keys or
  // wrongly typed values keep the current setting; a host without settings
  // keeps every shipped default.
  const BLUE_NS = 'blue' as SettingsNamespace
  /** Replace one numeric tunable when the section carries a positive integer. */
  const applyNumber = (raw: unknown, set: (n: number) => void): void => {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) set(raw)
  }
  const applyFoldSettings = (value: unknown): void => {
    const section = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
    applyNumber(section.windowTurns, setWindowTurns)
    applyNumber(section.recentStepsRetention, setRecentStepsRetention)
    applyNumber(section.expandTurns, setExpandTurns)
    // The fold thresholds are one pair-setter: diff against the live values
    // so a section carrying only one of them keeps the sibling's current
    // value (the fold-defaults keep-current discipline).
    const folds = userFoldThresholds()
    let foldLines = folds.lines
    let foldChars = folds.chars
    applyNumber(section.userFoldLines, n => {
      foldLines = n
    })
    applyNumber(section.userFoldChars, n => {
      foldChars = n
    })
    if (foldLines !== folds.lines || foldChars !== folds.chars) setUserFoldThresholds(foldLines, foldChars)
    const before = `${defaultExpansion('thinking')}:${defaultExpansion('tools')}`
    setDefaultExpansion({
      thinking: typeof section.collapseThinking === 'boolean'
        ? !section.collapseThinking
        : defaultExpansion('thinking'),
      tools: typeof section.collapseToolCalls === 'boolean'
        ? !section.collapseToolCalls
        : defaultExpansion('tools'),
    })
    if (`${defaultExpansion('thinking')}:${defaultExpansion('tools')}` === before) return
    // A fold-default commit also re-seeds the entries ALREADY mounted:
    // "starts collapsed" is the mount semantics, but a toggle that leaves
    // the visible transcript untouched reads as broken. The Ctrl-O state
    // dominates exactly as it does at mount; categories the defaults do
    // not cover (user folds) keep their state.
    for (const entry of toggle.entries) {
      const expandable = entry.component as BlueIntentComponent
      if (typeof expandable.setExpanded !== 'function') continue
      if (entry.item.kind === 'thinking') {
        expandable.setExpanded(toggle.expanded || defaultExpansion('thinking'))
      } else if (entry.item.kind === 'tool') {
        expandable.setExpanded(toggle.expanded || defaultExpansion('tools'))
      }
    }
    screen.requestRender(true)
  }
  applyFoldSettings(ctx.get('settings')?.get(BLUE_NS))
  ctx.on('settings/updated', (ns, next) => {
    if (ns === BLUE_NS) applyFoldSettings(next)
  })

  ctx.on('blue/session-changed', (agent) => {
    activeAgent = agent
    unmount?.()
    unmount = null
    if (!transcriptModels.hasModels()) mountLegacy()
  })
  ctx.effect(() => () => {
    closing = true
    unmount?.()
    unmount = null
  })

  if (activeAgent !== undefined) mountLegacy()
}
