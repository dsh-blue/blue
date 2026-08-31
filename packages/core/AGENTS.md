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

`src/surface-manager.ts` is the core-private W3-A seam for already compiled pane components; it is deliberately absent from the package root and from `BlueScreen`. It owns deterministic header/left/right/bottom arbitration, frozen profile-state input/output, Blue lane tabs/overflow, the 20..48 side-width hard boundary, and the 40-column collapse/44-column reopen hysteresis. Lane strength is user pin/order, then transient focus/recent activation, then plugin priority/id. Provider hidden state remains separate from user hidden state; disposing an active fallback selects a stable successor. A replacement compares both component and resolved focus target: the plugin bridge intentionally retains one pane wrapper while an admitted projection switches between interactive and passive. `terminal.ts` uses the semantic linear layout to keep potential side and bottom nodes mounted across resize: AltScreen builds optional header, a real `HStack(left, primary transcript ScrollView, right)`, optional managed bottom, then the fixed dock; MainScreen renders header/content/left/right/bottom/editor/status linearly. Layout-aware lane wrappers expose the active compiler component's `LAYOUT_NODE`, so legal pane scroll stays non-primary/contained at its allocated lane height. The fixed dock never shrinks at the outer root: header and managed bottom surrender height first, preserving one transcript row plus the editor/status tail. User tab activation, focused refresh replacement, and active unload retarget renderer focus only when it still points at the previous lane target; overlay `preFocus` is retargeted under the same condition. Hidden side overflow or a missing target releases that matching focus to `null`; bottom fallback remains in-frame and retains it. No-contribution roots retain the old two-band AltScreen tree and flat MainScreen frame exactly.

`src/plugin-surface-bridge.ts` is the core-private W3-C owner bridge. Its child
Fiber injects the composition-private `bluePluginControl` plus components,
theme, and keymap. The control is closure-bound to the host and exposes only
owner-authorized snapshot, gesture, and overlay-close operations inside the
bundle's isolated runtime realm; no public plugin receives it or renderer
objects. Pane and overlay render callbacks pass through the canonical compiler.
Each registration owns a core-private `BlueUiSurfaceRuntime` plus a stable
wrapper; ordinary `compileBlueUiNode` calls remain fresh and share no state.
Successful event settlement recompiles in internal mode, preserving semantic
focus, editor/cursor, draft, and confirmation state. Host snapshot refresh
recompiles in external mode, clearing local value drafts in favor of canonical
values but retaining semantic focus and editor identity. Coalescing makes
external mode win when both modes arrive in one microtask. Pane `null` removes
its managed surface and deactivates its compiled generation without disposing
the registration runtime; hide does not render or mutate it. Render/validation
or setup failures compile an ephemeral bounded danger node and never commit or
clear the persistent runtime. Non-capturing overlays reject every potentially
interactive tree. Overlay dismiss, fault, or timeout closes the owner entry and
aborts queued work; pane failures remain contained without destroying the
event owner. Change events are latest-wins per control, discrete events are
FIFO, and every successful generation coalesces one refresh behind abort,
timeout, and stale-generation fences. F6/Shift-F6 traverses visible managed
panes and restores the pre-surface focus at either boundary; any capturing
overlay, including built-in overlays, blocks traversal.

Each mounted pane/overlay event owner captures the control-plane capability
generation. It rejects dispatch and settlement after owner replacement even
when an old renderer callback is retained. Renderer unload closes every host
overlay entry before hiding its local handle, because overlay opens are
transient actions and must never replay into the replacement owner generation.
Close, contribution/request replacement, consumer unload, and renderer-owner
unload dispose the registration runtime, clear owned editor callbacks, and make
every old compiled generation's render/input/invalidate/layout path a no-op.
Render exceptions inspect only an own data `message` property behind a guarded
descriptor lookup; revoked proxies and accessor-backed thrown values retain the
fixed bounded fallback instead of escaping the error boundary.

P3's packed fixture, generation-fence suite, and real-profile acceptance are
complete. These public UI capabilities remain Public Beta until ecosystem
consumer evidence and the later P7 promotion gate close.

