/**
 * Blue L1 contracts: the narrow, self-owned interfaces every other Blue
 * package consumes. No pi-tui or harness business type appears here; L0
 * (`src/terminal.ts`) adapts these to pi-tui internally.
 *
 * @module @deepseek-ai/dsh-blue-core/types
 */

// Pulls in Cordis `Context`/`Events` for the declaration merges below; the
// merges belong to the contract layer because the `blueTheme` provider is
// replaceable by the theme plugin family outside this package.
import type {} from '@deepseek-ai/cordis'

/**
 * A renderable Blue component. Structurally compatible with pi-tui's
 * `Component` but type-independent, so pi-tui breaking changes cannot
 * propagate past L0.
 */
export interface BlueComponent {
  /**
   * Render the component to display lines for the given viewport width.
   * Each returned string is one row; ANSI styling is allowed, visible width
   * must not exceed `width`.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[]
  /**
   * Receive one decoded input sequence while the component holds focus.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput?(data: string): void
  /** Drop cached render state; the next render rebuilds from scratch. */
  invalidate(): void
}

/**
 * A {@link BlueComponent} that can hold keyboard focus and display the
 * hardware cursor. The screen sets `focused` on focus changes; focused
 * components may emit pi-tui's cursor marker to position the IME cursor.
 */
export interface BlueFocusable extends BlueComponent {
  /** Whether the component currently holds focus. Managed by the screen. */
  focused: boolean
}

/** Absolute column/row count or a percentage of the terminal dimension. */
export type BlueOverlaySize = number | `${number}%`

/** Anchor point used to position an overlay on the terminal. */
export type BlueOverlayAnchor =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center'

/** Positioning and sizing options for {@link BlueScreen.showOverlay}. */
export interface BlueOverlayOptions {
  /** Overlay width in columns, or a percentage of the terminal width. */
  width?: BlueOverlaySize
  /** Minimum overlay width in columns. */
  minWidth?: number
  /** Maximum overlay height in rows, or a percentage of the terminal height. */
  maxHeight?: BlueOverlaySize
  /** Anchor point for positioning; defaults to `'center'`. */
  anchor?: BlueOverlayAnchor
  /** Horizontal offset from the anchor position (positive moves right). */
  offsetX?: number
  /** Vertical offset from the anchor position (positive moves down). */
  offsetY?: number
  /**
   * Re-evaluated each render with the current terminal dimensions; the
   * overlay renders only while this returns true.
   * @param columns - current terminal width.
   * @param rows - current terminal height.
   * @returns whether the overlay is visible.
   */
  visible?(columns: number, rows: number): boolean
  /** When true, the overlay does not capture keyboard focus when shown. */
  nonCapturing?: boolean
}

/** Options for {@link BlueOverlayHandle.unfocus}. */
export interface BlueOverlayUnfocusOptions {
  /** Explicit component to focus after releasing this overlay. */
  target: BlueComponent | null
}

/**
 * Handle controlling one mounted overlay. Overlays are modal: focus and
 * dismissal flow exclusively through this handle.
 */
export interface BlueOverlayHandle {
  /** Permanently remove the overlay; it cannot be shown again. */
  hide(): void
  /**
   * Temporarily hide or re-show the overlay, moving focus accordingly.
   * @param hidden - the target visibility.
   */
  setHidden(hidden: boolean): void
  /**
   * Report whether the overlay is temporarily hidden.
   * @returns the temporary-hidden state.
   */
  isHidden(): boolean
  /** Focus this overlay and bring it to the visual front. */
  focus(): void
  /**
   * Release focus to the next visible capturing overlay or the component
   * focused before this overlay was shown.
   * @param options - optional explicit focus target.
   */
  unfocus(options?: BlueOverlayUnfocusOptions): void
  /**
   * Report whether this overlay currently holds focus.
   * @returns the focus state.
   */
  isFocused(): boolean
}

/**
 * `ctx.blueScreen` — the component-mounting service. Owns the component
 * tree, the single focus slot, and the overlay stack; it carries no color
 * or keybinding responsibility.
 */
