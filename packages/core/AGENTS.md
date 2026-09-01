# `@dsh-blue/blue-core`

Repo-wide rules live in the root [AGENTS.md](../../AGENTS.md). This package is
the only L0 renderer adapter in the tree.

## Boundary

Only core may import `@earendil-works/pi-tui` or own raw terminal state, ANSI,
focus, layout, image transport, and visible-width truth. Public node
construction belongs to `@dsh-blue/blue-ui`; core is the sole validator and
compiler from canonical nodes to pi-tui components. `src/types.ts` exposes
pi-tui-independent L1 contracts so renderer changes do not propagate outward.

The main services are:

| Owner | Contract |
| --- | --- |
| `blueScreen` | Terminal lifecycle, mounted children/overlays, repaint, title, suspend/resume, frame output |
| `blueKeymap` | One global dispatcher with priority, owner scope, modal context, and chord labels |
| `blueTerminalInfo` | Terminal facts used by theme/runtime selection |
| `blueComponents` | Width helpers, canonical node admission/compile, shared chrome primitives |
| `blueTheme` | Semantic colors/markdown style supplied by one of six theme subpath plugins |

No other package may receive a pi-tui object through these services.

Core also owns the only rich-content adapters: `beautiful-mermaid` augments
streamed pi-tui Markdown and explicit Mermaid documents, while
`simple-ascii-chart` renders canonical chart nodes. Both are synchronous,
width-contained adapters with source/text fallbacks; their option types must
not cross the core boundary.

## Ownership

`src/terminal.ts` owns raw-mode setup/restoration, alternate screen, bracketed
paste, resize, suspend/resume, shutdown, and final frame clamp. Cleanup must be
idempotent across normal exit, partial startup, signal, plugin unload, and
render failure. The clamp logs overflow and prevents terminal corruption; it
does not make an over-wide component correct.

`blueKeymap` is the only global key routing path. Registrations are
Fiber-disposable, ordered by priority, and scoped by owner/modal state. A
component must not install an independent raw-key listener. Suspend captures
terminal/screen state, restores the terminal before the child process, then
reattaches and repaints without duplicating listeners or children.

Canonical plugin panes/overlays enter through the core surface bridge. Core
owns placement, narrow degradation, allocation, focus/event routing, gesture
minting, compile/runtime fallback, revision refresh, and owner unload. Pane
definitions may survive an owner gap in the API host; open overlay instances
do not. A capturing overlay consumes a live one-shot gesture and closes through
the composition-private semantic close path.

Each registered public surface owns one private `BlueUiSurfaceRuntime` and a
stable wrapper. Internal event settlement recompiles while preserving semantic
focus, editor/cursor, draft, and confirmation state; an external host snapshot
accepts canonical values and clears local value drafts while retaining
compatible focus/editor identity. Focus keys come from canonical ids rather
than compiler paths, so legal reorder is stable. Replacement or unload
retargets renderer focus only when it still points at the retired target, then
disposes callbacks and makes every old compiled generation inert.

## Change Rules

- `BlueComponent.render(width)` must emit only rows whose visible width is at
  most `width`. Width, wrapping, truncation, and ANSI-aware measurement come
  from `src/width.ts`/pi-tui. Do not add codepoint approximations.
- `blueComponents` is the cross-package width/compiler seam. Core-private
  chrome stays private; expose only a narrow operation when another renderer
  adapter genuinely needs it.
- Canonical compiler input is hostile public data. Admission enforces closed
  node kinds, depth/count/text/action quotas, plain-record constraints, and
  allowed status/editor subsets before constructing renderer objects. Failure
  produces bounded canonical fallback content.
- Stateful surface compilation keeps navigation separate from editing. Focus
  descends through outer tabs, nested tabs, content groups, then editing. A tab
  strip uses non-wrapping Left/Right, Enter descends, and Tab is inert; content
  uses Tab/Shift-Tab for semantic groups and non-wrapping directional movement.
  Escape climbs one layer at a time before dismissal. Enter or a valid Tab
  confirms text/select editing, invalid fields stay active, and Escape rolls a
  select draft back. Failed compile is transactional and cannot mutate the
  last committed runtime.
- Focused interactive surfaces may render one core-owned contextual key-hint
  row derived from visible canonical roles and current edit/confirmation
  state. Complex official controllers may merge or suppress semantic
  operations by id. Passive/status/editor-shell compilation and stale
  generations never expose it; narrow widths drop whole hint fragments.
- Dock allocation is deterministic. Fixed footer/editor furniture and public
  pane placement remain separate from transcript's package-private bottom-pane
  registry. Child registration/unload must invalidate allocation without
  leaking focus or listeners.
- Theme plugins are `./theme-dark`, `./theme-light`, `./theme-auto`,
  `./theme-custom`, `./theme-ocean`, and `./theme-paper`. Keep semantic token
  parity and single active provider behavior. Theme changes invalidate
  renderer caches without changing domain/frontend models.
- Runtime entries are derived from package exports. Add or remove a subpath by
  changing the manifest export, matching source/types target, files whitelist,
  tests, and bundle row where applicable.

## Verification

Every core source edit runs the owning package tests and width scan through
`pnpm run verify:changed`. Terminal lifecycle, compiler/admission, surface
bridge, keymap, theme, export, or composition changes also require
`pnpm run verify:full`, bundle e2e, `pnpm run check:lib`, and
`pnpm run smoke:happy`.

Add content renderers to `tests/width-scan.spec.ts` using the shared
`ADVERSARIAL`/`SCAN_WIDTHS` corpus. Terminal changes need FakeTerminal tests for
partial failure and cleanup plus a real pseudo-TTY path; raw-mode, alternate
screen, bracketed paste, title, resize, suspend, and exit restoration are not
proven by source-plane assertions alone.
