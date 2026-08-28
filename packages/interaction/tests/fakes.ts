/**
 * Shared test doubles for the Blue interaction suites: fake BlueScreen,
 * BlueTheme, BlueKeymap, and BlueComponents (in-memory BlueEditor and
 * BlueSelectList) implementing the L1 contracts with observable state, plus
 * helpers to mount a context with the fakes provided.
 */

import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// Width truth is pi-tui itself (D48): the fake SGR-stripped counters that
// used to live here were exact only for ASCII, so CJK mis-budgets stayed
// green in tests while tripping the real width guard. Fakes now delegate to
// the same implementations the renderer runs.
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../../core/src/width.ts'
import type {
  BlueAutocompleteItem,
  BlueAutocompleteProvider,
  BlueColorFn,
  BlueComponent,
  BlueComponents,
  BlueEditor,
  BlueEditorOptions,
  BlueFocusable,
  BlueFuzzyMatch,
  BlueKeyAction,
  BlueKeymap,
  BlueMarkdown,
  BlueMarkdownOptions,
  BlueOverlayHandle,
  BlueOverlayOptions,
  BlueScreen,
  BlueSelectItem,
  BlueSelectList,
  BlueSelectListOptions,
  BlueSemanticColors,
  BlueSettingsList,
  BlueSettingsListOptions,
  BlueTheme,
} from '@dsh-blue/blue-core'
import type { BlueScreenService, BlueKeymapService, BlueComponentsService } from '@dsh-blue/blue-core'
// BlueImage/BlueImageOptions are not root-exported by core yet; source-plane
// tests import them straight from core's src types.
import type { BlueImage, BlueImageOptions } from '../../core/src/types.ts'
import { EditorHostService, setEditorSlotSwap } from '../src/editor-instance.ts'
import {
  INTERACTION_KEY_ACTIONS,
} from '../src/keys.ts'
import { BlueDockModelService } from '../../transcript/src/dock-model.ts'
import { rewindCandidates } from '../../app/src/rewind.ts'
import { foldYolo } from '../../app/src/mode.ts'
import { sessionDetails as buildSessionDetails } from '../../app/src/session-details.ts'
import { SkillsCatalogService } from '../src/skills-catalog.ts'
import { InteractionStateService } from '../src/runtime-state.ts'
import { DEFAULT_SETTINGS } from '../src/settings.ts'

/** Decoded input sequences matching each key id the interaction batch binds. */
const SEQUENCE_BY_KEY_ID: Record<string, string> = {
  enter: '\r',
  escape: '\x1b',
  backspace: '\x7f',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  space: ' ',
  'ctrl+c': '\x03',
  'ctrl+s': '\x13',
  'ctrl+g': '\x07',
  'ctrl+v': '\x16',
  'alt+s': '\x1bs',
  'alt+m': '\x1bm',
  'shift+tab': '\x1b[Z',
}

/** Convenience aliases for the fake key sequences. */
export const KEY = {
  enter: '\r',
  escape: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  altS: '\x1bs',
  altM: '\x1bm',
  tab: '\t',
  shiftTab: '\x1b[Z',
  space: ' ',
  ctrlC: '\x03',
  ctrlS: '\x13',
  ctrlG: '\x07',
  ctrlV: '\x16',
} as const

/**
 * Fake keymap: registered actions match the decoded sequences their key ids
 * stand for (`matches`), report key-id labels (`getKeys`), and snapshot
 * descriptions for keybinding UIs (`list`).
 */
export class FakeKeymap implements BlueKeymap {
  private readonly sequences = new Map<string, string[]>()
  private readonly ids = new Map<string, string[]>()
  private readonly descriptions = new Map<string, string>()
  private readonly handlers = new Map<string, () => void>()

  /**
   * @param withDefaults - preload the interaction action bindings; pass
   *   false to test unregistered-action fallbacks.
   */
  constructor(withDefaults = true) {
    if (!withDefaults) return
    for (const action of INTERACTION_KEY_ACTIONS) {
      const keys = typeof action.keys === 'string' ? [action.keys] : [...action.keys]
      this.ids.set(action.id, keys)
      this.sequences.set(action.id, keys.map(key => SEQUENCE_BY_KEY_ID[key] ?? key))
      if (action.description !== undefined) this.descriptions.set(action.id, action.description)
    }
  }

  register(actions: BlueKeyAction[]): () => void {
    for (const action of actions) {
      const keys = typeof action.keys === 'string' ? [action.keys] : [...action.keys]
      this.ids.set(action.id, keys)
      this.sequences.set(action.id, keys.map(key => SEQUENCE_BY_KEY_ID[key] ?? key))
      if (action.description !== undefined) this.descriptions.set(action.id, action.description)
      if (action.handler !== undefined) this.handlers.set(action.id, action.handler)
    }
    return () => {
      for (const action of actions) {
        this.ids.delete(action.id)
        this.sequences.delete(action.id)
        this.descriptions.delete(action.id)
        this.handlers.delete(action.id)
      }
    }
  }

  matches(data: string, action: string): boolean {
    return this.sequences.get(action)?.includes(data) ?? false
  }

  dispatch(data: string): boolean {
    for (const [id, keys] of this.sequences) {
      const handler = this.handlers.get(id)
      if (handler !== undefined && keys.includes(data)) {
        handler()
        return true
      }
    }
    return false
  }