export interface BlueScreen {
  /**
   * Mount a component at the root of the tree, above every bottom-pinned
   * component regardless of mount order.
   * @param component - the component to mount.
   * @returns a disposer that unmounts the component; safe to call twice.
   */
  addChild(component: BlueComponent): () => void
  /**
   * Mount a component pinned to the bottom of the root tree: it renders
   * after every component mounted with {@link BlueScreen.addChild}, so
   * late-mounted transcript content never lands below the input editor.
   * When the mounted content is shorter than the viewport, blank filler
   * keeps the pinned block on the terminal's last rows.
   * @param component - the component to pin.
   * @returns a disposer that unmounts the component; safe to call twice.
   */
  addBottomChild(component: BlueComponent): () => void
  /**
   * Unmount a component previously mounted with {@link BlueScreen.addChild}.
   * Unmounting an absent component is a no-op.
   * @param component - the component to unmount.
   */
  removeChild(component: BlueComponent): void
  /**
   * Move keyboard focus. Overlays may reclaim focus per the overlay stack
   * discipline; `null` releases focus entirely.
   * @param component - the component to focus, or `null`.
   */
  setFocus(component: BlueComponent | null): void
  /**
   * Mount a component as an overlay above the base content. Unless
   * `nonCapturing`, a visible overlay takes focus; hiding it restores the
   * previously focused component.
   * @param component - the overlay component.
   * @param options - positioning and sizing options.
   * @returns the overlay's control handle.
   */
  showOverlay(component: BlueComponent, options?: BlueOverlayOptions): BlueOverlayHandle
  /**
   * Schedule a re-render. Rendering is throttled; pass `force` to reset
   * cached diff state and redraw everything.
   * @param force - reset differential render state before drawing.
   */
  requestRender(force?: boolean): void
  /** Current terminal width in columns. */
  readonly columns: number
}

/**
 * One semantic color: a function wrapping text in ANSI styling. Consumers
 * apply it verbatim to rendered text; composition with other colors is the
 * consumer's responsibility.
 * @param text - the text to style.
 * @returns the styled text.
 */
export type BlueColorFn = (text: string) => string

/**
 * The semantic color table. Keys name roles, not presentation. All 28
 * tokens are required so a palette is compile-checked for completeness; the
 * diff group ships unused until P2 but must still carry colors.
 * `selectedBg` is a background color; every other entry styles the
 * foreground.
 */
export interface BlueSemanticColors {
  /** Default foreground. */
  text: BlueColorFn
  /** Emphasized foreground (bold runs, strong text). */
  textStrong: BlueColorFn
  /** Secondary, de-emphasized text. */
  muted: BlueColorFn
  /** Deepest gray tier (counters, key hints, connectors, truncation rows). */
  textMuted: BlueColorFn
  /** Secondary highlight (pointer glyphs, secondary emphasis). */
  accent: BlueColorFn
  /** Interactive primary (selection, links, spinner, running indicators). */
  primary: BlueColorFn
  /** Overlay and editor borders. */
  border: BlueColorFn
  /** Border of the focused overlay or editor. */
  borderFocus: BlueColorFn
  /** Affirmative status (tool success, confirmations). */
  success: BlueColorFn
  /** Failure status. */
  error: BlueColorFn
  /** Cautionary status. */
  warning: BlueColorFn
  /** Background of the selected list entry. */
  selectedBg: BlueColorFn
  /** User-authored transcript messages. */
  roleUser: BlueColorFn
  /** Shell-mode indicator in the input editor. */
  shellMode: BlueColorFn
  /** Markdown heading. */
  mdHeading: BlueColorFn
  /** Markdown link text. */
  mdLink: BlueColorFn
  /** Markdown link destination. */
  mdLinkUrl: BlueColorFn
  /** Markdown inline code. */
  mdCode: BlueColorFn
  /** Markdown code block body. */
  mdCodeBlock: BlueColorFn
  /** Markdown code block border. */
  mdCodeBlockBorder: BlueColorFn
  /** Markdown quote body. */
  mdQuote: BlueColorFn
  /** Markdown quote border. */
  mdQuoteBorder: BlueColorFn
  /** Markdown horizontal rule. */
  mdHr: BlueColorFn
  /** Markdown list bullet. */
  mdListBullet: BlueColorFn
  /** Added diff line. */
  diffAdded: BlueColorFn
  /** Removed diff line. */
  diffRemoved: BlueColorFn
  /** Emphasized added diff line (hunk headers, focused hunks). */
  diffAddedStrong: BlueColorFn
  /** Emphasized removed diff line (hunk headers, focused hunks). */
  diffRemovedStrong: BlueColorFn
  /** Diff line-number gutter. */
  diffGutter: BlueColorFn
  /** Diff metadata (file paths, hunk ranges). */
  diffMeta: BlueColorFn
}

