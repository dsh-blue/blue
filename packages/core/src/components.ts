/**
 * `ctx.blueComponents` service: the L1 component factory. Maps the active
 * semantic color table to pi-tui's per-component themes inside L0, so the
 * color-table → renderer-theme mapping lives in exactly one place and no
 * pi-tui type crosses the package boundary. Width helpers are re-exported
 * under Blue signatures, passing straight through to pi-tui.
 *
 * @module @dsh-blue/blue-core/components
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  CombinedAutocompleteProvider,
  Editor,
  Image,
  Markdown,
  SelectList,
  SettingsList,
  fuzzyFilter,
  fuzzyMatch,
  getImageDimensions,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type EditorOptions,
  type EditorTheme,
  type ImageOptions,
  type ImageTheme,
  type MarkdownTheme,
  type SelectListTheme,
  type SettingItem,
  type SettingsListTheme,
  type TUI,
} from '@earendil-works/pi-tui'
import { highlightCodeLines } from './highlight.ts'
import {
  highlightLeadingSlashToken,
  injectGhostHint,
  injectPromptSymbol,
  padColumns,
  topRule as renderTopRule,
  withSideBorders,
} from './chrome.ts'
import { WrappingSelectList } from './wrapping-select-list.ts'
import type {
  BlueAutocompleteProvider,
  BlueColorFn,
  BlueComponents,
  BlueEditor,
  BlueEditorOptions,
  BlueEditorSubmitAttempt,
  BlueFuzzyMatch,
  BlueImage,
  BlueImageOptions,
  BlueMarkdown,
  BlueMarkdownOptions,
  BlueSelectItem,
  BlueSelectList,
  BlueSelectListOptions,
  BlueSemanticColors,
  BlueSettingsList,
  BlueSettingsListOptions,
  BlueTheme,
  BlueTopRuleOptions,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueComponents: BlueComponentsService
  }
}

/**
 * Map the palette to an editor theme: the frame's neutral border plus the
 * autocomplete dropdown. The default border is the neutral gray `border`
 * token — with the S11 rounded-box chrome the contextual cues (slash
 * context and bash mode recolor the border through `setBorderColor`)
 * carry the focus, the kimi treatment; the S10 interim that pinned the
 * idle border to `primary` retired with the bare two-line editor it was
 * compensating for.
 */
function editorTheme(colors: BlueSemanticColors): EditorTheme {
  return { borderColor: colors.border, selectList: selectListTheme(colors) }
}

/** Map the palette to a select-list theme. */
function selectListTheme(colors: BlueSemanticColors): SelectListTheme {
  return {
    selectedPrefix: colors.primary,
    selectedText: colors.primary,
    description: colors.textMuted,
    scrollInfo: colors.textMuted,
    noMatch: colors.textMuted,
  }
}

/**
 * Map the palette to a markdown theme: the ten md* tokens plus emphasis.
 * Headings carry their level through bold (0.84.2 exposes a single
 * `heading` fn, so kimi's per-level styling is out of reach), unordered
 * markers are normalized to `•`, and fenced code goes through cli-highlight
 * via `highlightCode`, which recolors lines without changing their count.
 */
function markdownTheme(colors: BlueSemanticColors): MarkdownTheme {
  return {
    heading: (text) => `\x1b[1m${colors.mdHeading(text)}\x1b[22m`,
    link: colors.mdLink,
    linkUrl: colors.mdLinkUrl,
    code: colors.mdCode,
    codeBlock: colors.mdCodeBlock,
    codeBlockBorder: colors.mdCodeBlockBorder,
    quote: colors.mdQuote,
    quoteBorder: colors.mdQuoteBorder,
    hr: colors.mdHr,
    listBullet: (marker) => colors.mdListBullet(marker.replace(/^[-+*] $/, '• ')),
    bold: colors.textStrong,
    italic: colors.text,
    strikethrough: colors.muted,
    underline: colors.text,
    highlightCode: (code, lang) => highlightCodeLines(code, lang, colors.mdCodeBlock),
  }
}

/** Map the palette to an image theme: only the text-fallback color is used. */
function imageTheme(colors: BlueSemanticColors): ImageTheme {
  return { fallbackColor: colors.muted }
}

/**
 * Map the palette to a settings-list theme; `cursor` is a plain string.
 * The selected row's label and value take the interaction primary (S12
 * closes the S10 review item that left them on accent — the selected row
 * is an interaction target, `primary` is its token). Unselected values
 * paint plain `text`, not `muted`: the value column is content, and a dim
 * value column left the selected row indistinguishable (the S38 contrast
 * finding).
 */