  getKeys(action: string): string[] {
    return [...this.ids.get(action) ?? []]
  }

  list(): readonly BlueKeyAction[] {
    return [...this.ids].map(([id, keys]) => {
      const description = this.descriptions.get(id)
      return { id, keys: [...keys], ...description === undefined ? {} : { description } }
    })
  }
}

const identity = (text: string): string => text

/** Marker-wrapping color functions so tests can assert which role styled a row. */
function fakeColors(): BlueSemanticColors {
  return {
    text: identity,
    textStrong: text => `#${text}#`,
    muted: text => `~${text}~`,
    textMuted: text => `_${text}_`,
    accent: text => `*${text}*`,
    primary: text => `^${text}^`,
    border: identity,
    borderFocus: text => `%${text}%`,
    success: identity,
    error: text => `!${text}!`,
    warning: text => `?${text}?`,
    // S12 marks the full-width selected row so tests can assert the token
    // reached the cursor (S10 left the token unused; the multi-select is its
    // first real consumer).
    selectedBg: text => `{${text}}`,
    roleUser: text => `@${text}@`,
    shellMode: text => `$${text}$`,
    mdHeading: identity,
    mdLink: identity,
    mdLinkUrl: identity,
    mdCode: identity,
    mdCodeBlock: identity,
    mdCodeBlockBorder: identity,
    mdQuote: identity,
    mdQuoteBorder: identity,
    mdHr: identity,
    mdListBullet: identity,
    diffAdded: text => `+${text}+`,
    diffRemoved: text => `-${text}-`,
    diffAddedStrong: text => `=${text}=`,
    diffRemovedStrong: text => `/${text}/`,
    diffGutter: text => `:${text}:`,
    diffMeta: text => `;${text};`,
  }
}

/** Fake theme wrapping {@link fakeColors}. */
export class FakeTheme implements BlueTheme {
  readonly colors = fakeColors()
}

/**
 * In-memory BlueEditor: `handleInput` asks `onKey` first (a true reply
 * consumes the sequence), then appends any sequence verbatim and submits on
 * `'\r'` (unless `disableSubmit`); `setText` fires `onChange`
 * synchronously, mirroring the wrapped component's contract.
 */
export class FakeBlueEditor implements BlueEditor {
  focused = false
  onSubmit: ((text: string) => void) | undefined
  onChange: ((text: string) => void) | undefined
  onKey: ((data: string) => boolean) | undefined
  disableSubmit = false
  /** Autocomplete dropdown visibility reported by `isShowingAutocomplete`. */
  showingAutocomplete = false
  /** History entries, newest first (mirrors pi-tui). */
  readonly history: string[] = []
  /** Every string recorded through `insertText`, in order. */
  readonly inserted: string[] = []
  /** The last border color set; identity until restyled. */
  borderColor: BlueColorFn = identity
  /** The last prompt symbol set, if any. */
  promptSymbol: '>' | '!' | undefined
  /** The last border label set, if any. */
  borderLabel: string | undefined
  /** Whether the frame currently opens into a panel above. */
  connectedAbove = false
  /** The last ghost hint set, if any. */
  ghostHint: string | undefined
  /** The last autocomplete provider attached, if any. */
  autocompleteProvider: BlueAutocompleteProvider | undefined
  private text = ''

  getText(): string {
    return this.text
  }

  /** The fake carries no paste markers, so expansion is the text itself. */
  getExpandedText(): string {
    return this.text
  }

  setText(text: string): void {
    this.text = text
    this.onChange?.(text)
  }

  addToHistory(text: string): void {
    // pi-tui prepends and skips a repeat of the newest entry; the fake
    // mirrors that contract so order-sensitive consumers behave alike.
    if (this.history[0] !== text) this.history.unshift(text)
  }

  getHistory(): readonly string[] {
    return [...this.history]
  }

  removeLatestHistory(text: string): boolean {
    if (this.history[0] !== text) return false
    this.history.shift()
    return true
  }

  /** The fake has no cursor model: insertion appends and fires onChange. */
  insertText(text: string): void {
    this.inserted.push(text)
    this.text += text
    this.onChange?.(this.text)
  }

  setBorderColor(color: BlueColorFn): void {
    this.borderColor = color
  }

  setPromptSymbol(symbol: '>' | '!' | undefined): void {
    this.promptSymbol = symbol
  }

  setBorderLabel(text: string | undefined): void {
    this.borderLabel = text
  }

  setConnectedAbove(connected: boolean): void {
    this.connectedAbove = connected
  }

  setGhostHint(hint: string | undefined): void {
    this.ghostHint = hint
  }

  setAutocompleteProvider(provider: BlueAutocompleteProvider): void {
    this.autocompleteProvider = provider
  }

  isShowingAutocomplete(): boolean {
    return this.showingAutocomplete
  }

  handleInput(data: string): void {
    if (this.onKey?.(data) === true) return
    if (data === KEY.enter) {
      if (!this.disableSubmit) this.onSubmit?.(this.text)
      return
    }
    // Backspace deletes (the pi-tui Editor contract); anything else appends.
    if (data === '\x7f') {
      this.text = this.text.slice(0, -1)
      this.onChange?.(this.text)
      return
    }
    this.text += data
    this.onChange?.(this.text)
  }