/** `ctx.blueTheme` — the semantic color provider. */
export interface BlueTheme {
  /** The active semantic color table. */
  readonly colors: BlueSemanticColors
}

/**
 * One named keybinding action. Ids are dotted and plugin-owned
 * (e.g. `blue.app.quit`); keys use pi-tui key-id notation (`enter`,
 * `ctrl+c`, `shift+enter`).
 */
export interface BlueKeyAction {
  /** Stable, unique action id. */
  id: string
  /** One or more key ids that trigger the action. */
  keys: string | string[]
  /** Human-readable description for future keybinding UIs. */
  description?: string
  /**
   * Optional global handler. An action carrying a handler is a
   * focus-independent global action: the L0 global dispatcher consumes its
   * key before focus routing and invokes the handler. An action without a
   * handler is a contextual action, resolved by components through
   * {@link BlueKeymap.matches}.
   */
  handler?: () => void
}

/**
 * `ctx.blueKeymap` — the keybinding registry. All Blue key handling goes
 * through registered actions; conflict detection runs at registration.
 */
export interface BlueKeymap {
  /**
   * Register a batch of actions. The batch is validated as a unit: a key
   * already claimed by a different registered action, or a duplicate action
   * id, fails the whole registration with a `BlueKeymapError`.
   * @param actions - the actions to register.
   * @returns a disposer unregistering exactly this batch; safe to call twice.
   */
  register(actions: BlueKeyAction[]): () => void
  /**
   * Test whether one input sequence triggers a registered action.
   * @param data - the input sequence as read from the terminal.
   * @param action - the action id; unknown ids never match.
   * @returns whether the input triggers the action.
   */
  matches(data: string, action: string): boolean
  /**
   * Run the global dispatch: walk the actions carrying a handler in
   * registration order, invoke the first whose key matches `data`, and
   * report whether any handler consumed the input.
   * @param data - the input sequence as read from the terminal.
   * @returns whether a handler ran for the input.
   */
  dispatch(data: string): boolean
  /**
   * Resolve the key ids currently bound to an action.
   * @param action - the action id.
   * @returns the bound key ids, empty for unknown actions.
   */
  getKeys(action: string): string[]
  /**
   * Snapshot every registered action in registration order, for keybinding
   * UIs that enumerate the registry (e.g. `/help`).
   * @returns a fresh array of the current actions; mutating it does not
   *   touch the registry.
   */
  list(): readonly BlueKeyAction[]
}

/** An RGB color sampled from the terminal (pi-tui's `RgbColor` shape, re-owned). */
export interface BlueRgbColor {
  /** Red channel, 0–255. */
  r: number
  /** Green channel, 0–255. */
  g: number
  /** Blue channel, 0–255. */
  b: number
}

/**
 * `ctx.blueTerminalInfo` — facts about the host terminal, probed once at
 * startup before raw-mode input begins. `background` is `undefined` when
 * the terminal did not answer the OSC 11 query in time.
 */
export interface BlueTerminalInfo {
  /** The terminal's default background luminance class, if probed. */
  readonly background: 'dark' | 'light' | undefined
  /** Whether the Kitty keyboard protocol is active on the terminal. */
  readonly kittyKeyboard: boolean
}

