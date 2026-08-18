/**
 * Shared test doubles for the Blue interaction suites: fake BlueScreen,
 * BlueTheme, BlueKeymap, and BlueComponents (in-memory BlueEditor and
 * BlueSelectList) implementing the L1 contracts with observable state, plus
 * helpers to mount a context with the fakes provided.
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  BlueAutocompleteProvider,
  BlueColorFn,
  BlueComponent,
  BlueComponents,
  BlueEditor,
  BlueFocusable,
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
} from '@deepseek-ai/dsh-blue-core'
import type { BlueScreenService, BlueKeymapService, BlueComponentsService } from '@deepseek-ai/dsh-blue-core'
import {
  ACTION_CANCEL,
  ACTION_INTERRUPT,
  ACTION_MOVE_DOWN,
  ACTION_MOVE_UP,
  ACTION_STEER,
  ACTION_SUBMIT,
  ACTION_TOGGLE,
} from '../src/keys.ts'

/** Decoded sequences the fake keymap binds to each interaction action. */
const FAKE_KEY_SEQUENCES: Record<string, string[]> = {
  [ACTION_SUBMIT]: ['\r'],
  [ACTION_CANCEL]: ['\x1b'],
  [ACTION_MOVE_UP]: ['\x1b[A'],
  [ACTION_MOVE_DOWN]: ['\x1b[B'],
  [ACTION_TOGGLE]: [' '],
  [ACTION_INTERRUPT]: ['\x03'],
  [ACTION_STEER]: ['\x13'],
}

/** Key-id labels the fake keymap reports for hint text. */
const FAKE_KEY_IDS: Record<string, string[]> = {
  [ACTION_SUBMIT]: ['enter'],
  [ACTION_CANCEL]: ['escape'],
  [ACTION_MOVE_UP]: ['up'],
  [ACTION_MOVE_DOWN]: ['down'],
  [ACTION_TOGGLE]: ['space'],
  [ACTION_INTERRUPT]: ['ctrl+c'],
  [ACTION_STEER]: ['ctrl+s'],
}

/** Convenience aliases for the fake key sequences. */
export const KEY = {
  enter: '\r',
  escape: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  space: ' ',
  ctrlC: '\x03',
  ctrlS: '\x13',
} as const

/** Fake keymap: exact-sequence matching for `matches`, key-id labels for `getKeys`. */
export class FakeKeymap implements BlueKeymap {
  private readonly sequences = new Map<string, string[]>()
  private readonly ids = new Map<string, string[]>()
  private readonly handlers = new Map<string, () => void>()

  /**
   * @param withDefaults - preload the interaction action bindings; pass
   *   false to test unregistered-action fallbacks.
   */
  constructor(withDefaults = true) {
    if (!withDefaults) return
    for (const [action, keys] of Object.entries(FAKE_KEY_SEQUENCES)) this.sequences.set(action, [...keys])
    for (const [action, keys] of Object.entries(FAKE_KEY_IDS)) this.ids.set(action, [...keys])
  }

  register(actions: BlueKeyAction[]): () => void {
    for (const action of actions) {
      const keys = typeof action.keys === 'string' ? [action.keys] : [...action.keys]
      this.ids.set(action.id, keys)
      this.sequences.set(action.id, keys)
      if (action.handler !== undefined) this.handlers.set(action.id, action.handler)
    }
    return () => {
      for (const action of actions) {
        this.ids.delete(action.id)
        this.sequences.delete(action.id)
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
}

const identity = (text: string): string => text

/** Marker-wrapping color functions so tests can assert which role styled a row. */
function fakeColors(): BlueSemanticColors {
  return {
    text: identity,
    textStrong: text => `#${text}#`,
    muted: text => `~${text}~`,
    accent: text => `*${text}*`,
    border: identity,
    borderFocus: text => `%${text}%`,
    success: identity,
    error: text => `!${text}!`,
    warning: text => `?${text}?`,
    selectedBg: identity,
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
  /** Every line recorded through `addToHistory`, in order. */
  readonly history: string[] = []
  /** The last border color set; identity until restyled. */
  borderColor: BlueColorFn = identity
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
    this.history.push(text)
  }

  setBorderColor(color: BlueColorFn): void {
    this.borderColor = color
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
 * Fake component factory: deterministic width helpers and recordable
 * editor/select-list creation for test inspection.
 */
export class FakeBlueComponents implements BlueComponents {
  /** Every editor created through this factory, in creation order. */
  readonly editors: FakeBlueEditor[] = []
  /** Every select list created through this factory, in creation order. */
  readonly selectLists: FakeBlueSelectList[] = []

  createEditor(): FakeBlueEditor {
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

  visibleWidth(text: string): number {
    return fakeVisibleWidth(text)
  }

  wrapText(text: string, width: number): string[] {
    return text.split('\n').map(line => fakeTruncate(line, width, ''))
  }

  truncateToWidth(text: string, width: number, ellipsis?: string): string {
    return ellipsis === undefined ? fakeTruncate(text, width) : fakeTruncate(text, width, ellipsis)
  }
}

/** One overlay observed by {@link FakeScreen}. */
export interface FakeOverlay {
  readonly component: BlueComponent
  readonly options: BlueOverlayOptions | undefined
  readonly handle: BlueOverlayHandle
  hidden: boolean
}

/** Fake screen recording mounts, focus moves, overlays, and render requests. */
export class FakeScreen implements BlueScreen {
  columns = 80
  readonly children: BlueComponent[] = []
  readonly overlays: FakeOverlay[] = []
  focused: BlueComponent | null = null
  renderRequests = 0
  private readonly bottom = new Set<BlueComponent>()

  addChild(component: BlueComponent): () => void {
    // Mirror the runtime's ordering contract: plain mounts land above every
    // bottom-pinned component regardless of mount order.
    const firstBottom = this.children.findIndex(child => this.bottom.has(child))
    this.children.splice(firstBottom === -1 ? this.children.length : firstBottom, 0, component)
    return () => {
      this.removeChild(component)
    }
  }

  addBottomChild(component: BlueComponent): () => void {
    this.bottom.add(component)
    this.children.push(component)
    return () => {
      this.removeChild(component)
    }
  }

  removeChild(component: BlueComponent): void {
    this.bottom.delete(component)
    const index = this.children.indexOf(component)
    if (index >= 0) this.children.splice(index, 1)
  }

  setFocus(component: BlueComponent | null): void {
    if (isFocusable(this.focused)) this.focused.focused = false
    this.focused = component
    if (isFocusable(component)) component.focused = true
  }

  showOverlay(component: BlueComponent, options?: BlueOverlayOptions): BlueOverlayHandle {
    const previous = this.focused
    const overlay: FakeOverlay = {
      component,
      options,
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
    return overlay.handle
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
  return { ctx, screen, theme, keymap, components }
}