The API host Fiber owns the durable panes/overlays readiness and buffering
lease, so host-only external rows may register regardless of core import order,
while theme/components are pending, or during a nested bridge reload gap. The
nested bridge replays buffered pane contributions after mount and keeps its own
runtime-scoped attachment for renderer ownership; core unload removes rendered
surfaces, closes transient overlays, and leaves only host-buffered pane
registrations ready for a replacement renderer. When the API host unloads, it fences dependent
consumer facades before draining registries, independent of Cordis disposal
order; writes through a retained facade therefore return `BLUE_ACTION_REJECTED`,
not the `BLUE_CAPABILITY_ABSENT` reserved for a live consumer crossing a
renderer-owner gap.

Public overlay titles are canonical UI, not terminal metadata: the bridge wraps
the plugin node (including bounded null/error fallbacks) in a `surface` with
`chrome: 'overlay'` before the sole compiler boundary. The canonical compiler
owns one closed frame: it budgets borders and explicit inner padding once and
preserves both corners at usable widths. During the 1/2-column resize transient,
body content takes priority over frame furniture without overflow. Plugin content must not return a
second overlay frame. Overlay width and
explicit minimum width remain live across terminal resize; the bridge forwards
the admitted constraint unchanged and `terminal.ts` clamps both against the
current columns and the trusted hard maximum when pi-tui reads them. Because
pi-tui's overlay compositor is width-only, the private bridge wrapper switches
to the canonical layout pass when content reaches the live height budget; this
keeps both frame edges and nested scroll allocation inside `maxHeight` instead
of letting the compositor slice the bottom edge.

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

`src/ui-validator.ts` is the only admission path for public `BlueUiNode`, recursively narrowed `BlueStatusNode`, and `BlueEditorShellNode` trees. Preserve the 20,000-text-unit, depth-8, 256-node, and 200-entry quotas; copy known fields and recursively freeze only the canonical copy; strip ESC and C1 terminal strings plus the private focus sentinel and pi-tui cursor marker. Ordinary records and dense arrays from another VM realm are admitted only when their prototype has the matching native realm constructor, constructor-to-prototype backreference, and intrinsic own-descriptor shape; local prototype identity is not required. Class instances, named-constructor spoofs, exotic/custom prototypes, sparse/subclass arrays, accessors, and proxy failures remain rejected, and known fields are read only through own data descriptors. Status recursion must remain non-interactive. An editor control is legal only at the editor root or through editor stack/surface slots; ordinary descendants (especially `scroll`) must parse as `BlueUiNode` and cannot reopen the editor slot. Its complete stack ancestry must guarantee visibility: reject any `when`, `maxSize: 0`, or explicit `basis: 0`/`grow: 0`/zero-minimum allocation on a child containing the slot. Nested scroll remains rejected.