  render(width: number): string[] {
    return [truncateToWidth(`>${this.text}`, Math.max(0, width))]
  }

  invalidate(): void {}
}

/**
 * Fake single-select list: Up/Down wrap the highlight, Enter reports the
 * highlighted entry through `onSelect`, Escape calls `onCancel`.
 */
export class FakeBlueSelectList implements BlueSelectList {
  private index = 0

  /**
   * @param options - the list options; retained for test inspection.
   */
  constructor(readonly options: BlueSelectListOptions) {}

  getSelectedItem(): BlueSelectItem | null {
    return this.options.items[this.index] ?? null
  }

  handleInput(data: string): void {
    const { items } = this.options
    if (data === KEY.up || data === KEY.down) {
      if (items.length > 0) {
        this.index = data === KEY.up
          ? this.index === 0 ? items.length - 1 : this.index - 1
          : this.index === items.length - 1 ? 0 : this.index + 1
      }
      const selected = this.getSelectedItem()
      if (selected !== null) this.options.onSelectionChange?.(selected)
      return
    }
    if (data === KEY.enter) {
      const selected = this.getSelectedItem()
      if (selected !== null) this.options.onSelect?.(selected)
      return
    }
    if (data === KEY.escape) this.options.onCancel?.()
  }

  render(width: number): string[] {
    return this.options.items.map((item, at) => truncateToWidth(
      `${at === this.index ? '→ ' : '  '}${item.label}`,
      Math.max(0, width),
    ))
  }

  invalidate(): void {}
}

/** Fake markdown component: settable text, rendered line-split. */
class FakeBlueMarkdown implements BlueMarkdown {
  private text: string

  constructor(options?: BlueMarkdownOptions) {
    this.text = options?.text ?? ''
  }

  setText(text: string): void {
    this.text = text
  }

  render(): string[] {
    return this.text.split('\n')
  }

  invalidate(): void {}
}

/**
 * Fake settings list: records its options for test inspection, mirrors
 * pi-tui's key semantics (Up/Down wrap the highlight, Enter/Space cycles
 * the highlighted item's `values` — reporting through `onChange` — Escape
 * cancels), and truncates each row to the render width (the D48 width
 * discipline: no unbudgeted rows even in fakes).
 */
export class FakeBlueSettingsList implements BlueSettingsList {
  /** The highlighted item index (pi-tui's selectedIndex). */
  private index = 0

  /**
   * @param options - the list options; retained for test inspection.
   */
  constructor(readonly options: BlueSettingsListOptions) {}

  /** updateValue calls, in order. */
  readonly updates: [string, string][] = []

  /**
   * Mirror pi-tui's `updateValue`: set the matching item's displayed value
   * without touching the highlight, and record the call.
   * @param id - the item id.
   * @param newValue - the value to display.
   */
  updateValue(id: string, newValue: string): void {
    this.updates.push([id, newValue])
    const item = this.options.items.find(entry => entry.id === id)
    if (item !== undefined) item.currentValue = newValue
  }

  handleInput(data: string): void {
    const { items } = this.options
    if (data === KEY.up || data === KEY.down) {
      if (items.length > 0) {
        this.index = data === KEY.up
          ? this.index === 0 ? items.length - 1 : this.index - 1
          : this.index === items.length - 1 ? 0 : this.index + 1
      }
      return
    }
    if (data === KEY.enter || data === KEY.space) {
      const item = items[this.index]
      if (item?.values !== undefined && item.values.length > 0) {
        // pi-tui's activateItem: cycle from the current value.
        const next = item.values[(item.values.indexOf(item.currentValue) + 1) % item.values.length]!
        item.currentValue = next
        this.options.onChange(item.id, next)
      }
      return
    }
    if (data === KEY.escape) this.options.onCancel()
  }

  render(width: number): string[] {
    return this.options.items.map(item =>
      truncateToWidth(`${item.label}: ${item.currentValue}`, Math.max(0, width)))
  }

  invalidate(): void {}
}

/**
 * Fake `@`-mention completion source: records its construction facts and
 * reads its behavior through the owning factory instance, so re-programming
 * `mentionGetSuggestions`/`mentionApplyCompletion` reaches providers created
 * earlier and later alike (the real source is rebuilt when the fd probe
 * settles). The real fd pipeline is pinned by the core spec; interaction
 * tests assert only the composition around it.
 */
export class FakeFileMentionProvider implements BlueAutocompleteProvider {
  triggerCharacters: string[] | undefined

  /**
   * @param basePath - the project root the factory was called with.
   * @param fdPath - the fd binary the factory was called with.
   * @param behavior - the owning factory's programmable behavior fields.
   */
  constructor(
    readonly basePath: string,
    readonly fdPath: string | null,
    private readonly behavior: FakeBlueComponents,
  ) {}

  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal, force?: boolean },
  ): Promise<ReturnType<BlueAutocompleteProvider['getSuggestions']>> {
    return this.behavior.mentionGetSuggestions(lines, cursorLine, cursorCol, options)
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: BlueAutocompleteItem,
    prefix: string,
  ): { lines: string[], cursorLine: number, cursorCol: number } {
    return this.behavior.mentionApplyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }

  shouldTriggerFileCompletion(): boolean {
    return true
  }
}

/**
 * Fake component factory: deterministic width helpers and recordable
 * editor/select-list creation for test inspection.
 */
