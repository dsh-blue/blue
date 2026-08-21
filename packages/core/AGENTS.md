# @dsh-blue/blue-core — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Scope and L0 boundary

Core is the tree's ONLY package allowed to import `@earendil-works/pi-tui` (plus raw terminal state). It owns terminal lifecycle (`src/terminal.ts`) and exposes pi-tui-independent contracts in `src/types.ts` so pi-tui breaking changes cannot propagate past it. Real runtime dependencies: `@earendil-works/pi-tui`, `@deepseek-ai/schemastery` (theme-custom config validation), and `cli-highlight` (code-fence syntax coloring behind the markdown `highlightCode` hook).

## L1 services and the global key dispatcher

- **`blueScreen`** (`src/screen.ts`) — the screen contract carries `readonly rows` (the btw panel's height budget reads it live) and `addBottomChild(component, position?)`: the optional `'bottom'` position renders the component below the rest of the dock. The footer shell mounts pinned there, putting the two-row status on the terminal's last rows beneath the editor — the kimi dock layout the pull-up dialog panels leave visible.
- **`blueKeymap`** (`src/keymap.ts`) — `list()` gives a registration-order snapshot for `/help`-style enumeration; registration runs key-level conflict detection.
- **`blueTerminalInfo`** (`src/terminal-info.ts`) — read-only terminal facts from the startup OSC 11 background probe.
- **Global key dispatcher** — core's `apply` mounts a pi-tui input listener ahead of focus routing that consumes keymap actions carrying a `handler`. The service is instantiated directly in `apply`, not via `ctx.plugin`: the Cordis Context proxy rejects uninjected services, and a service cannot inject itself.

Dock sinking lives in `startBlueTerminal`: the renderer instance's `render` is wrapped so that when the mounted tree is shorter than the viewport, blank filler is inserted between the scroll content and the bottom-pinned block, keeping the footer/editor dock on the terminal's last rows. Full viewports, empty trees, and dock-less trees render untouched.

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
- `framePanel(body, width, opts)` frames a body in kimi's full-width flat `─` rules — title + optional muted title hint + optional key-row footer, all paints defaulting to identity, ANSI-safe truncated. The five overlay dialogs (approval/questionnaire//help//sessions/BlueSelect) render through it.
- `hintRow(parts, paint)` joins key-hint parts with ` · `.
- `topRule(width, {title, titlePaint, hint, hintPaint, paint})` renders the kimi in-border title row `╭ BTW ─ Esc close ────╮` — the `─ ` joiner appears only when both a title and a hint are present; the composite clips ANSI-safe (pi-tui's empty-ellipsis truncation appends a closing `\x1b[0m`, a protective reset) and the dash fill takes the remainder.
- `padColumns(lines, n)` is the pure gutter equivalent of kimi's `GutterContainer`.
- `injectGhostHint` splices the dimmed hint after the inverse-video cursor, consuming trailing padding so the row width holds, ellipsizing on overflow, and leaving mid-text cursors untouched (`setGhostHint`'s first consumer).
- `highlightLeadingSlashToken` re-paints the leading `/command` token through visible-index math so ANSI pass-through survives (bold `primary` at the call site).

## Gutter and dock mechanics (D29)

`GutterComponent` (`src/gutter.ts`, exported from the package root — the kimi `GutterContainer` equivalent): the child renders at `width - 2n` and every row gains `n` leading columns through `padColumns`, styling untouched, `invalidate` forwarded. It wraps every inset surface at the mount layer — transcript entries, the banner, the four dock panes, and the footer — while the editor, dialogs, and overlays stay full-width.

## WrappingSelectList

`src/wrapping-select-list.ts` is the kimi `WrappingSelectList` port — the repo's only pi-tui subclass. It replaces just `render` so descriptions wrap onto at most two word-boundary lines with an ellipsis past the second, reading pi-tui's private row state through a single cast pinned by a 0.84.2 spec.

## Cross-package events

Three events live on the core Events merge:

- `'blue/editor-connected-above'` — the D25-pre-approved splice flag: pane-btw emits, blue-input mirrors it onto the editor.
- `'blue/btw-command'` — editor key chain → pane close/scroll routing.
- `'blue/editor-slot-swapped'` — blue-input emits on its replacement-panel stack's empty↔occupied transitions (nested panels re-emit nothing; unloading with one open releases the occupancy). pane-activity hides while occupied and pane-btw re-asserts its splice on return.