/** Options for {@link BlueComponents.createEditor}. */
export interface BlueEditorOptions {
  /** Horizontal padding inside the editor frame, in columns. */
  paddingX?: number
}

/** One entry of an autocomplete suggestion list. */
export interface BlueAutocompleteItem {
  /** The value matched against the prefix and reported to `applyCompletion`. */
  value: string
  /** The primary display text. */
  label: string
  /** Secondary text shown beside the label. */
  description?: string
}

/** The suggestion set returned by {@link BlueAutocompleteProvider.getSuggestions}. */
export interface BlueAutocompleteSuggestions {
  /** The completions to display. */
  items: BlueAutocompleteItem[]
  /** The token being completed, reused for highlighting and application. */
  prefix: string
}

/**
 * A suggestion source for the editor's autocomplete dropdown. Structurally
 * identical to the underlying renderer's provider but type-independent; the
 * L0 adapter passes implementations straight through. All coordinates are
 * zero-based line/column pairs into `lines`.
 */
export interface BlueAutocompleteProvider {
  /** Characters that trigger this provider at token boundaries. */
  triggerCharacters?: string[]
  /**
   * Compute completions for the token at the cursor.
   * @param lines - the editor content, one entry per line.
   * @param cursorLine - the cursor's line index.
   * @param cursorCol - the cursor's column within that line.
   * @param options - `signal` aborts a superseded request; `force` marks an
   *   explicit (e.g. Tab) request.
   * @returns the suggestions, or `null` for none.
   */
  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal, force?: boolean },
  ): Promise<BlueAutocompleteSuggestions | null>
  /**
   * Apply one accepted completion to the editor content.
   * @param lines - the editor content, one entry per line.
   * @param cursorLine - the cursor's line index.
   * @param cursorCol - the cursor's column within that line.
   * @param item - the accepted suggestion.
   * @param prefix - the token being replaced.
   * @returns the new content and cursor position.
   */
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: BlueAutocompleteItem,
    prefix: string,
  ): { lines: string[], cursorLine: number, cursorCol: number }
  /**
   * Gate an explicit file-completion request (Tab outside a token).
   * @param lines - the editor content, one entry per line.
   * @param cursorLine - the cursor's line index.
   * @param cursorCol - the cursor's column within that line.
   * @returns whether the request should proceed.
   */
  shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean
}

/**
 * A multi-line input editor. The submit/change callbacks and `disableSubmit`
 * are mutable properties, set after creation, matching the underlying
 * component's idiom.
 */
export interface BlueEditor extends BlueFocusable {
  /** Called when the user submits; receives the full text. */
  onSubmit?: ((text: string) => void) | undefined
  /** Called on every text change. */
  onChange?: ((text: string) => void) | undefined
  /**
   * Optional pre-dispatch hook: called with every input sequence before the
   * underlying editor sees it; return true to consume the sequence without
   * delegating.
   */
  onKey?: ((data: string) => boolean) | undefined
  /** When true, submission keys insert text instead of submitting. */
  disableSubmit: boolean
  /**
   * Report whether the autocomplete dropdown is currently visible.
   * @returns the dropdown visibility.
   */
  isShowingAutocomplete(): boolean
  /**
   * Read the current text.
   * @returns the editor content.
   */
  getText(): string
  /**
   * Replace the current text.
   * @param text - the new content.
   */
  setText(text: string): void
  /**
   * Add a prompt to the history navigated with up/down arrows.
   * @param text - the submitted prompt.
   */
  addToHistory(text: string): void
  /**
   * Restyle the editor frame (e.g. focused vs. unfocused border).
   * @param color - the new border color function.
   */
  setBorderColor(color: BlueColorFn): void
  /**
   * Overlay a prompt symbol on the editor's first content row. Requires the
   * editor to be created with `paddingX: 4`; the bash `!` renders in the
   * current border color, the neutral `>` in the default foreground.
   * @param symbol - the symbol, or `undefined` to remove it.
   */
  setPromptSymbol(symbol: '>' | '!' | undefined): void
  /**
   * Lay pre-styled text into the editor's top border (e.g. a mode badge);
   * scroll-indicator borders are never labeled. Requires `paddingX: 4`.
   * @param text - the styled label, or `undefined` to remove it.
   */
  setBorderLabel(text: string | undefined): void
  /**
   * Switch the top corners between `╭╮` and `├┤`, the latter reading as a
   * frame docked to a panel above (the S13 btw dock).
   * @param connected - whether a panel is docked above the editor.
   */
  setConnectedAbove(connected: boolean): void
  /**
   * Attach the autocomplete provider driving the suggestion dropdown.
   * @param provider - the suggestion source.
   */
  setAutocompleteProvider(provider: BlueAutocompleteProvider): void
  /**
   * Read the current text with paste markers expanded to their full pasted
   * content; use this — not {@link BlueEditor.getText} — for submission.
   * @returns the expanded editor content.
   */
  getExpandedText(): string
  /**
   * Insert text at the cursor as one atomic undo step, without submitting.
   * Used for programmatic insertion of clipboard image placeholder markers.
   * @param text - the text to insert.
   */
  insertText(text: string): void
}