export class FakeBlueComponents implements BlueComponents {
  /** Every editor created through this factory, in creation order. */
  readonly editors: FakeBlueEditor[] = []
  /** The options each editor was created with, in creation order. */
  readonly editorOptions: Array<BlueEditorOptions | undefined> = []
  /** Every select list created through this factory, in creation order. */
  readonly selectLists: FakeBlueSelectList[] = []
  /**
   * Programmable mention-source behavior, shared by every provider this
   * factory creates: suggestions default to none, application to identity.
   */
  mentionGetSuggestions: BlueAutocompleteProvider['getSuggestions'] = async () => null
  mentionApplyCompletion: BlueAutocompleteProvider['applyCompletion'] =
    (lines, _cursorLine, cursorLine, cursorCol) => ({ lines: [...lines], cursorLine, cursorCol })
  /** Every mention source created through this factory, in creation order. */
  readonly mentionProviders: FakeFileMentionProvider[] = []

  createFileMentionProvider(basePath: string, fdPath: string | null): BlueAutocompleteProvider {
    const provider = new FakeFileMentionProvider(basePath, fdPath, this)
    this.mentionProviders.push(provider)
    return provider
  }

  createEditor(options?: BlueEditorOptions): FakeBlueEditor {
    this.editorOptions.push(options)
    const editor = new FakeBlueEditor()
    this.editors.push(editor)
    return editor
  }

  createMarkdown(options?: BlueMarkdownOptions): BlueMarkdown {
    return new FakeBlueMarkdown(options)
  }

  createSelectList(options: BlueSelectListOptions): FakeBlueSelectList {
    const list = new FakeBlueSelectList(options)
    this.selectLists.push(list)
    return list
  }

  /** Every settings list created through this factory, in creation order. */
  readonly settingsLists: FakeBlueSettingsList[] = []

  createSettingsList(options: BlueSettingsListOptions): BlueSettingsList {
    const list = new FakeBlueSettingsList(options)
    this.settingsLists.push(list)
    return list
  }

  /** Every image created through this factory, in creation order. */
  readonly images: BlueImageOptions[] = []

  createImage(options: BlueImageOptions): BlueImage {
    this.images.push(options)
    return {
      render: () => [`[image: ${options.mediaType}]`],
      invalidate: () => {},
    }
  }

  /**
   * Minimal dimension probe: real parsing for PNG (big-endian at offset 16)
   * and GIF (little-endian at offset 6), `undefined` otherwise.
   */
  imageDimensions(data: Uint8Array): { width: number, height: number } | undefined {
    if (data.length >= 24 && data[0] === 0x89 && data[1] === 0x50) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }
    if (data.length >= 10 && data[0] === 0x47 && data[1] === 0x49) {
      return {
        width: (data[6] ?? 0) | ((data[7] ?? 0) << 8),
        height: (data[8] ?? 0) | ((data[9] ?? 0) << 8),
      }
    }
    return undefined
  }

  visibleWidth(text: string): number {
    return visibleWidth(text)
  }

  wrapText(text: string, width: number): string[] {
    return wrapTextWithAnsi(text, width)
  }

  truncateToWidth(text: string, width: number, ellipsis?: string): string {
    return truncateToWidth(text, width, ellipsis)
  }

  /**
   * Subsequence matcher with pi-tui's shape: `matches` plus a lower-is-better
   * score that rewards contiguity (`-2` per character found right where the
   * scan sits, `-1` per gap jump). The real semantics are pinned by the core
   * spec; this fake only needs to be deterministic for ordering assertions.
   */
  fuzzyMatch(query: string, text: string): BlueFuzzyMatch {
    let at = 0
    let score = 0
    for (const char of query) {
      const found = text.indexOf(char, at)
      if (found === -1) return { matches: false, score: 0 }
      score -= found === at ? 2 : 1
      at = found + 1
    }
    return { matches: true, score }
  }

  fuzzyFilter<T>(items: readonly T[], query: string, getText: (item: T) => string): T[] {
    const tokens = query.split(/[\s/]+/).filter(token => token.length > 0)
    return items
      .map(item => {
        let total = 0
        for (const token of tokens) {
          const match = this.fuzzyMatch(token, getText(item))
          if (!match.matches) return null
          total += match.score
        }
        return { item, total }
      })
      .filter((entry): entry is { item: T, total: number } => entry !== null)
      .sort((a, b) => a.total - b.total)
      .map(entry => entry.item)
  }
}

/** One overlay observed by {@link FakeScreen}. */
export interface FakeOverlay {
  readonly component: BlueComponent
  readonly options: BlueOverlayOptions | undefined
  /** The focus holder before this record mounted; restored on dismissal. */
  readonly previous: BlueComponent | null
  readonly handle: BlueOverlayHandle
  hidden: boolean
}

/** Fake screen recording mounts, focus moves, overlays, and render requests. */
export class FakeScreen implements BlueScreen {
  columns = 80
  rows = 24
  readonly children: BlueComponent[] = []
  readonly overlays: FakeOverlay[] = []
  focused: BlueComponent | null = null
  renderRequests = 0
  readonly contentScrolls: Array<{ readonly direction: 'up' | 'down'; readonly amount: number | undefined }> = []
  contentScrollResult = false
  contentPaused = false
  followCount = 0
  /** Terminal-title writes, for the OSC-mirror plugin assertions. */
  readonly titles: string[] = []
  private readonly bottom = new Set<BlueComponent>()
  /** Dock members pinned to the very bottom slot (the footer shell). */
  private readonly bottomPinned = new Set<BlueComponent>()