function settingsListTheme(colors: BlueSemanticColors): SettingsListTheme {
  return {
    label: (text, selected) => (selected ? colors.primary(text) : colors.text(text)),
    value: (text, selected) => (selected ? colors.primary(text) : colors.text(text)),
    description: colors.muted,
    cursor: colors.primary('❯ '),
    hint: colors.muted,
  }
}

/**
 * The autocomplete-list factory pi-tui's `Editor` calls when new suggestions
 * arrive. pi-tui keeps it private; `createEditor` shadows it with an own
 * property (the kimi CustomEditor idiom — an own property beats the
 * prototype method), and the components spec pins the shadow against 0.84.2.
 */
interface AutocompleteListFactory {
  createAutocompleteList: (prefix: string, items: BlueSelectItem[]) => SelectList
}

/** The slash-menu primary column clamp, mirroring upstream's constant. */
const SLASH_SELECT_LIST_LAYOUT = { minPrimaryColumnWidth: 12, maxPrimaryColumnWidth: 32 }

/** Theme-derived paints the editor chrome overlays (S14 completion polish). */
export interface EditorChromePaints {
  /** Styling for the leading `/command` token (bold + `primary`). */
  readonly slashTokenPaint: (text: string) => string
  /** Styling for the argument-hint ghost (`textMuted`). */
  readonly ghostHintPaint: (text: string) => string
}

/** Token boundary characters ending a non-mention prefix (the kimi set). */
const MENTION_DELIMITERS = new Set([' ', '\t', '"', "'", '='])

/**
 * The token before the cursor when it is an `@` mention — the kimi
 * `extractAtPrefix` port: scan back to the nearest path delimiter; the
 * token from there must start with `@`. Quoted mentions degrade after the
 * first enclosed space, the same corner kimi's app-level extraction has
 * (the token restarts at the space).
 * @param text - the text before the cursor on the cursor's line.
 * @returns the mention token with its `@`, or `null` outside a mention.
 */
function mentionTokenBeforeCursor(text: string): string | null {
  let start = 0
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (MENTION_DELIMITERS.has(text.charAt(i))) {
      start = i + 1
      break
    }
  }
  return text.charAt(start) === '@' ? text.slice(start) : null
}