`src/ui-compiler.ts` is the sole canonical node -> pi-tui compiler. `compileBlueUiNode` must call the ordinary validator itself; `compileBlueStatusNode` must independently call the recursively narrowed status validator; `compileBlueEditorShellNode` must independently validate the shell and inject the exact host-owned `BlueEditor` at its sole `editor-control`. All three use the same admitted-node compiler and painter graph. The bridge-only `compileBlueUiSurfaceNode` accepts one registration-owned runtime and is not re-exported from the package root. Its focus keys derive only from canonical control/form/item ids, never compiler paths, so reorder preserves identity; horizontal action groups add the sorted item-id set so legal duplicate action-node ids do not merge navigation. Tab/Shift-Tab roves distinct semantic groups in tree order; tabs/actions use horizontal arrows, list/form use vertical arrows, and each group remembers its last active semantic key. Text form controls separate navigation selection from editing: Enter or printable/paste input starts editing; compiler-owned Enter confirms the live buffer without clearing the editor and retains the same semantic control; textarea Alt+Enter inserts one newline while other text fields consume it; Escape ends editing before it can dismiss an overlay; and Tab ends editing before advancing when another group exists. Select controls use the same explicit entry boundary: Enter begins a visible adjustment transaction, horizontal arrows update its registration-local candidate, Enter emits the confirmed value, and Escape/Tab or an implicit editing teardown restores the captured origin. An external canonical refresh exits select adjustment before accepting the new value. Only text editing assigns pi-tui editor focus and exposes its inverse-video caret; the composite focus marker still locates the selected row. Responsive hiding retains desired focus and editing intent while blurring the editor; reappearance restores both, while deletion, disablement, kind change, or eviction clears incompatible editing state and promotes the fallback permanently. Every reconcile blurs pooled text editors whose controls are not currently visible and enabled, while retaining their identity, draft, and cursor for a later compatible return. Setup is transactional: editor creation/rebinding is lazy, and a failed compile rolls back node/options/generation plus value drafts, group memory, and editing state before any editor cursor can move. Successful admission retains at most 64 inactive field states per registration as an LRU so active-tab-only trees can restore editor/draft/cursor state; an exact field-kind change, LRU eviction, or runtime dispose clears the incompatible state and owned callbacks. Compatibility-resolved editors enter that same pool: replacement releases the old instance, and deactivate/dispose detach only compiler-owned change/submit callbacks from the current instance, preserving an external replacement and the resolver-owned `onKey`. Editor-shell dry renders restore every pooled editor instance's entry focus, including resolver editors first discovered during the dry render; factory editors retain their initial unfocused state. Recompiling a shell must never manufacture or replace that editor object: cursor, IME, paste, undo, history, and the pre-clear submission transaction belong to the stable renderer engine. The status result is a passive facade with no focus/input/event surface: row stacks retain compact spatial `HStack` semantics in both screen modes, output is runtime-bounded to 1..3 rows, and `renderStatus` reports overflow plus the first contained leaf/root `runtimeFailure` for the current render. The failure accumulator resets on every frame; ordinary safe error rows remain unchanged, while the status composition owner can reject a dry render or trip its runtime breaker. Private official-compatibility options may impose a post-wrap leaf-row budget, select one exact leaf for a live row offset/metadata callback, or replace one exact text leaf with core's Markdown renderer; public plugin/host compilation never sets them. The composite render exit still enforces the column clamp. Its returned composite is the only `BlueFocusable`: it owns roving state, live viewport reconciliation, event containment, and exactly-one cursor-marker insertion. It must expose the real root `LAYOUT_NODE`; an opaque wrapper leaves nested ScrollView state at zero. Direct render/stop replay uses a sentinel replaced after composition. AltScreen layout bypasses wrapper render, so its explicit layout-pass adapter emits an equal-width marker from the reconciled active leaf; editing fields retain the real editor caret and replace the sentinel locally, while navigation-only fields use the row marker and omit pi-tui's fake caret. Real `renderLayoutFrame` HStack/editor and replay tests must cover both paths. AltScreen scroll is non-primary/contained and clips to its stack-allocated height. Ordinary MainScreen UI unwraps scroll, linearizes row stacks, and preserves all document rows. Do not clamp stack sizing to the compile-time viewport; the fixed safety ceiling exists solely to bound hostile safe integers during later live resize. Delete the private Markdown selector when the canonical schema gains a validated Markdown/content node, and delete the leaf window/metadata seam when canonical content boxes expose controlled post-wrap scrolling.

Bridge-owned plugin surfaces and the official `CanonicalPanelAdapter` append one core-private contextual key-hint row derived from the reconciled visible/enabled control set and current editing or confirmation state. Canonical roles are the source of truth: tabs use horizontal selection plus Enter, single lists vertical selection plus Enter, multiple lists vertical selection plus Space, actions horizontal selection plus Enter, form fields their explicit edit/adjust state, and pending confirmation Enter/Escape. Official complex controllers may suppress those automatic fragments or merge renderer-private operations by semantic id; duplicate ids replace instead of repeating copy, and provider/translator failures are contained. At most three fragments survive by priority. The row exists only while that surface owns focus, degrades through whole-token variants before disappearing at narrow widths, and is part of the real layout tree; titled overlays therefore keep it inside their one compiler-owned frame and height budget. Ordinary compilation without the explicit option, status compilation, editor shells, passive/non-capturing surfaces, and stale generations never expose the hint. Escape is advertised only when the owner supplies a real close or focus-release action. `context-hint-locale.ts` owns the plugin-surface English/Chinese operation catalog and invalidates the terminal on locale revisions without adding public copy to the canonical schema.