  addChild(component: BlueComponent): () => void {
    // Mirror the runtime's ordering contract: plain mounts land above every
    // bottom-pinned component regardless of mount order.
    const firstBottom = this.children.findIndex(child => this.bottom.has(child))
    this.children.splice(firstBottom === -1 ? this.children.length : firstBottom, 0, component)
    return () => {
      this.removeChild(component)
    }
  }

  addBottomChild(component: BlueComponent, position?: 'bottom'): () => void {
    this.bottom.add(component)
    // Pinned members render below the rest of the dock, mirroring the
    // runtime's ordering (the footer shell mounts pinned 'bottom').
    if (position === 'bottom') {
      this.bottomPinned.add(component)
      this.children.push(component)
    } else {
      this.bottomPinned.delete(component)
      const firstPinned = this.children.findIndex(child => this.bottomPinned.has(child))
      this.children.splice(firstPinned === -1 ? this.children.length : firstPinned, 0, component)
    }
    return () => {
      this.removeChild(component)
    }
  }

  removeChild(component: BlueComponent): void {
    this.bottom.delete(component)
    this.bottomPinned.delete(component)
    const index = this.children.indexOf(component)
    if (index >= 0) this.children.splice(index, 1)
  }

  setFocus(component: BlueComponent | null): void {
    if (isFocusable(this.focused)) this.focused.focused = false
    this.focused = component
    if (isFocusable(component)) component.focused = true
  }

  scrollContent = (direction: 'up' | 'down', amount?: number): boolean => {
    this.contentScrolls.push({ direction, amount })
    return this.contentScrollResult
  }

  contentChanged(): boolean {
    return this.contentPaused
  }

  followContent(): void {
    this.contentPaused = false
    this.followCount += 1
  }

  private contentScrollHandler: ((data: string) => boolean) | undefined

  setContentScrollHandler(handler: ((data: string) => boolean) | undefined): () => void {
    this.contentScrollHandler = handler
    return () => {
      if (this.contentScrollHandler === handler) this.contentScrollHandler = undefined
    }
  }

  /** Drive the focused-editor transcript navigation seam. */
  sendContentInput(data: string): boolean {
    return this.contentScrollHandler?.(data) ?? false
  }

  showOverlay(component: BlueComponent, options?: BlueOverlayOptions): BlueOverlayHandle {
    this.recordDialog(component, options)
    return this.overlays.at(-1)!.handle
  }

  /**
   * Record an editor-slot dialog panel (the D30 mount) through the same
   * registry as overlays: dialog specs assert one lifecycle — mount,
   * interact with the component, restore — regardless of the mount
   * mechanism. Focus mirrors the swap: the panel takes focus on mount and
   * the disposer restores the previous focus and flags the record hidden.
   * @param component - the dialog panel.
   */
  mountDialogPanel(component: BlueComponent): () => void {
    this.recordDialog(component, undefined)
    const overlay = this.overlays.at(-1)!
    return () => {
      overlay.hidden = true
      this.setFocus(overlay.previous)
    }
  }

  /** Push one dialog/overlay record with its focus bookkeeping. */
  private recordDialog(component: BlueComponent, options: BlueOverlayOptions | undefined): void {
    const previous = this.focused
    const overlay: FakeOverlay = {
      component,
      options,
      previous,
      hidden: false,
      handle: {
        hide: () => {
          overlay.hidden = true
          this.setFocus(previous)
        },
        setHidden: (hidden) => {
          overlay.hidden = hidden
        },
        isHidden: () => overlay.hidden,
        focus: () => {
          this.setFocus(component)
        },
        unfocus: () => {
          this.setFocus(previous)
        },
        isFocused: () => this.focused === component,
      },
    }
    this.overlays.push(overlay)
    this.setFocus(component)
  }

  requestRender(): void {
    this.renderRequests += 1
  }

  /** S31 seam: counts suspends; the body runs unreleased (no renderer here). */
  suspends = 0

  suspend<T>(fn: () => Promise<T>): Promise<T> {
    this.suspends += 1
    return fn()
  }

  setTitle(title: string): void {
    this.titles.push(title)
  }
}

function isFocusable(component: BlueComponent | null): component is BlueFocusable {
  return component !== null && 'focused' in component
}