/** Options for {@link BlueComponents.createMarkdown}. */
export interface BlueMarkdownOptions {
  /** Initial Markdown source; defaults to empty. */
  text?: string
  /** Horizontal padding, in columns; defaults to 0. */
  paddingX?: number
  /** Vertical padding, in rows; defaults to 0. */
  paddingY?: number
}

/** A streamed-Markdown component with internal render caching. */
export interface BlueMarkdown extends BlueComponent {
  /**
   * Replace the Markdown source; the next render reflects it.
   * @param text - the new Markdown source (complete or mid-stream).
   */
  setText(text: string): void
}

/** Options for {@link BlueComponents.createImage}. */
export interface BlueImageOptions {
  /** The encoded image bytes (PNG, JPEG, GIF, or WebP). */
  data: Uint8Array
  /** The image's MIME type, e.g. `'image/png'`. */
  mediaType: string
  /** Optional source path or name shown in the text fallback. */
  filename?: string
  /** Maximum rendered width in terminal cells. */
  maxWidthCells?: number
  /** Maximum rendered height in terminal cells. */
  maxHeightCells?: number
}

/**
 * An inline image component with internal render caching. Structurally
 * identical to {@link BlueComponent}; the distinct name keeps image usage
 * explicit at call sites.
 */
export type BlueImage = BlueComponent

/** One entry of a {@link BlueSelectList}. */
export interface BlueSelectItem {
  /** The value reported to selection callbacks. */
  value: string
  /** The primary display text. */
  label: string
  /** Secondary text shown beside the label. */
  description?: string
}

/** Options for {@link BlueComponents.createSelectList}. */
export interface BlueSelectListOptions {
  /** The entries to choose from. */
  items: BlueSelectItem[]
  /** Maximum simultaneously visible entries; defaults to 10. */
  maxVisible?: number
  /** Called when the user confirms the highlighted entry. */
  onSelect?(item: BlueSelectItem): void
  /** Called when the user dismisses the list. */
  onCancel?(): void
  /** Called whenever the highlight moves. */
  onSelectionChange?(item: BlueSelectItem): void
}

/** A single-selection list. */
export interface BlueSelectList extends BlueComponent {
  /**
   * Read the currently highlighted entry.
   * @returns the highlighted item, or `null` when the list is empty.
   */
  getSelectedItem(): BlueSelectItem | null
}

/** One entry of a {@link BlueSettingsList}. */
export interface BlueSettingItem {
  /** Unique identifier reported to the change callback. */
  id: string
  /** Display label (left side). */
  label: string
  /** Optional description shown while the entry is highlighted. */
  description?: string
  /** Current value displayed on the right side. */
  currentValue: string
  /** When provided, confirm keys cycle through these values. */
  values?: string[]
  /**
   * When provided, confirm opens this submenu.
   * @param currentValue - the value at open time.
   * @param done - closes the submenu, optionally committing a new value.
   * @returns the component rendered as the submenu.
   */
  submenu?(currentValue: string, done: (selectedValue?: string) => void): BlueComponent
}