Compiler and plugin-surface catches share `src/error-message.ts`: it reads only
a non-empty own data `message` behind a guarded descriptor lookup. Accessors,
revoked proxies, primitive throws, and other opaque values retain a fixed
bounded fallback and cannot escape during error reporting.

Editor-shell composites additionally expose `renderChecked(width, { dryRun })`
for the interaction-owned provider transaction. It reports the first contained
runtime failure without parsing painted error rows. Dry runs restore composite,
roving, viewport, and injected-editor focus state. `focusEditor()` selects the
one editor-control inside the shell but never takes screen focus; the outer
interaction owner remains responsible for restoring the screen's stable focus
delegate after an atomic provider swap. A shell whose only interactive control
is that editor delegates Tab and Shift-Tab to the stable editing engine, so
provider chrome cannot suppress completion acceptance or an explicit completion
request. Shells with additional controls retain composite-owned Tab roving.

`src/ui-patterns.ts` is the private L2 presentation adapter used by the compiler and the editor-internal autocomplete adapter. It may paint canonical surface/tabs/list/form/actions/loader/empty/progress/divider rows with semantic palette tokens and must delegate visible-column measurement and slicing to `src/width.ts`; it is not a public subpath or an alternate admission/compiler seam. Active tabs, controlled list selection, and roving focus remain separate states. Every enabled focused list row receives the unique marker, `primary`, and a full-width `selectedBg`; semantic `detailSpans` retain their own tone/emphasis inside that focused background, while an unfocused controlled selection keeps only its persistent selection glyph/semantic foreground. A focused action applies `selectedBg` only to its fixed-width token, retaining primary/danger foreground semantics so colored actions still gain a visible rectangular focus state. Badges precede truncatable detail so state such as `← current` survives a closed overlay's inner-width budget. Disabled selected rows use one muted layer and can never focus. At narrow widths list detail disappears before tabs/actions collapse, and the render-exit width clamp remains the final backstop. Loader frames are deterministic and own no timer.

The former `src/frontend-renderer.ts` conversion bridge and its `renderFrontendView`, `renderFrontendModel`, and `FrontendModelComponent` exports are physically deleted. Frontend, transcript, context, and tool producers now publish canonical `BlueUiNode` values; renderer adapters call `compileBlueUiNode` at the core boundary. Do not restore a frontend-specific converter or painter. Public `BlueView` remains the safe content-leaf subset of the canonical schema; its diff alignment, semantic paint, sanitation, and width containment still have one core owner through the canonical compiler.

The compiler composite owns the L2 interaction drafts. Canonical `input`, `textarea`, and `secret` fields may resolve a stable core-created `BlueEditor` from the official compatibility adapter, preserving cursor, IME, bracketed-paste, and submit behavior across controlled recompiles. `renderContent(width, masked?)` exposes only the editor's unframed rows to the core form painter; secret rendering temporarily substitutes bullets and restores plaintext in `finally`, so neither the renderer nor error output leaks the value, and unfocused form renders strip only pi-tui's synthetic inverse caret. Controlled synchronization calls `setText` only when the expanded value differs, and `value-change` remains the renderer-neutral outward event. Select adjustment stores its captured origin beside the local enabled-option candidate so cancellation cannot expose an un-emitted value; toggles retain their proposed boolean, group-level Tab/Shift-Tab and form-level Up/Down remain composite-owned, and editing Escape exits before the overlay escape route. None of these drafts or editor objects enter the validated frozen node. Delete the private editor resolver once the canonical editor-control/form contract natively carries full editor semantics.

`BlueEditor.removeLatestHistory(text)` is the narrow retraction helper over pi-tui's private history array: it removes index 0 only on an exact match. The method stays optional on the L1 contract so structural fakes and out-of-tree adapters remain compatible; core's sole real adapter implements it.

`BlueEditor.setSubmitBarrier` shadows pi-tui 0.84.2's private `submitValue` at the adapter instance, after autocomplete handling but before its clear path. The frozen attempt captures raw and paste-expanded buffer identity plus the trimmed native submission value. `commit()` is the only path back into the captured native submit; `cancel()` preserves all editor state. Both settle once. Mutation, a newer attempt, or any barrier replacement aborts the signal and makes later commit return false. `submit()` uses the same path and respects `disableSubmit`. Delete this shadow when the renderer exposes an official pre-clear async submit hook with equivalent stale fencing.

