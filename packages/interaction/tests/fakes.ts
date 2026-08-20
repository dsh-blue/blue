/**
 * Shared test doubles for the Blue interaction suites: fake BlueScreen,
 * BlueTheme, BlueKeymap, and BlueComponents (in-memory BlueEditor and
 * BlueSelectList) implementing the L1 contracts with observable state, plus
 * helpers to mount a context with the fakes provided.
 */

import { Context } from '@deepseek-ai/cordis'
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
import { setEditorSlotSwap } from '../src/editor-instance.ts'
import {
  INTERACTION_KEY_ACTIONS,
} from '../src/keys.ts'

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
  'ctrl+v': '\x16',
  'alt+s': '\x1bs',
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
  tab: '\t',
  shiftTab: '\x1b[Z',
  space: ' ',
  ctrlC: '\x03',
  ctrlS: '\x13',
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
    // reached the cursor (S10 left the token unused; BlueSelect is its
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

/** Strip ANSI SGR sequences for the fake width math. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/** Deterministic visible width: the SGR-stripped character count. */
function fakeVisibleWidth(text: string): number {
  return stripAnsi(text).length
}

/** Deterministic truncation: SGR-stripped character cut plus the ellipsis. */
function fakeTruncate(text: string, width: number, ellipsis = '...'): string {
  const plain = stripAnsi(text)
  if (plain.length <= width) return text
  if (width <= 0) return ''
  return plain.slice(0, Math.max(0, width - ellipsis.length)) + ellipsis
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
    this.text += data
    this.onChange?.(this.text)
  }

  render(width: number): string[] {
    return [fakeTruncate(`>${this.text}`, Math.max(0, width))]
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
    return this.options.items.map((item, at) => fakeTruncate(
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

/** Fake settings list: one row per item; change handling is out of scope. */
function fakeSettingsList(options: BlueSettingsListOptions): BlueSettingsList {
  return {
    render: () => options.items.map(item => `${item.label}: ${item.currentValue}`),
    invalidate: () => {},
  }
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

  createSettingsList(options: BlueSettingsListOptions): BlueSettingsList {
    return fakeSettingsList(options)
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
    return fakeVisibleWidth(text)
  }

  wrapText(text: string, width: number): string[] {
    return text.split('\n').map(line => fakeTruncate(line, width, ''))
  }

  truncateToWidth(text: string, width: number, ellipsis?: string): string {
    return ellipsis === undefined ? fakeTruncate(text, width) : fakeTruncate(text, width, ellipsis)
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
}

function isFocusable(component: BlueComponent | null): component is BlueFocusable {
  return component !== null && 'focused' in component
}

/** A context with the four fake Blue services provided. */
export function fakeBlueContext(): {
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
  ctx.provide('blueScreen', screen as unknown as BlueScreenService)
  // The theme fake casts to the BlueTheme contract: the concrete
  // BlueThemeService class moved to core's theme-dark subpath plugin.
  ctx.provide('blueTheme', theme as unknown as BlueTheme)
  ctx.provide('blueKeymap', keymap as unknown as BlueKeymapService)
  ctx.provide('blueComponents', components as unknown as BlueComponentsService)
  // The D30 editor-slot swap stands in for `blue-input`'s real machinery:
  // dialog specs assert the mounted panel through the overlay registry.
  setEditorSlotSwap({ mount: component => screen.mountDialogPanel(component) })
  return { ctx, screen, theme, keymap, components }
}
