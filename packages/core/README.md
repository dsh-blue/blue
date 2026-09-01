# `@dsh-blue/blue-core`

English | [中文](README.zh.md)

Blue's terminal renderer and the repository's only pi-tui adapter. It owns
terminal startup/shutdown, raw mode, alternate screen, focus, keyboard
dispatch, layout, themes, node validation/compilation, and visible width.

Core subscribes directly to `ctx.bluePanes` and `ctx.blueOverlays`.
Pane/overlay render functions return renderer-neutral `BlueUiNode` values;
core validates and compiles them into concrete components. There is no plugin
host or bridge between the registry and renderer.

The package also exposes low-level `blueScreen`, `blueKeymap`,
`blueTerminalInfo`, `blueComponents`, and theme services for Blue's own TUI
packages.