The pi-tui-backed component factory and width pure functions:

- `src/plugin-view.ts` is the internal `BlueView` leaf painter shared by the
  canonical UI compiler and notification summaries. It strips caller
  ANSI/OSC/control bytes, applies semantic tones from the live owner palette,
  caps text/depth, and delegates all width math to `blueComponents`. Canonical
  surface owners provide admission, row budgets, and render-failure containment;
  the retired public-dock component wrapper is not a second renderer path.

- `createImage(options)` wraps pi-tui's Image with a styled-text fallback for terminals without an image protocol; the pure `imageDimensions(data)` probe covers PNG/JPEG/GIF/WebP.
- `BlueEditor.insertText(text)` — atomic insertion at the cursor; the seam the clipboard-image markers use.
- `createFileMentionProvider(basePath, fdPath)` (D31) returns the renderer's combined autocomplete provider (constructed with no commands; structurally identical to `BlueAutocompleteProvider`, so it passes through unwrapped) as the `@`-mention source: fd-backed scoped queries, substring scoring, top-20, quoted values, `applyCompletion` stateless of fd. On the same seam, `EditorAdapter.handleInput` carries the kimi `reopenAutocompleteAfterInput` hook: after any input, text ending in `/` inside an `@` mention re-opens the dropdown (directory drill-down), gated on `isShowingAutocomplete` and calling 0.84.2's private `tryTriggerAutocomplete` through the `getHistory`-style structural cast.
- `createEditor` wires completion through an own-property shadow of the Editor's private `createAutocompleteList`: a `/`-prefixed dropdown gets the wrapping list with the `{12, 32}` slash layout; every other completion keeps the stock `SelectList`.
- `BlueEditor.refreshAutocomplete()` re-queries the active provider without replacing the editor or mutating its buffer. Locale consumers call it only while the dropdown is open so localized slash descriptions refresh in place.
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

The pure, core-private `src/chrome.ts` contains theme-agnostic functions over `string[]` rows. It has no package subpath: core components use it internally, generic renderer-adapter row clamps call `BlueComponents.truncateToWidth`, and the connected-pane top rule travels through the narrow `BlueComponents.topRule` method. This keeps ANSI and terminal-width algorithms behind the sole L0 adapter:

`tests/business-rendering-drift.spec.ts` recursively scans every non-core
package source tree. Imports of core-private renderer helpers, local display-
width implementations, and unreviewed pointer/border/padding assembly fail the
G4 gate; its small counted baseline names the remaining audited presentation
adapters so any addition requires an explicit ownership review.

