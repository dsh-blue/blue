# @dsh-blue/blue-core — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Scope and L0 boundary

Core is the tree's ONLY package allowed to import `@earendil-works/pi-tui` (plus raw terminal state). It owns terminal lifecycle (`src/terminal.ts`) and exposes pi-tui-independent contracts in `src/types.ts` so pi-tui breaking changes cannot propagate past it. Public node construction comes from the renderer-neutral `@dsh-blue/blue-ui`; core remains the sole validator/compiler into pi-tui. Other real runtime dependencies are `@earendil-works/pi-tui`, `@deepseek-ai/schemastery` (theme-custom config validation), and `cli-highlight` (code-fence syntax coloring behind the markdown `highlightCode` hook).

## L1 services and the global key dispatcher

- **`blueScreen`** (`src/screen.ts`) — the screen contract carries `readonly rows` (the btw panel's height budget reads it live) and `addBottomChild(component, position?)`: the optional `'bottom'` position renders the component below the rest of the dock. The footer shell mounts pinned there, putting the two-row status on the terminal's last rows beneath the editor — the kimi dock layout the pull-up dialog panels leave visible. `setTitle(title)` (S30) delegates to the runtime, which writes a sanitized OSC 0 sequence through the terminal (pi-tui's own `Terminal.setTitle` is bypassed — it hardcodes `process.stdout`); the sequence paints no cell, so it never disturbs differential rendering, and inside tmux it becomes the tmux window name. The helpers live in `src/terminal-escape.ts`: direct terminals receive bare OSC 52, while tmux selection runs `tmux load-buffer -w -`. The latter is required for the common `set-clipboard external` policy, which forwards tmux-owned clipboard writes but explicitly ignores application OSC 52; it also avoids DCS passthrough's independent, default-off `allow-passthrough` gate. `sanitizeTitleText` strips C0/C1 plus directional/invisible controls and collapses whitespace; `TITLE_MAX_CHARS` caps titles at 32 code points. Since S31 the contract also carries `suspend(fn)` (see below).
- **`blueKeymap`** (`src/keymap.ts`) — `list()` gives a registration-order snapshot for `/help`-style enumeration; registration runs key-level conflict detection.
- **`blueTerminalInfo`** (`src/terminal-info.ts`) — read-only terminal facts from the startup OSC 11 background probe.
- **Global key dispatcher** — core's `apply` mounts a pi-tui input listener ahead of focus routing that consumes keymap actions carrying a `handler`. The service is instantiated directly in `apply`, not via `ctx.plugin`: the Cordis Context proxy rejects uninjected services, and a service cannot inject itself.

  The production runtime is `TuiAltScreen`. Its primary `ScrollView` owns the
  transcript viewport (`follow: end`, three rows per wheel event, automatic
  scrollbar) while a sibling dock container keeps panes/editor/footer fixed at
  the bottom. SGR mouse tracking therefore has a complete owner: wheel reports
  scroll the primary view; drag reports paint an application selection and copy
  it through direct OSC 52 or tmux's own `load-buffer -w -` path. The callback
  reports success only after tmux exits zero. `TuiMainScreen` remains only as
  the explicit `'main'` compatibility mode used by source-plane fixtures; there
  it never enables mouse reporting, so a multiplexer-provided SGR/X10 wheel
  report is merely normalized to up/down before focus routing.

Both alternate-screen layout bands preserve the D48 render-exit width backstop before pi-tui lays out the frame. The transcript's `FrameClampedContainer` reuses a checked frame for the same width, child identities, and child row-array identities, so stable long transcript rows do not repeat ANSI-aware width scans on dock-only redraws. The height-aware dock container renders every child once, reserves fixed editor/dialog/footer rows, then allocates the remainder to passive panes by descending priority while retaining one transcript row whenever possible. `scrollContent()` delegates to the primary `ScrollView`; its ordinary differential render keeps the dock fixed without resetting render state or emitting a full-screen clear. `contentChanged()` preserves follow-end until the user scrolls away, and `followContent()` returns to the tail. Raw wheel reports remain available to the renderer's native viewport route; the focused editor consumes its wheel reports before the AltScreen listener, while focused replacement panels receive normalized Up/Down input. `setContentScrollHandler()` retains the editor-context wheel/PageUp/PageDown/End path without stealing Up/Down from editor history or converting the main viewport's raw mouse event.

`output-recovery.ts` protects that alternate screen from Host code that writes
directly to process stdout/stderr (the dynamic Cordis Host console is the
canonical consumer). The original write still lands, then a forced frame on
the next tick restores the renderer-owned editor/footer cells. Renderer
terminal writes are reentrantly excluded. Suspend deactivates the guards before
releasing the tty, resume reactivates them after terminal start, and stop
restores the original stream methods so no process-global hook escapes the
runtime Fiber.

## Suspend/resume seam (S31, `runtime.suspend` → `blueScreen.suspend`)

The recoverable suspend composes pi-tui 0.84.2's own lifecycle primitives — `TUI.stop()` / `TUI.start()` / `requestRender(true)` — and is deliberately NOT the teardown `runtime.stop()`. State machine (closure flags `stopped`/`suspended` inside `startBlueTerminal`):

- **suspend(fn)**: exclusive (a second in-flight call rejects) and refused once stopped. Production AltScreen stops with `preserveScreen: true`, restoring the untouched main screen while a child owns the tty and avoiding a full transcript replay on every external-editor round trip; compatibility MainScreen uses its ordinary stop. One `setImmediate` beat flushes the stop escapes before the child takes the tty, then `fn` runs with the terminal released (raw mode off, pi-tui detached).
- **resume** (fn settlement, in a `finally`): `process.stdin.pause()` BEFORE `start()` — bytes buffered while suspended must not surface as application input once raw mode re-arms — then, unless the runtime was torn down mid-suspend (`stopped || activeRuntime !== runtime`), `current.start()` (its self-SIGWINCH on Unix refreshes dimensions stale from a resize while suspended) → `setTerminalColorSchemeNotifications(true)` (the stop wrote `\x1b[?2031l`; the registered `onTerminalColorSchemeChange` callback itself survives stop/start) → `requestRender(true)` (forced full repaint). fn's rejection propagates unchanged — resume never swallows.
- **stop() during suspend** (fiber unload / fail-loud release while a child owns the tty): `stopped = true` but NO `terminal.drainInput()` (the parent drain would steal the child's input) and NO second `current.stop()` (the renderer is already stopped; a replay of teardown sequences would corrupt the child's screen). It only unregisters `activeRuntime`; the later resume detects the teardown and skips the restart.
- Render ticker: pi-tui has no standing render loop — `stop()` cancels the 16ms throttle timer for free. Application-level timers (footer tips, spinners) keep firing into `requestRender` and no-op inside the stopped renderer's early exit; accepted as harmless spinning (kimi does the same), not gated.

## Component factory (`blueComponents`, `src/components.ts`)

### Public UI admission/compiler boundary

`src/ui-validator.ts` is the only admission path for public `BlueUiNode`, recursively narrowed `BlueStatusNode`, and `BlueEditorShellNode` trees. Preserve the 20,000-text-unit, depth-8, 256-node, and 200-entry quotas; copy known fields and recursively freeze only the canonical copy; strip ESC and C1 terminal strings plus the private focus sentinel and pi-tui cursor marker. Status recursion must remain non-interactive. An editor control is legal only at the editor root or through editor stack/surface slots; ordinary descendants (especially `scroll`) must parse as `BlueUiNode` and cannot reopen the editor slot. Nested scroll remains rejected.

`src/ui-compiler.ts` is the sole canonical `BlueUiNode` -> pi-tui compiler and must call the validator itself. Its returned composite is the only `BlueFocusable`: it owns roving state, live viewport reconciliation, event containment, and exactly-one cursor-marker insertion. It must expose the real root `LAYOUT_NODE`; an opaque wrapper leaves nested ScrollView state at zero. Direct render/stop replay uses a sentinel replaced after composition. AltScreen layout bypasses wrapper render, so its explicit layout-pass adapter emits an equal-width marker from the reconciled active leaf; real `renderLayoutFrame` HStack and replay tests must cover both paths. AltScreen scroll is non-primary/contained and clips to its stack-allocated height. MainScreen unwraps scroll, linearizes row stacks, and preserves all document rows. Do not clamp stack sizing to the compile-time viewport; the fixed safety ceiling exists solely to bound hostile safe integers during later live resize.

`src/ui-patterns.ts` is the private L2 presentation adapter used only by that compiler. It may paint canonical surface/tabs/list/form/actions/loader/empty/progress/divider rows with semantic palette tokens and must delegate visible-column measurement and slicing to `src/width.ts`; it is not a public subpath or an alternate admission/compiler seam. Active tabs, controlled list selection, and roving focus remain separate states. Every enabled focused list row receives the unique marker, `primary`, and a full-width `selectedBg`; an unfocused controlled selection keeps only its persistent selection glyph/semantic foreground, while disabled selected rows use one muted layer and can never focus. At narrow widths list detail disappears before tabs/actions collapse, and the render-exit width clamp remains the final backstop. Loader frames are deterministic and own no timer.

The compiler composite owns the L2 interaction drafts: printable text/backspace update a surface-local form buffer and emit proposed `value-change`, select arrows update a local enabled-option candidate and confirmation emits it, toggles retain their proposed boolean for a later submit, and a fresh controlled render deterministically seeds every draft from canonical values. Direction keys stay within the active pattern while Tab/Shift-Tab roves across controls. Action `confirm` is a real two-gesture surface-local state; Escape, focus movement, or surface blur clears it. None of these drafts mutate the validated frozen node.

`BlueEditor.removeLatestHistory(text)` is the narrow retraction helper over pi-tui's private history array: it removes index 0 only on an exact match. The method stays optional on the L1 contract so structural fakes and out-of-tree adapters remain compatible; core's sole real adapter implements it.

The pi-tui-backed component factory and width pure functions:

- `src/plugin-view.ts` is the public `BlueView` compiler used only by the
  owner bridges. It strips caller ANSI/OSC/control bytes, applies semantic
  tones from the live owner palette, caps text/depth/rows, delegates all width
  math to `blueComponents`, and contains a dynamic render failure as one
  bounded error row. Plugins never receive a `BlueComponent` from this seam.

- `createImage(options)` wraps pi-tui's Image with a styled-text fallback for terminals without an image protocol; the pure `imageDimensions(data)` probe covers PNG/JPEG/GIF/WebP.
- `BlueEditor.insertText(text)` — atomic insertion at the cursor; the seam the clipboard-image markers use.
- `createFileMentionProvider(basePath, fdPath)` (D31) returns the renderer's combined autocomplete provider (constructed with no commands; structurally identical to `BlueAutocompleteProvider`, so it passes through unwrapped) as the `@`-mention source: fd-backed scoped queries, substring scoring, top-20, quoted values, `applyCompletion` stateless of fd. On the same seam, `EditorAdapter.handleInput` carries the kimi `reopenAutocompleteAfterInput` hook: after any input, text ending in `/` inside an `@` mention re-opens the dropdown (directory drill-down), gated on `isShowingAutocomplete` and calling 0.84.2's private `tryTriggerAutocomplete` through the `getHistory`-style structural cast.
- `createEditor` wires completion through an own-property shadow of the Editor's private `createAutocompleteList`: a `/`-prefixed dropdown gets the wrapping list with the `{12, 32}` slash layout; every other completion keeps the stock `SelectList`.
- The `BlueComponents` contract re-exports pi-tui's pure fuzzy helpers: `fuzzyMatch(query, text) → {matches, score}` (lower is better) and the token-splitting `fuzzyFilter`.

## Themes and markdown rendering

The v2 28-token palette maps onto the component themes: selection/cursor rows take `primary`, hints take `textMuted`, markdown headings carry their level through bold, unordered markers normalize to `•`, and fenced code goes through cli-highlight behind the markdown `highlightCode` hook. The internal `src/highlight.ts` wrapper gates on `supportsLanguage`, resets cli-highlight's red scopes to the palette base, and falls back to the raw split so line count never changes.

The markdown adapter carries a horizontal-rule post-process: pi-tui caps rules at 80 columns regardless of the render width, so the adapter re-paints the capped rule to the full render width (exact string match on the theme's known output, tolerating row padding — fenced code lines keep their own styling).

The `blueTheme` contract lives in `src/types.ts`; implementations ship as four subpath plugins, all built on the internal `src/theme-palette.ts` palette helpers:

- `./theme-dark` (`src/theme-dark.ts`, `blue-theme-dark`) — the built-in 28-token dark palette, the plain-baseline default.
- `./theme-light` (`src/theme-light.ts`, `blue-theme-light`).
- `./theme-auto` (`src/theme-auto.ts`, `blue-theme-auto`) — picks dark/light from `blueTerminalInfo` and re-provides on `'blue/terminal-theme-changed'`.
- `./theme-custom` (`src/theme-custom.ts`, `blue-theme-custom`) — a schemastery-validated JSON file palette over a built-in base.

## Shared chrome layer (D25)

The pure `src/chrome.ts` — re-exported as the `./chrome` subpath, theme-agnostic functions over `string[]` rows:

- `EditorAdapter.render` post-processes the editor into a rounded box (`withSideBorders`/`injectPromptSymbol`, the kimi port: rules stripped and repainted through the live `borderColor` property so host `setBorderColor` recolors the whole frame, `│` bars overlaid only on literal outer spaces, labels never entering scroll indicators). `BlueEditor` exposes `setPromptSymbol('>' | '!' | undefined)` / `setBorderLabel(text)` / `setConnectedAbove(bool)` / `setGhostHint(…)`. When connected above, the adapter renders at the dock's `width - 2` inner budget and restores the shared left gutter, aligning both side borders with the pane above. The editor theme's default border is the neutral `border` token; slash/bash contexts carry the color.
- `framePanel(body, width, opts)` frames a body in kimi's full-width flat `─` rules — title + optional muted title hint + optional key-row footer, all paints defaulting to identity, ANSI-safe truncated. The five overlay dialogs (approval/questionnaire//help//sessions/BlueSelect) render through it. Below `FRAME_DEGENERATE_WIDTH` (8) the framer also cuts its body rows (D48): callers pre-budget rows for normal widths, but a degenerate viewport can sit under the rows' fixed furniture — wider frames emit the body untouched.
- `clampRowsToWidth(rows, width, truncate)` (D48) is the component-level width backstop: every hand-assembled frame passes through it after assembly (fits return untouched). `src/frame-clamp.ts` holds the render-exit backstop itself (`clampFrame` + the deduplicating `blue-overflow.log` sink wired into terminal.ts's render wrapper), and `src/width.ts` is the tree's single re-export seam for pi-tui's width utilities (runtime consumers reach them through the components service or this module — no other package names pi-tui).
- `hintRow(parts, paint)` joins key-hint parts with ` · `.
- `topRule(width, {title, titlePaint, hint, hintPaint, paint})` renders the kimi in-border title row `╭ BTW ─ Esc close ────╮` — the `─ ` joiner appears only when both a title and a hint are present; the composite clips ANSI-safe (pi-tui's empty-ellipsis truncation appends a closing `\x1b[0m`, a protective reset) and the dash fill takes the remainder.
- `padColumns(lines, n)` is the pure gutter equivalent of kimi's `GutterContainer`.
- `injectGhostHint` splices the dimmed hint after the inverse-video cursor, consuming trailing padding so the row width holds, ellipsizing on overflow, and leaving mid-text cursors untouched (`setGhostHint`'s first consumer).
- `highlightLeadingSlashToken` re-paints the leading `/command` token through visible-index math so ANSI pass-through survives (bold `primary` at the call site).

## Gutter and dock mechanics (D29)

`BlueScreen.addDockChild` is the optional compatibility extension for passive panes; `mountDockChild` selects it when present and falls back to the legacy bottom mount for structural fakes and older adapters. Larger `BlueDockOptions.priority` values receive scarce rows first and render closer to the fixed editor block. `addBottomChild` retains its fixed-slot semantics, with `'bottom'` still pinning the footer tail.

`GutterComponent` (`src/gutter.ts`, exported from the package root — the kimi `GutterContainer` equivalent): the child renders at `max(1, width - 2n)` (the floor keeps degenerate resize-drag viewports from handing children zero or negative widths, D48) and every row gains `n` leading columns through `padColumns`, styling untouched, `invalidate` forwarded; below `2n + 2` columns the padded rows are also cut to the width (the gutter furniture itself no longer fits). It wraps every inset surface at the mount layer — transcript entries, the banner, the four dock panes, and the footer — while the editor, dialogs, and overlays stay full-width.

## WrappingSelectList

`src/wrapping-select-list.ts` is the kimi `WrappingSelectList` port — the repo's only pi-tui subclass. It replaces just `render` so descriptions wrap onto at most two word-boundary lines with an ellipsis past the second, reading pi-tui's private row state through a single cast pinned by a 0.84.2 spec.

## Cross-package events

Three events live on the core Events merge:

- `'blue/editor-connected-above'` — the D25-pre-approved splice flag: pane-btw emits, blue-input mirrors it onto the editor.
- `'blue/btw-command'` — editor key chain → pane close/scroll routing.
- `'blue/editor-slot-swapped'` — blue-input emits on its replacement-panel stack's empty↔occupied transitions (nested panels re-emit nothing; unloading with one open releases the occupancy). pane-activity hides while occupied and pane-btw re-asserts its splice on return.

Theme providers also publish a semantic companion through the optional `blueThemeModels` frontend registry. ANSI color functions remain core-only; the companion contains the source palette hexes and is removed with the theme provider Fiber.

`blueNotifications` is the frontend runtime's immutable notification registry; core only hosts its lifecycle, while feature adapters push structured messages and consume snapshots.
`frontend-renderer.ts` is the narrow TUI consumer for `@dsh-blue/blue-frontend` readonly views. `renderFrontendView`/`renderFrontendModel` and `FrontendModelComponent` are the only renderer-facing bridge for the new frontend model; width clamping delegates to pi-tui through `width.ts`. It does not read Harness events or session objects. `renderFrontendView` accepts optional colors: the diff view renders through `diff-align.ts` (prefix/suffix trim + LCS middle, a size guard degrading oversized inputs to whole blocks) with the diff palette tokens, context rendered once, and long unchanged runs elided; the plugin `BlueView` path delegates to the same painter. Alignments are memoized per frozen diff view object.

## Verification note

`theme-custom` accepts a validated `logoGradient` array as a frozen palette override; invalid arrays and entries retain the base gradient.

Shared filesystem fixtures in `tests/temp-dir.ts` are tracked per worker and
must opt into `registerTempDirCleanup()` for eager `afterAll` removal. The
module-level exit hook is the fallback for specs that are interrupted before
their cleanup hook can run.
