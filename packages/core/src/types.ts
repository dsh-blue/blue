/**
 * Blue L1 contracts: the narrow, self-owned interfaces every other Blue
 * package consumes. No pi-tui or harness business type appears here; L0
 * (`src/terminal.ts`) adapts these to pi-tui internally.
 *
 * @module @deepseek-ai/dsh-blue-core/types
 */

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
 * The semantic color table. Keys name roles, not presentation; values are
 * the built-in dark palette in the MVP. `selectedBg` is a background color;
 * every other entry styles the foreground.
 */
export interface BlueSemanticColors {
  /** Default foreground. */
  text: BlueColorFn
  /** Secondary, de-emphasized text. */
  muted: BlueColorFn
  /** Primary highlight (selected items, accents). */
  accent: BlueColorFn
  /** Overlay and editor borders. */
  border: BlueColorFn
  /** Affirmative status (tool success, confirmations). */
  success: BlueColorFn
  /** Failure status. */
  error: BlueColorFn
  /** Cautionary status. */
  warning: BlueColorFn
  /** Background of the selected list entry. */
  selectedBg: BlueColorFn
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
   * Resolve the key ids currently bound to an action.
   * @param action - the action id.
   * @returns the bound key ids, empty for unknown actions.
   */
  getKeys(action: string): string[]
}