- `EditorAdapter.render` post-processes the editor into a rounded box (`withSideBorders`/`injectPromptSymbol`, the kimi port: rules stripped and repainted through the live `borderColor` property so host `setBorderColor` recolors the whole frame, `│` bars overlaid only on literal outer spaces, labels never entering scroll indicators). `BlueEditor` exposes `setPromptSymbol('>' | '!' | undefined)` / `setBorderLabel(text)` / `setConnectedAbove(bool)` / `setGhostHint(…)`. When connected above, the adapter renders at the dock's `width - 2` inner budget and restores the shared left gutter, aligning both side borders with the pane above. The editor theme's default border is the neutral `border` token; slash/bash contexts carry the color.
- `framePanel(body, width, opts)` is a transitional editor-frame helper only. Canonical interaction surfaces compile through `ui-compiler.ts`; below `FRAME_DEGENERATE_WIDTH` (8), remaining legacy callers still cut fixed furniture to the viewport.
- `clampRowsToWidth(rows, width, truncate)` (D48) is core's component-level width backstop (fits return untouched). Cross-package renderer adapters map assembled rows through `BlueComponents.truncateToWidth`. `src/frame-clamp.ts` holds the render-exit backstop itself (`clampFrame` + the deduplicating `blue-overflow.log` sink wired into terminal.ts's render wrapper), and `src/width.ts` is the tree's single re-export seam for pi-tui's width utilities (runtime consumers reach them through the components service — no other package names pi-tui).
- `hintRow(parts, paint)` joins key-hint parts with ` · `.
- `topRule(width, {title, titlePaint, hint, hintPaint, paint})` renders the kimi in-border title row `╭ BTW ─ Esc close ────╮` behind `BlueComponents.topRule` — the `─ ` joiner appears only when both a title and a hint are present; the composite clips ANSI-safe (pi-tui's empty-ellipsis truncation appends a closing `\x1b[0m`, a protective reset) and the dash fill takes the remainder.
- `padColumns(lines, n)` is the pure gutter equivalent of kimi's `GutterContainer`.
- `injectGhostHint` splices the dimmed hint after the inverse-video cursor, consuming trailing padding so the row width holds, ellipsizing on overflow, and leaving mid-text cursors untouched (`setGhostHint`'s first consumer).
- `highlightLeadingSlashToken` re-paints the leading `/command` token through visible-index math so ANSI pass-through survives (bold `primary` at the call site).

## Gutter and dock mechanics (D29)

`BlueScreen.addDockChild` is the optional compatibility extension for passive panes; `mountDockChild` selects it when present and falls back to the legacy bottom mount for structural fakes and older adapters. Larger `BlueDockOptions.priority` values receive scarce rows first and render closer to the fixed editor block. `addBottomChild` retains its fixed-slot semantics, with `'bottom'` still pinning the footer tail.

`GutterComponent` (`src/gutter.ts`, exported from the package root — the kimi `GutterContainer` equivalent): the child renders at `max(1, width - 2n)` (the floor keeps degenerate resize-drag viewports from handing children zero or negative widths, D48) and every row gains `n` leading columns through `padColumns`, styling untouched, `invalidate` forwarded; below `2n + 2` columns the padded rows are also cut to the width (the gutter furniture itself no longer fits). It wraps every inset surface at the mount layer — transcript entries, the banner, the four dock panes, and the footer — while the editor, dialogs, and overlays stay full-width.

## WrappingSelectList

`src/wrapping-select-list.ts` is the repo's only pi-tui subclass and now a thin editor-internal state adapter. It reads filtering, selection, height, theme, and layout through one cast pinned by the 0.84.2 spec, converts the filtered entries into a canonical `BlueListNode`, and delegates all row presentation to `renderAutocompleteList` in the private `ui-patterns.ts` path. Pi-tui retains filtering and key handling; the pattern retains the established two-line description, ellipsis, primary-column hook, scroll indicator, and 2..120 width contract.

## Cross-package events

Three events live on the core Events merge:

- `'blue/editor-connected-above'` — the D25-pre-approved splice flag: pane-btw emits, blue-input mirrors it onto the editor.
- `'blue/btw-command'` — editor key chain → pane close/scroll routing.
- `'blue/editor-slot-swapped'` — blue-input emits on its replacement-panel stack's empty↔occupied transitions (nested panels re-emit nothing; unloading with one open releases the occupancy). pane-activity hides while occupied and pane-btw re-asserts its splice on return.

Theme providers also publish a semantic companion through the optional `blueThemeModels` frontend registry. ANSI color functions remain core-only; the companion contains the source palette hexes and is removed with the theme provider Fiber.

`blueNotifications` is the frontend runtime's immutable notification registry; core only hosts its lifecycle, while feature adapters push structured messages and consume snapshots.
Canonical frontend nodes enter core only through `ui-validator.ts` and `ui-compiler.ts`; no `@dsh-blue/blue-frontend` model-specific renderer exists. Width clamping delegates to pi-tui through `width.ts`. Canonical diff leaves render through `diff-align.ts` (prefix/suffix trim + LCS middle, a size guard degrading oversized inputs to whole blocks) with the diff palette tokens, context rendered once, and long unchanged runs elided. Alignments are memoized per frozen diff leaf object.

## Verification note

`theme-custom` accepts a validated `logoGradient` array as a frozen palette override; invalid arrays and entries retain the base gradient.

Shared filesystem fixtures in `tests/temp-dir.ts` are tracked per worker and
must opt into `registerTempDirCleanup()` for eager `afterAll` removal. The
module-level exit hook is the fallback for specs that are interrupted before
their cleanup hook can run.
