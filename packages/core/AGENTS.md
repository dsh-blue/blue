# `@dsh-blue/blue-core`

Core is the only package allowed to import pi-tui or own ANSI, raw mode,
terminal probing, alternate-screen lifecycle, focus, key dispatch, concrete
layout, or visible-width truth.

It provides `blueScreen`, `blueKeymap`, `blueTerminalInfo`, and
`blueComponents`, while theme subpaths provide `blueTheme`. The direct
surface renderer subscribes to `bluePanes` and `blueOverlays`; it compiles
their current definitions without a host bridge or private facade.

Public node admission clones known fields, strips terminal controls, enforces
depth/node/text/collection budgets, and never mutates caller data. Status
nodes remain non-interactive. Editor shell validation remains separate because
the Blue-owned editor control is not an external node kind.

Capturing overlays receive focus directly. Unless `dismissible: false`, Escape
closes them and restores prior focus. Non-capturing overlays must contain no
interactive control.

Every renderer component must obey `render(width)`. New or changed content
renderers go into the owning width scan and use core width helpers. Terminal
startup, shutdown, focus, renderer registry, compiler, or validator changes
require focused adversarial tests, the full core suite, bundle e2e,
`pnpm run verify:full`, and a real PTY acceptance.

Do not add service adapters, capability admission, provider owners, or pi-tui
imports outside this package.
