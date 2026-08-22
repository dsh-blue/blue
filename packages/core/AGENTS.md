# @dsh-blue/blue-core — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Scope and L0 boundary

Core is the tree's ONLY package allowed to import `@earendil-works/pi-tui` (plus raw terminal state). It owns terminal lifecycle (`src/terminal.ts`) and exposes pi-tui-independent contracts in `src/types.ts` so pi-tui breaking changes cannot propagate past it. Real runtime dependencies: `@earendil-works/pi-tui`, `@deepseek-ai/schemastery` (theme-custom config validation), and `cli-highlight` (code-fence syntax coloring behind the markdown `highlightCode` hook).

## L1 services and the global key dispatcher

- **`blueScreen`** (`src/screen.ts`) — the screen contract carries `readonly rows` (the btw panel's height budget reads it live) and `addBottomChild(component, position?)`: the optional `'bottom'` position renders the component below the rest of the dock. The footer shell mounts pinned there, putting the two-row status on the terminal's last rows beneath the editor — the kimi dock layout the pull-up dialog panels leave visible. `setTitle(title)` (S30) delegates to the runtime, which writes a sanitized OSC 0 sequence through the terminal (pi-tui's own `Terminal.setTitle` is bypassed — it hardcodes `process.stdout`); the sequence paints no cell, so it never disturbs differential rendering, and inside tmux it becomes the tmux window name (deliberately no DCS passthrough wrap — unlike OSC 52, tmux consumes rather than swallows it). The pure helpers live in `src/terminal-escape.ts` beside the OSC 52 emitters: `sanitizeTitleText` (strips C0/C1 plus directional/invisible controls, collapses whitespace), `TITLE_MAX_CHARS` (32 code points), `buildTitleOsc0`. Since S31 the contract also carries `suspend(fn)` (see below).
- **`blueKeymap`** (`src/keymap.ts`) — `list()` gives a registration-order snapshot for `/help`-style enumeration; registration runs key-level conflict detection.
- **`blueTerminalInfo`** (`src/terminal-info.ts`) — read-only terminal facts from the startup OSC 11 background probe.
- **Global key dispatcher** — core's `apply` mounts a pi-tui input listener ahead of focus routing that consumes keymap actions carrying a `handler`. The service is instantiated directly in `apply`, not via `ctx.plugin`: the Cordis Context proxy rejects uninjected services, and a service cannot inject itself.

  The terminal runtime also installs one input-boundary normalizer for SGR and
  legacy X10 wheel reports. Main-screen mode does not enable mouse reporting,
  but a multiplexer or inherited terminal mode can still send these sequences;
  they are converted to pi-tui's standard up/down key sequences before focus
  routing, so panels share one scroll seam. The listener is removed with the
  runtime stop lifecycle.

Dock sinking lives in `startBlueTerminal`: the renderer instance's `render` is wrapped so that when the mounted tree is shorter than the viewport, blank filler is inserted between the scroll content and the bottom-pinned block, keeping the footer/editor dock on the terminal's last rows. Full viewports, empty trees, and dock-less trees render untouched.

## Suspend/resume seam (S31, `runtime.suspend` → `blueScreen.suspend`)

The recoverable suspend composes pi-tui 0.84.2's own lifecycle primitives — `TUI.stop()` / `TUI.start()` / `requestRender(true)` — and is deliberately NOT the teardown `runtime.stop()`. State machine (closure flags `stopped`/`suspended` inside `startBlueTerminal`):

- **suspend(fn)**: exclusive (a second in-flight call rejects) and refused once stopped. `current.stop()` with NO `preserveScreen` — Blue is always `TuiMainScreen`, so the child appends below the content in the scrollback tail (kimi's main-screen ordering; `preserveScreen` is only meaningful for an alt-screen takeover). One `setImmediate` beat flushes the stop escapes before the child takes the tty, then `fn` runs with the terminal released (raw mode off, pi-tui detached).
- **resume** (fn settlement, in a `finally`): `process.stdin.pause()` BEFORE `start()` — bytes buffered while suspended must not surface as application input once raw mode re-arms — then, unless the runtime was torn down mid-suspend (`stopped || activeRuntime !== runtime`), `current.start()` (its self-SIGWINCH on Unix refreshes dimensions stale from a resize while suspended) → `setTerminalColorSchemeNotifications(true)` (the stop wrote `\x1b[?2031l`; the registered `onTerminalColorSchemeChange` callback itself survives stop/start) → `requestRender(true)` (forced full repaint). fn's rejection propagates unchanged — resume never swallows.
- **stop() during suspend** (fiber unload / fail-loud release while a child owns the tty): `stopped = true` but NO `terminal.drainInput()` (the parent drain would steal the child's input) and NO second `current.stop()` (the renderer is already stopped; a replay of teardown sequences would corrupt the child's screen). It only unregisters `activeRuntime`; the later resume detects the teardown and skips the restart.
- Render ticker: pi-tui has no standing render loop — `stop()` cancels the 16ms throttle timer for free. Application-level timers (footer tips, spinners) keep firing into `requestRender` and no-op inside the stopped renderer's early exit; accepted as harmless spinning (kimi does the same), not gated.

## Component factory (`blueComponents`, `src/components.ts`)

The pi-tui-backed component factory and width pure functions:

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

- `EditorAdapter.render` post-processes the editor into a rounded box (`withSideBorders`/`injectPromptSymbol`, the kimi port: rules stripped and repainted through the live `borderColor` property so host `setBorderColor` recolors the whole frame, `│` bars overlaid only on literal outer spaces, labels never entering scroll indicators). `BlueEditor` exposes `setPromptSymbol('>' | '!' | undefined)` / `setBorderLabel(text)` / `setConnectedAbove(bool)` / `setGhostHint(…)`. The editor theme's default border is the neutral `border` token; slash/bash contexts carry the color.
- `framePanel(body, width, opts)` frames a body in kimi's full-width flat `─` rules — title + optional muted title hint + optional key-row footer, all paints defaulting to identity, ANSI-safe truncated. The five overlay dialogs (approval/questionnaire//help//sessions/BlueSelect) render through it. Below `FRAME_DEGENERATE_WIDTH` (8) the framer also cuts its body rows (D48): callers pre-budget rows for normal widths, but a degenerate viewport can sit under the rows' fixed furniture — wider frames emit the body untouched.
- `clampRowsToWidth(rows, width, truncate)` (D48) is the component-level width backstop: every hand-assembled frame passes through it after assembly (fits return untouched). `src/frame-clamp.ts` holds the render-exit backstop itself (`clampFrame` + the deduplicating `blue-overflow.log` sink wired into terminal.ts's render wrapper), and `src/width.ts` is the tree's single re-export seam for pi-tui's width utilities (runtime consumers reach them through the components service or this module — no other package names pi-tui).
- `hintRow(parts, paint)` joins key-hint parts with ` · `.
- `topRule(width, {title, titlePaint, hint, hintPaint, paint})` renders the kimi in-border title row `╭ BTW ─ Esc close ────╮` — the `─ ` joiner appears only when both a title and a hint are present; the composite clips ANSI-safe (pi-tui's empty-ellipsis truncation appends a closing `\x1b[0m`, a protective reset) and the dash fill takes the remainder.
- `padColumns(lines, n)` is the pure gutter equivalent of kimi's `GutterContainer`.
- `injectGhostHint` splices the dimmed hint after the inverse-video cursor, consuming trailing padding so the row width holds, ellipsizing on overflow, and leaving mid-text cursors untouched (`setGhostHint`'s first consumer).
- `highlightLeadingSlashToken` re-paints the leading `/command` token through visible-index math so ANSI pass-through survives (bold `primary` at the call site).

## Gutter and dock mechanics (D29)

`GutterComponent` (`src/gutter.ts`, exported from the package root — the kimi `GutterContainer` equivalent): the child renders at `max(1, width - 2n)` (the floor keeps degenerate resize-drag viewports from handing children zero or negative widths, D48) and every row gains `n` leading columns through `padColumns`, styling untouched, `invalidate` forwarded; below `2n + 2` columns the padded rows are also cut to the width (the gutter furniture itself no longer fits). It wraps every inset surface at the mount layer — transcript entries, the banner, the four dock panes, and the footer — while the editor, dialogs, and overlays stay full-width.

## WrappingSelectList

`src/wrapping-select-list.ts` is the kimi `WrappingSelectList` port — the repo's only pi-tui subclass. It replaces just `render` so descriptions wrap onto at most two word-boundary lines with an ellipsis past the second, reading pi-tui's private row state through a single cast pinned by a 0.84.2 spec.

## Cross-package events

Three events live on the core Events merge:

- `'blue/editor-connected-above'` — the D25-pre-approved splice flag: pane-btw emits, blue-input mirrors it onto the editor.
- `'blue/btw-command'` — editor key chain → pane close/scroll routing.
- `'blue/editor-slot-swapped'` — blue-input emits on its replacement-panel stack's empty↔occupied transitions (nested panels re-emit nothing; unloading with one open releases the occupancy). pane-activity hides while occupied and pane-btw re-asserts its splice on return.