/** Options for {@link BlueComponents.createSettingsList}. */
export interface BlueSettingsListOptions {
  /** The settings to display. */
  items: BlueSettingItem[]
  /** Maximum simultaneously visible entries; defaults to 10. */
  maxVisible?: number
  /** Enable type-to-filter search; defaults to false. */
  enableSearch?: boolean
  /** Called after an entry's value changes. */
  onChange(id: string, newValue: string): void
  /** Called when the user dismisses the list. */
  onCancel(): void
}

/** A key/value settings list. */
export type BlueSettingsList = BlueComponent

/**
 * `ctx.blueComponents` — the component factory. Blue-typed options in,
 * Blue-typed components out; the semantic color table is mapped to the
 * underlying renderer's themes inside L0, and the width helpers are
 * re-exported under Blue signatures so no consumer imports pi-tui.
 */
export interface BlueComponents {
  /**
   * Create a multi-line input editor themed from the active palette.
   * @param options - editor options.
   * @returns the editor component.
   */
  createEditor(options?: BlueEditorOptions): BlueEditor
  /**
   * Create a streamed-Markdown component themed from the active palette.
   * @param options - markdown options.
   * @returns the markdown component.
   */
  createMarkdown(options?: BlueMarkdownOptions): BlueMarkdown
  /**
   * Create an inline image component themed from the active palette. Wraps
   * the underlying renderer's image component; terminals without an image
   * protocol get its styled text fallback instead of a rendered image.
   * @param options - the image bytes, MIME type, and cell bounds.
   * @returns the image component.
   */
  createImage(options: BlueImageOptions): BlueImage
  /**
   * Probe the pixel dimensions of encoded image data, in the same pure-helper
   * family as {@link BlueComponents.visibleWidth}.
   * @param data - the encoded image bytes (PNG, JPEG, GIF, or WebP).
   * @returns the pixel dimensions, or `undefined` for undecodable data.
   */
  imageDimensions(data: Uint8Array): { width: number, height: number } | undefined
  /**
   * Create a single-selection list themed from the active palette.
   * @param options - items and selection callbacks.
   * @returns the list component.
   */
  createSelectList(options: BlueSelectListOptions): BlueSelectList
  /**
   * Create a settings list themed from the active palette.
   * @param options - items and change callbacks.
   * @returns the settings component.
   */
  createSettingsList(options: BlueSettingsListOptions): BlueSettingsList
  /**
   * Measure the visible width of styled text in terminal columns.
   * @param text - the text, ANSI styling allowed.
   * @returns the width in columns.
   */
  visibleWidth(text: string): number
  /**
   * Word-wrap styled text to a column width, preserving ANSI styling.
   * @param text - the text, ANSI styling and newlines allowed.
   * @param width - the maximum visible width per line.
   * @returns the wrapped lines, not padded.
   */
  wrapText(text: string, width: number): string[]
  /**
   * Truncate styled text to a maximum visible width, adding an ellipsis
   * when truncating.
   * @param text - the text, ANSI styling allowed.
   * @param width - the maximum visible width.
   * @param ellipsis - the ellipsis string; defaults to `'...'`.
   * @returns the truncated text.
   */
  truncateToWidth(text: string, width: number, ellipsis?: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The semantic color provider. Typed as the {@link BlueTheme} contract —
     * not the built-in implementation — because the theme plugin family
     * replaces the provider fiber at runtime.
     */
    blueTheme: BlueTheme
  }

  interface Events {
    /**
     * The terminal reported a dark/light color-scheme change (mode 2031
     * notification). Emitted by `blue-core` after startup; consumers treat
     * it as a hint and re-read {@link BlueTerminalInfo}-style facts from
     * their providers.
     * Unfiltered: every terminal-mode switch is broadcast.
     * @param scheme - the newly active scheme.
     * @mode emit
     */
    'blue/terminal-theme-changed'(scheme: 'dark' | 'light'): void
  }
}