/** A context with the four fake Blue services provided. */
export function fakeBlueContext(options: { readonly display?: boolean; readonly dock?: boolean } = {}): {
  ctx: Context
  screen: FakeScreen
  theme: FakeTheme
  keymap: FakeKeymap
  components: FakeBlueComponents
} {
  const ctx = new Context()
  const screen = new FakeScreen()
  const theme = new FakeTheme()
  const keymap = new FakeKeymap()
  const components = new FakeBlueComponents()
  if (options.display !== false) {
    ctx.provide('blueScreen', screen as unknown as BlueScreenService)
    // The theme fake casts to the BlueTheme contract: the concrete
    // BlueThemeService class moved to core's theme-dark subpath plugin.
    ctx.provide('blueTheme', theme as unknown as BlueTheme)
    ctx.provide('blueKeymap', keymap as unknown as BlueKeymapService)
    ctx.provide('blueComponents', components as unknown as BlueComponentsService)
  }
  type FakeAgent = {
    readonly id: string
    status: string
    readonly session?: {
      readonly header?: { readonly cwd?: string }
      readonly events?: readonly never[]
      requestHeader?(): unknown
    }
    readonly inbox: {
      readonly nextTurn: readonly { readonly id: string, readonly content: readonly { readonly type: string, readonly text?: string }[] }[]
      readonly nextStep: readonly { readonly id: string, readonly content: readonly { readonly type: string, readonly text?: string }[] }[]
      remove(id: string): boolean
    }
    followup(message: unknown): void
    steer(message: unknown): void
    cancel(reason: { readonly kind: 'user' }): void
  }
  const active = (): FakeAgent | undefined => {
    const value = ctx.get('testSession')?.current as unknown
    return value === null || value === undefined ? undefined : value as FakeAgent
  }
  const yoloByAgent = new WeakMap<object, boolean>()
  const readMode = (): { mode: 'normal' | 'plan' | 'yolo', pending: boolean } | undefined => {
    const agent = active()
    if (agent === undefined) return undefined
    let yolo = yoloByAgent.get(agent)
    if (yolo === undefined) {
      yolo = foldYolo(agent.session?.events ?? [])
      yoloByAgent.set(agent, yolo)
    }
    if (yolo) return { mode: 'yolo', pending: false }
    const planMode = ctx.get('planMode') as unknown as { get(agent: unknown): { active: boolean, pending?: boolean } } | undefined
    const state = planMode?.get(agent)
    if (state?.pending === true) return { mode: 'plan', pending: true }
    return { mode: state?.active === true ? 'plan' : 'normal', pending: false }
  }
  const snapshot = () => {
    const agent = active()
    if (agent === undefined) return null
    const selection = ctx.get('testSession')?.modelRef?.current
    return {
      id: String(agent.id),
      cwd: agent.session?.header?.cwd ?? process.cwd(),
      status: agent.status === 'running' ? 'running' as const : 'idle' as const,
      mode: readMode()?.mode ?? 'normal',
      ...(selection === undefined ? {} : {
        model: {
          id: selection.model,
          provider: selection.provider,
          ...(selection.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }),
        },
      }),
    }
  }
  const sessionListeners = new Set<(value: ReturnType<typeof snapshot>) => void>()
  const publishSession = (): void => {
    const value = snapshot()
    for (const listener of sessionListeners) listener(value)
  }
  ctx.provide('blueSessionReader', {
    current: snapshot,
    subscribe(listener) {
      sessionListeners.add(listener)
      listener(snapshot())
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          sessionListeners.delete(listener)
        },
      }
    },
    async request(action) {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      if (action.kind === 'interrupt') agent.cancel({ kind: 'user' })
      else {
        const message = createUserMessage({ content: [{ type: 'text', text: action.text }], source: { kind: 'user' } })
        if (action.kind === 'followup') agent.followup(message)
        else agent.steer(message)
      }
      return { ok: true as const, value: undefined }
    },
  })
  ctx.provide('blueRequests', { begin: () => ({ sessionEpoch: 0, requestEpoch: 1, scope: 'main' }) } as never)
  ctx.provide('blueRetractions', { tryRetract: () => false })
  const textOf = (message: FakeAgent['inbox']['nextTurn'][number]): string =>
    message.content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n')
  const sessionActions = {
    followup(blocks) {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      const message = createUserMessage({ content: [...blocks] as never, source: { kind: 'user' } })
      agent.followup(message)
      return { ok: true as const, value: { messageId: String(message.id) } }
    },
    steer(blocks) {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      const message = createUserMessage({ content: [...blocks] as never, source: { kind: 'user' } })
      agent.steer(message)
      return { ok: true as const, value: { messageId: String(message.id) } }
    },
    interrupt() {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      if (agent.status !== 'running') return { ok: false as const, code: 'BLUE_ACTION_REJECTED' as const, message: 'No active request' }
      agent.cancel({ kind: 'user' })
      return { ok: true as const, value: undefined }
    },
    queued() {
      const agent = active()
      if (agent === undefined) return []
      return [
        ...agent.inbox.nextTurn.map(message => ({ id: String(message.id), target: 'turn' as const, text: textOf(message) })),
        ...agent.inbox.nextStep.map(message => ({ id: String(message.id), target: 'step' as const, text: textOf(message) })),
      ]
    },
    async flush() {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      await ctx.get('sessions')?.flush(agent.session as never)
      return { ok: true as const, value: undefined }
    },
    rewindCandidates() {
      const events = (active() as unknown as { readonly session?: { readonly events?: readonly never[] } } | undefined)?.session?.events
      return events === undefined ? [] : rewindCandidates(events)
    },
    commands() {
      const agent = active()
      const commands = ctx.get('commands')
      if (agent === undefined || commands === undefined) return []
      return commands.list(agent as never).map(command => ({
        name: command.name,
        description: command.description,
        ...(command.input?.hint === undefined ? {} : { inputHint: command.input.hint }),
      }))
    },
    executeCommand(line, signal = new AbortController().signal) {
      const agent = active()
      const commands = ctx.get('commands')
      return agent === undefined || commands === undefined
        ? Promise.resolve(undefined)
        : commands.execute(agent as never, line, [], signal)
    },
    modeState: readMode,
    planModeAvailable() {
      return ctx.get('planMode') !== undefined
    },
    setYolo(enabled: boolean) {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      if (enabled) {
        const planMode = ctx.get('planMode') as unknown as { set(agent: unknown, active: boolean): unknown } | undefined
        if (typeof planMode?.set === 'function') planMode.set(agent, false)
      }
      yoloByAgent.set(agent, enabled)
      publishSession()
      return { ok: true as const, value: undefined }
    },
    permissionPreset() {
      const agent = active()
      const presets = ctx.get('permissionPresets') as unknown as { current(events: readonly unknown[]): string } | undefined
      const events = (agent as unknown as { session?: { events?: readonly unknown[] } } | undefined)?.session?.events
      return presets === undefined || events === undefined ? undefined : presets.current(events)
    },
    sessionDetails() {
      const agent = active()
      if (agent?.session === undefined) return undefined
      const source = ctx.get('sessionProjections') as unknown as {
        snapshot(session: unknown): { values: Readonly<Record<string, unknown>> }
      } | undefined
      return buildSessionDetails(
        agent as never,
        sessionActions.modelSelection(),
        source?.snapshot(agent.session).values,
      )
    },
    modelSelection() {
      const selection = ctx.get('testSession')?.modelRef?.current
      if (selection !== undefined) return selection
      const header = active()?.session?.requestHeader?.() as {
        readonly config?: { readonly provider: string, readonly model: string, readonly reasoningEffort?: string }
      } | undefined
      return header?.config
    },
    hasRequestHeader() {
      return active()?.session?.requestHeader?.() !== undefined
    },
    selectModel(selection) {
      const ref = ctx.get('testSession')?.modelRef
      if (ref === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      const previous = ref.current
      ref.current = selection as never
      publishSession()
      return { ok: true as const, value: previous }
    },
    isCurrentAgent(candidate: unknown) {
      return candidate === active()
    },
    steerCurrentAgent(candidate: unknown, text: string) {
      const agent = active()
      if (agent === undefined || candidate !== agent) {
        return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      }
      agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      return { ok: true as const, value: undefined }
    },
    async presets() {
      const roster = ctx.get('agentPresets') as unknown as {
        list(): Promise<readonly {
          readonly id: string
          readonly trust: 'system' | 'user'
          readonly name?: string
          readonly description?: string
          readonly order?: number
          readonly broken?: string
        }[]>
      } | undefined
      if (roster === undefined) {
        return { ok: false as const, code: 'BLUE_CAPABILITY_ABSENT' as const, message: 'agent presets are unavailable: the host composes no roster' }
      }
      try {
        return { ok: true as const, value: await roster.list() }
      } catch (error) {
        return {
          ok: false as const,
          code: 'BLUE_ACTION_REJECTED' as const,
          message: `could not list presets: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
    currentPreset() {
      const agent = active()
      const roster = ctx.get('agentPresets') as unknown as {
        composedPreset(agentCtx: unknown): string | undefined
      } | undefined
      return agent === undefined || roster === undefined ? undefined : roster.composedPreset(agent.ctx)
    },
    async selectPreset(id: string) {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      const roster = ctx.get('agentPresets') as unknown as {
        recompose(agentCtx: unknown, id: string): Promise<{ readonly id: string }>
      } | undefined
      if (roster === undefined) {
        return { ok: false as const, code: 'BLUE_CAPABILITY_ABSENT' as const, message: 'agent presets are unavailable: the host composes no roster' }
      }
      if (agent.status !== 'idle') {
        return { ok: false as const, code: 'BLUE_ACTION_REJECTED' as const, message: 'cannot switch presets while the agent is running' }
      }
      const session = agent.session as { readonly events?: readonly { readonly type: string }[], append(type: string, data: unknown): void } | undefined
      if (session?.events?.some(event => event.type === 'turn/start') === true) {
        return { ok: false as const, code: 'BLUE_ACTION_REJECTED' as const, message: 'cannot switch presets: this session has already started (blank sessions only)' }
      }
      try {
        const selected = await roster.recompose(agent.ctx, id)
        if (active() !== agent) {
          return { ok: false as const, code: 'BLUE_ABORTED' as const, message: 'the active session changed before the preset switch completed' }
        }
        session?.append('agent-preset/selected', { agentPreset: selected.id })
        return { ok: true as const, value: `preset ${selected.id}` }
      } catch (error) {
        return {
          ok: false as const,
          code: 'BLUE_ACTION_REJECTED' as const,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async toolCatalog() {
      const tools = ctx.get('tools') as unknown as {
        schemas(scope?: unknown): readonly {
          readonly name: string
          readonly description: string
          readonly parameters?: Readonly<Record<string, unknown>>
        }[]
      } | undefined
      if (tools === undefined) {
        return { ok: false as const, code: 'BLUE_CAPABILITY_ABSENT' as const, message: 'tool registry is unavailable: the host composes no tools service' }
      }
      const registered = tools.schemas()
      const agent = active()
      if (agent === undefined) return { ok: true as const, value: { sessionLive: false, registered, visible: registered } }
      const roster = ctx.get('agentPresets') as unknown as {
        composedPreset(agentCtx: unknown): string | undefined
        standingKeyFor(id?: string): Promise<object>
      } | undefined
      try {
        const current = roster?.composedPreset(agent.ctx)
        const scope = roster === undefined || current === undefined ? undefined : await roster.standingKeyFor(current)
        if (active() !== agent) {
          return { ok: false as const, code: 'BLUE_ABORTED' as const, message: 'the active session changed before the tool catalog completed' }
        }
        return {
          ok: true as const,
          value: { sessionLive: true, registered, visible: scope === undefined ? registered : tools.schemas(scope) },
        }
      } catch (error) {
        return {
          ok: false as const,
          code: 'BLUE_ACTION_REJECTED' as const,
          message: `could not resolve the preset composition: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },
    async skillSnapshot() {
      const agent = active()
      if (agent === undefined) return { ok: false as const, code: 'BLUE_SESSION_UNAVAILABLE' as const, message: 'No session' }
      const skills = ctx.get('skills') as unknown as {
        snapshot(options: { readonly cwd?: string, readonly scope: unknown }): Promise<{
          readonly complete: boolean
          readonly skills: readonly {
            readonly name: string
            readonly description: string
            readonly whenToUse?: string
            readonly source: string
            readonly invocation: { readonly modelInvocable: boolean, readonly userInvocable: boolean }
          }[]
        }>
      } | undefined
      if (skills === undefined) {
        return { ok: false as const, code: 'BLUE_CAPABILITY_ABSENT' as const, message: 'the host composes no skills service' }
      }
      try {
        const cwd = agent.session?.header?.cwd
        const value = await skills.snapshot({ ...(cwd === undefined ? {} : { cwd }), scope: agent })
        if (active() !== agent) {
          return { ok: false as const, code: 'BLUE_ABORTED' as const, message: 'the active session changed before the skill snapshot completed' }
        }
        return { ok: true as const, value }
      } catch (error) {
        return {
          ok: false as const,
          code: 'BLUE_ACTION_REJECTED' as const,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
    subscribeSkillChanges(listener: () => void) {
      const off = ctx.on('skills/change', listener)
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          off()
        },
      }
    },
    async createSideSession() { return undefined },
  }
  ctx.provide('blueSessionActions', sessionActions)
  ctx.provide('blueSessionProjections', {
    current: (key: string) => {
      const agent = active()
      const source = ctx.get('sessionProjections') as unknown as { snapshot(session: unknown): { asOfSeq?: number, values: Record<string, unknown> } } | undefined
      if (agent?.session === undefined || source === undefined) return undefined
      const value = source.snapshot(agent.session)
      return { asOfSeq: value.asOfSeq ?? 0, value: value.values[key] }
    },
    currentMany: (keys: readonly string[]) => {
      const agent = active()
      const source = ctx.get('sessionProjections') as unknown as { snapshot(session: unknown): { asOfSeq?: number, values: Record<string, unknown> } } | undefined
      if (agent?.session === undefined || source === undefined) return undefined
      const snapshot = source.snapshot(agent.session)
      return { asOfSeq: snapshot.asOfSeq ?? 0, values: Object.fromEntries(keys.map(key => [key, snapshot.values[key]])) }
    },
    subscribe: (listener: (key: string, value: unknown, seq: number) => void) => {
      const source = ctx.get('sessionProjections') as unknown as {
        onChanged(callback: (session: unknown, key: string, value: unknown, seq: number) => void): () => void
      } | undefined
      if (source === undefined) return () => {}
      return source.onChanged((session, key, value, seq) => {
        if (session === active()?.session) listener(key, value, seq)
      })
    },
    children: () => [],
    subscribeChildren: () => () => {},
  })
  ctx.on('test/session-changed', publishSession)
  const inboxChanged = (payload: { readonly agent?: unknown }): void => {
    if (payload.agent === active()) publishSession()
  }
  ctx.on('agent/inbox/inserted', inboxChanged)
  ctx.on('agent/inbox/claimed', inboxChanged)
  ctx.on('agent/inbox/discarded', inboxChanged)
  ctx.on('agent/status', publishSession)
  ctx.on('commands/change', publishSession)
  ctx.on('session/event', (session, event) => {
    const agent = active()
    if (agent?.session === undefined || session !== agent.session) return
    publishSession()
    if (event.type !== 'plan/mode' || !event.data.active || readMode()?.mode !== 'yolo') return
    queueMicrotask(() => {
      void sessionActions.executeCommand('/yolo off').then((execution) => {
        const text = execution?.result.text
        if (text !== undefined) ctx.emit('blue/mode-notice', text)
      }, (error: unknown) => {
        ctx.logger.warn(`yolo exclusivity dispatch failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  })
  new SkillsCatalogService(ctx)
  new InteractionStateService(ctx, DEFAULT_SETTINGS)
  if (options.dock !== false) new BlueDockModelService(ctx, screen)
  new EditorHostService(ctx)
  // The D30 editor-slot swap stands in for `blue-input`'s real machinery:
  // dialog specs assert the mounted panel through the overlay registry.
  setEditorSlotSwap(ctx, { mount: component => screen.mountDialogPanel(component) })
  // Installing the dock model performs one initial synchronization repaint.
  // Tests count repaints caused by the behavior under test, not fixture boot.
  screen.renderRequests = 0
  return { ctx, screen, theme, keymap, components }
}