function withoutFakeEditorCursor(row: string): string {
  // pi-tui paints exactly one grapheme (or trailing space) in inverse video
  // even while unfocused; form navigation needs the text without that caret.
  return row.replace(/\x1b\[7m([\s\S]*?)\x1b\[0m/u, '$1')
}

/** Delegate exposing a pi-tui `Editor` through the Blue contract. */
class EditorAdapter implements BlueEditor {
  /**
   * Pre-dispatch hook checked by {@link EditorAdapter.handleInput} before
   * the pi-tui editor sees the input; owned by the adapter because pi-tui's
   * Editor has no equivalent interception point.
   */
  onKey: ((data: string) => boolean) | undefined

  /** Host-owned submission barrier installed above the L0 clear path. */
  private submitAttemptHandler: ((attempt: BlueEditorSubmitAttempt) => void) | undefined

  /** Latest outstanding submission, if its owner has not settled it. */
  private activeSubmit: { readonly revision: number, cancel(): void } | undefined

  /** Monotonic submission revision; a newer attempt invalidates the previous. */
  private submitRevision = 0

  /** Changes whenever the host replaces the barrier callback. */
  private submitBarrierRevision = 0

  /** Changes whenever the expanded editor buffer changes. */
  private mutationRevision = 0

  /** Last raw and paste-expanded values observed through the adapter boundary. */
  private observedBuffer: { readonly raw: string, readonly expanded: string }

  /** Original pi-tui submit implementation, captured before the shadow. */
  private readonly nativeSubmit: () => void

  /** The prompt symbol overlaid on the first content row; none while unset. */
  private promptSymbol: string | undefined

  /** Pre-styled text laid into the top border; none while unset. */
  private borderLabel: string | undefined

  /** Whether the top corners open into a panel docked above (S13 btw dock). */
  private connectedAbove = false

  /** The argument-hint ghost (S14); none while unset. */
  private ghostHint: string | undefined

  constructor(
    private readonly editor: Editor,
    private readonly chrome: EditorChromePaints,
  ) {
    this.observedBuffer = { raw: editor.getText(), expanded: editor.getExpandedText() }
    const bridge = editor as unknown as { submitValue(): void }
    this.nativeSubmit = bridge.submitValue.bind(editor)
    bridge.submitValue = () => { this.requestSubmit() }
  }

  get focused(): boolean {
    return this.editor.focused
  }

  set focused(value: boolean) {
    this.editor.focused = value
  }

  get onSubmit(): ((text: string) => void) | undefined {
    return this.editor.onSubmit
  }

  set onSubmit(callback: ((text: string) => void) | undefined) {
    if (callback === undefined) delete this.editor.onSubmit
    else this.editor.onSubmit = callback
  }

  setSubmitBarrier(callback: ((attempt: BlueEditorSubmitAttempt) => void) | undefined): void {
    this.submitBarrierRevision += 1
    this.submitAttemptHandler = callback
    this.activeSubmit?.cancel()
  }

  get onChange(): ((text: string) => void) | undefined {
    return this.editor.onChange
  }

  set onChange(callback: ((text: string) => void) | undefined) {
    if (callback === undefined) delete this.editor.onChange
    else this.editor.onChange = callback
  }

  get disableSubmit(): boolean {
    return this.editor.disableSubmit
  }

  set disableSubmit(value: boolean) {
    this.editor.disableSubmit = value
  }

  getText(): string {
    return this.editor.getText()
  }

  setText(text: string): void {
    this.editor.setText(text)
    this.observeMutation()
  }

  submit(): void {
    if (this.disableSubmit) return
    this.requestSubmit()
  }

  addToHistory(text: string): void {
    this.editor.addToHistory(text)
  }

  getHistory(): readonly string[] {
    // pi-tui types `history` private (0.84.2) though it is a plain instance
    // field; the single structural cast (via `unknown` — the private field
    // blocks a direct overlap) is pinned by the components spec.
    const history = (this.editor as unknown as { history: string[] }).history
    return [...history]
  }

  removeLatestHistory(text: string): boolean {
    const history = (this.editor as unknown as { history: string[] }).history
    if (history[0] !== text) return false
    history.shift()
    return true
  }

  setBorderColor(color: BlueColorFn): void {
    this.editor.borderColor = color
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

  /**
   * Whether the cursor sits at the end of the input's first line — the only
   * position the argument-hint ghost belongs (the kimi `computeArgumentHint`
   * cursor gate). History recall parks the cursor at the recalled text's
   * start, and a mid-text cursor means the user is editing, not about to
   * supply arguments; in both the ghost declines.
   * @returns whether the ghost may render.
   */
  private cursorAtInputEnd(): boolean {
    const { line, col } = this.editor.getCursor()
    if (line !== 0) return false
    // The buffer always carries at least one line (pi-tui normalizes even
    // an empty setText to ['']); the fallback only satisfies the
    // index-access checker.
    /* v8 ignore next -- defensive default, unreachable with a real editor */
    const first = this.editor.getLines()[0] ?? ''
    return col === first.length
  }

  setAutocompleteProvider(provider: BlueAutocompleteProvider): void {
    // BlueAutocompleteProvider is structurally identical to pi-tui's
    // AutocompleteProvider, so it passes through without wrapping; the pi-tui
    // type itself never crosses the Blue signature.
    this.editor.setAutocompleteProvider(provider)
  }

  getExpandedText(): string {
    return this.editor.getExpandedText()
  }

  renderContent(width: number, masked = false): string[] {
    const state = (this.editor as unknown as { state: { lines: string[] } }).state
    const original = state.lines
    if (masked) {
      state.lines = original.map(line => '•'.repeat(line.length))
      this.editor.invalidate()
    }
    try {
      const rows = this.editor.render(Math.max(1, width)).slice(1, -1)
      if (this.focused) return rows
      return rows.map(withoutFakeEditorCursor)
    } finally {
      state.lines = original
      if (masked) this.editor.invalidate()
    }
  }

  insertText(text: string): void {
    this.editor.insertTextAtCursor(text)
    this.observeMutation()
  }

  isShowingAutocomplete(): boolean {
    return this.editor.isShowingAutocomplete()
  }

  refreshAutocomplete(): void {
    const editor = this.editor as unknown as { updateAutocomplete(): void }
    editor.updateAutocomplete()
  }

  render(width: number): string[] {
    const renderWidth = this.connectedAbove ? Math.max(1, width - 2) : width
    const lines = this.editor.render(renderWidth)
    // The first content row (row index 1 under the top border — a
    // scrolled-away top rule keeps that indexing) carries the S14
    // completion polish in the kimi order: the leading `/command` token
    // paints bold+primary, the argument-hint ghost splices in after the
    // cursor, and the prompt symbol overlays last. The bash proxy: the `!`
    // prompt symbol is the bash triple's first leg, so while it is set a
    // leading `/` is a path separator, not a command, and stays unpainted.
    /* v8 ignore next -- the real editor always renders at least one content row between the rules, so lines[1] exists */
    let row = lines[1] ?? ''
    if (this.promptSymbol !== '!' && this.editor.getText().trimStart().startsWith('/')) {
      row = highlightLeadingSlashToken(row, this.chrome.slashTokenPaint) ?? row
    }
    if (this.ghostHint !== undefined && this.cursorAtInputEnd()) {
      row = injectGhostHint(row, this.ghostHint, this.editor.getText().length, renderWidth, this.chrome.ghostHintPaint)
    }
    // The bash `!` shares the border hue so the mode reads as one unit; the
    // neutral `>` stays in the terminal's default foreground (kimi rule).
    const symbol = this.promptSymbol
    if (symbol !== undefined) {
      const painted = injectPromptSymbol(
        row,
        symbol,
        symbol === '!' ? (text: string) => this.editor.borderColor(text) : undefined,
      )
      if (painted !== undefined) row = painted
    }
    lines[1] = row
    // Corners and bars route through the live `borderColor` property, so a
    // host recolor via `setBorderColor` (slash context, bash mode) repaints
    // the whole frame in sync without re-entering this adapter.
    const framed = withSideBorders(lines, (text: string) => this.editor.borderColor(text), {
      connectedAbove: this.connectedAbove,
      label: this.borderLabel,
    })
    return this.connectedAbove ? padColumns(framed, 1) : framed
  }

  handleInput(data: string): void {
    // The onKey hook intercepts before delegation; true consumes the input.
    if (this.onKey?.(data) === true) return
    this.editor.handleInput(data)
    this.observeMutation()
    this.reopenAutocompleteAfterInput()
  }

  /** Invalidate an outstanding attempt when the expanded buffer changed. */
  private observeMutation(): void {
    const current = { raw: this.editor.getText(), expanded: this.editor.getExpandedText() }
    if (current.raw === this.observedBuffer.raw && current.expanded === this.observedBuffer.expanded) return
    this.observedBuffer = current
    this.mutationRevision += 1
    this.activeSubmit?.cancel()
  }

  /** Capture one pre-clear submission and hand it to the current barrier. */
  private requestSubmit(): void {
    // Autocomplete can mutate the buffer inside the same L0 input dispatch
    // immediately before it falls through to submitValue.
    this.observeMutation()
    if (this.submitAttemptHandler === undefined) {
      this.nativeSubmit()
      this.observedBuffer = { raw: this.editor.getText(), expanded: this.editor.getExpandedText() }
      return
    }

    const revision = ++this.submitRevision
    this.activeSubmit?.cancel()
    // Abort listeners run synchronously and may submit again. That nested,
    // newer request owns the slot; this outer request must not overwrite it.
    if (this.submitRevision !== revision) return
    const handler = this.submitAttemptHandler
    if (handler === undefined) {
      this.nativeSubmit()
      this.observedBuffer = { raw: this.editor.getText(), expanded: this.editor.getExpandedText() }
      return
    }
    const barrierRevision = this.submitBarrierRevision
    const mutationRevision = this.mutationRevision
    const raw = this.editor.getText()
    const text = this.editor.getExpandedText().trim()
    const controller = new AbortController()
    let settled = false
    const cancel = (): void => {
      if (settled) return
      settled = true
      this.activeSubmit = undefined
      controller.abort()
    }
    const attempt: BlueEditorSubmitAttempt = Object.freeze({
      text,
      signal: controller.signal,
      revision,
      commit: (): boolean => {
        if (settled
          || this.activeSubmit?.revision !== revision
          || barrierRevision !== this.submitBarrierRevision
          || mutationRevision !== this.mutationRevision
          || this.editor.getText() !== raw
          || this.editor.getExpandedText().trim() !== text) return false
        settled = true
        this.activeSubmit = undefined
        this.nativeSubmit()
        this.observedBuffer = { raw: this.editor.getText(), expanded: this.editor.getExpandedText() }
        return true
      },
      cancel,
    })
    this.activeSubmit = { revision, cancel }
    try {
      handler(attempt)
    } catch {
      cancel()
    }
  }

  /**
   * The kimi `reopenAutocompleteAfterInput` port, plus a bare-`@` backstop:
   * after any input event, re-open the completion dropdown when the mention
   * token ends in `/` (directory drill-down — accepting a directory or
   * typing the separator leaves no renderer trigger behind) or when the
   * token is exactly `@` (a freshly opened mention — the renderer's own
   * trigger fires inside `insertCharacter`, and this covers any input path
   * that reaches the buffer without it). `tryTriggerAutocomplete` is
   * private in 0.84.2; the structural cast (via `unknown`) is pinned by the
   * components spec, the `getHistory` precedent.
   */
  private reopenAutocompleteAfterInput(): void {
    if (this.editor.isShowingAutocomplete()) return
    const { line, col } = this.editor.getCursor()
    /* v8 ignore next -- the real editor always renders the cursor line; the fallback only satisfies the index-access checker */
    const textBeforeCursor = (this.editor.getLines()[line] ?? '').slice(0, col)
    const token = mentionTokenBeforeCursor(textBeforeCursor)
    if (token === null) return
    if (token !== '@' && !textBeforeCursor.endsWith('/')) return
    // The cast lands on a local — the repo's no-semicolon style cannot start
    // a statement with `(`.
    const trigger = this.editor as unknown as { tryTriggerAutocomplete(): void }
    trigger.tryTriggerAutocomplete()
  }

  invalidate(): void {
    this.editor.invalidate()
  }
}

/** Delegate exposing a pi-tui `Markdown` through the Blue contract. */
class MarkdownAdapter implements BlueMarkdown {
  /**
   * @param markdown - the wrapped pi-tui Markdown.
   * @param hr - the exact horizontal-rule paint the wrapped markdown's
   *   theme uses (the `markdownTheme` function pins `hr: colors.mdHr`);
   *   lets the adapter re-paint pi-tui's width-capped rule.
   */
  constructor(
    private readonly markdown: Markdown,
    private readonly hr: (text: string) => string,
  ) {}

  setText(text: string): void {
    this.markdown.setText(text)
  }

  render(width: number): string[] {
    const lines = this.markdown.render(width)
    // pi-tui caps horizontal rules at 80 columns regardless of the render
    // width (`'─'.repeat(Math.min(width, 80))` in markdown.js); the user's
    // S17 dogfood ruling wants the rule as wide as the body text it
    // separates, so the adapter re-paints the capped rule to the full
    // render width. Exact string equality against the known theme output —
    // tolerating pi-tui's row padding — keeps code lines (their own SGRs)
    // and any custom rule styling out of the path.
    if (width <= 80) return lines
    const capped = this.hr('─'.repeat(80))
    const full = this.hr('─'.repeat(width))
    return lines.map(line => line.trimEnd() === capped ? full : line)
  }

  invalidate(): void {
    this.markdown.invalidate()
  }
}

/** Delegate exposing a pi-tui `Image` through the Blue contract. */
class ImageAdapter implements BlueImage {
  constructor(private readonly image: Image) {}

  render(width: number): string[] {
    return this.image.render(width)
  }

  invalidate(): void {
    this.image.invalidate()
  }
}

/** Delegate exposing a pi-tui `SelectList` through the Blue contract. */
class SelectListAdapter implements BlueSelectList {
  constructor(private readonly list: SelectList) {}

  getSelectedItem(): BlueSelectItem | null {
    return this.list.getSelectedItem()
  }

  render(width: number): string[] {
    return this.list.render(width)
  }

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.list.invalidate()
  }
}

/** Delegate exposing a pi-tui `SettingsList` through the Blue contract. */
class SettingsListAdapter implements BlueSettingsList {
  constructor(private readonly list: SettingsList) {}

  updateValue(id: string, newValue: string): void {
    this.list.updateValue(id, newValue)
  }

  render(width: number): string[] {
    return this.list.render(width)
  }

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.list.invalidate()
  }
}

/** Constructor config for {@link BlueComponentsService} (Cordis class-plugin arity). */
export interface BlueComponentsDeps {
  /** The active semantic color provider. */
  theme: BlueTheme
  /** The stable TUI reference the editor component binds to (pi-tui type, core-internal). */
  tui: TUI
}

/**
 * The `blueComponents` service. Mounted by the `blue-core` plugin as a
 * sub-plugin injecting `blueTheme`, so a theme-provider swap rebuilds this
 * service — and every component created afterwards — through Cordis reload
 * semantics. Unregistered automatically when the fiber unloads.
 */
export class BlueComponentsService extends Service implements BlueComponents {
  private readonly theme: BlueTheme
  private readonly tui: TUI

  /**
   * Create and register the service.
   * @param ctx - the owning Cordis context.
   * @param deps - the active theme and the stable TUI reference.
   */
  constructor(ctx: Context, deps: BlueComponentsDeps) {
    super(ctx, 'blueComponents')
    this.theme = deps.theme
    this.tui = deps.tui
  }

  /**
   * Create a palette-themed multi-line input editor. The editor's
   * autocomplete dropdown renders slash-command descriptions wrapped to two
   * lines (`WrappingSelectList`) while every other completion keeps the
   * stock single-line list — the S14 kimi treatment.
   * @param options - editor options.
   * @returns the editor component.
   */
  createEditor(options?: BlueEditorOptions): BlueEditor {
    const editorOptions: EditorOptions = {}
    if (options?.paddingX !== undefined) editorOptions.paddingX = options.paddingX
    const colors = this.theme.colors
    const theme = editorTheme(colors)
    // Explicit annotation: the shadow below references `editor` in its own
    // initializer, which defeats inference otherwise.
    const editor: Editor = new Editor(this.tui, theme, editorOptions)
    // pi-tui's Editor instantiates the dropdown list through its private
    // createAutocompleteList; the own-property shadow swaps in the wrapping
    // list for slash menus. The theme rides along so a theme swap rebuilds
    // the factory with fresh paints (the editor itself is per-theme). The
    // cast lands on a local — the repo's no-semicolon style cannot start a
    // statement with `(`.
    const factory = editor as unknown as AutocompleteListFactory
    factory.createAutocompleteList = (prefix: string, items: BlueSelectItem[]): SelectList =>
      prefix.startsWith('/')
        ? new WrappingSelectList(items, editor.getAutocompleteMaxVisible(), theme.selectList, SLASH_SELECT_LIST_LAYOUT)
        : new SelectList(items, editor.getAutocompleteMaxVisible(), theme.selectList)
    return new EditorAdapter(editor, {
      slashTokenPaint: (text) => `\x1b[1m${colors.primary(text)}\x1b[22m`,
      ghostHintPaint: colors.textMuted,
    })
  }

  /**
   * Create a palette-themed streamed-Markdown component.
   * @param options - markdown options.
   * @returns the markdown component.
   */
  createMarkdown(options?: BlueMarkdownOptions): BlueMarkdown {
    return new MarkdownAdapter(
      new Markdown(options?.text ?? '', options?.paddingX ?? 0, options?.paddingY ?? 0, markdownTheme(this.theme.colors)),
      this.theme.colors.mdHr,
    )
  }

  /**
   * Create a palette-themed inline image component. The bytes are base64-encoded
   * for the renderer; terminals without an image protocol render the styled
   * text fallback (muted filename, MIME type, and pixel dimensions).
   * @param options - the image bytes, MIME type, and cell bounds.
   * @returns the image component.
   */
  createImage(options: BlueImageOptions): BlueImage {
    const imageOptions: ImageOptions = {}
    if (options.maxWidthCells !== undefined) imageOptions.maxWidthCells = options.maxWidthCells
    if (options.maxHeightCells !== undefined) imageOptions.maxHeightCells = options.maxHeightCells
    if (options.filename !== undefined) imageOptions.filename = options.filename
    return new ImageAdapter(
      new Image(Buffer.from(options.data).toString('base64'), options.mediaType, imageTheme(this.theme.colors), imageOptions),
    )
  }

  /**
   * Probe the pixel dimensions of encoded image data.
   * @param data - the encoded image bytes (PNG, JPEG, GIF, or WebP).
   * @returns the pixel dimensions, or `undefined` for undecodable data.
   */
  imageDimensions(data: Uint8Array): { width: number, height: number } | undefined {
    // The contract takes no MIME type, so each decoder pi-tui supports is
    // tried in turn; every decoder validates its own magic bytes and returns
    // null on a mismatch.
    const base64 = Buffer.from(data).toString('base64')
    for (const mediaType of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      const dimensions = getImageDimensions(base64, mediaType)
      if (dimensions !== null) return { width: dimensions.widthPx, height: dimensions.heightPx }
    }
    return undefined
  }

  /**
   * Create the `@`-mention completion source: the renderer's combined
   * provider constructed with no commands, so only its `@` branch ever runs.
   * `BlueAutocompleteProvider` is structurally identical to the renderer's
   * provider type, so the instance passes through unwrapped — the renderer
   * type never crosses the Blue signature.
   * @param basePath - the project root relative paths are reported from.
   * @param fdPath - the `fd` binary to spawn, or `null` when unavailable.
   * @returns the mention completion source.
   */
  createFileMentionProvider(basePath: string, fdPath: string | null): BlueAutocompleteProvider {
    return new CombinedAutocompleteProvider([], basePath, fdPath)
  }

  /**
   * Create a palette-themed single-selection list.
   * @param options - items and selection callbacks.
   * @returns the list component.
   */
  createSelectList(options: BlueSelectListOptions): BlueSelectList {
    const list = new SelectList(options.items, options.maxVisible ?? 10, selectListTheme(this.theme.colors))
    if (options.onSelect !== undefined) list.onSelect = options.onSelect
    if (options.onCancel !== undefined) list.onCancel = options.onCancel
    if (options.onSelectionChange !== undefined) list.onSelectionChange = options.onSelectionChange
    return new SelectListAdapter(list)
  }

  /**
   * Create a palette-themed settings list.
   * @param options - items and change callbacks.
   * @returns the settings component.
   */
  createSettingsList(options: BlueSettingsListOptions): BlueSettingsList {
    // SettingsListOptions is not re-exported from pi-tui's package root;
    // its only field is enableSearch.
    const listOptions: { enableSearch?: boolean } = {}
    if (options.enableSearch !== undefined) listOptions.enableSearch = options.enableSearch
    // BlueSettingItem and pi-tui's SettingItem are structurally identical
    // (the BlueComponent submenu result satisfies pi-tui's Component), so
    // the item list passes through unchanged.
    return new SettingsListAdapter(
      new SettingsList(
        options.items as SettingItem[],
        options.maxVisible ?? 10,
        settingsListTheme(this.theme.colors),
        options.onChange,
        options.onCancel,
        listOptions,
      ),
    )
  }

  /**
   * Measure the visible width of styled text in terminal columns.
   * @param text - the text, ANSI styling allowed.
   * @returns the width in columns.
   */
  visibleWidth(text: string): number {
    return visibleWidth(text)
  }

  /**
   * Word-wrap styled text to a column width, preserving ANSI styling.
   * @param text - the text, ANSI styling and newlines allowed.
   * @param width - the maximum visible width per line.
   * @returns the wrapped lines, not padded.
   */
  wrapText(text: string, width: number): string[] {
    return wrapTextWithAnsi(text, width)
  }

  /**
   * Truncate styled text to a maximum visible width.
   * @param text - the text, ANSI styling allowed.
   * @param width - the maximum visible width.
   * @param ellipsis - the ellipsis string; defaults to `'...'`.
   * @returns the truncated text.
   */
  truncateToWidth(text: string, width: number, ellipsis?: string): string {
    return truncateToWidth(text, width, ellipsis)
  }

  /**
   * Render the bounded top rule used by connected renderer-owned panes.
   * @param width - the target visible width.
   * @param options - optional title, hint, and paint functions.
   * @returns the ANSI-safe rule row.
   */
  topRule(width: number, options?: BlueTopRuleOptions): string {
    return renderTopRule(width, options)
  }

  /**
   * Probe a case-insensitive fuzzy subsequence match (the S14 completion
   * primitive; re-exported from the renderer so no consumer imports pi-tui).
   * @param query - the query characters, matched in order.
   * @param text - the candidate text.
   * @returns whether it matched and at what score.
   */
  fuzzyMatch(query: string, text: string): BlueFuzzyMatch {
    return fuzzyMatch(query, text)
  }

  /**
   * Filter and rank items by a fuzzy query (see the contract doc).
   * @param items - the candidates.
   * @param query - the fuzzy query.
   * @param getText - extracts the match text from an item.
   * @returns the matching items, best first.
   */
  fuzzyFilter<T>(items: readonly T[], query: string, getText: (item: T) => string): T[] {
    return fuzzyFilter([...items], query, getText)
  }
}
