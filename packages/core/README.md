# `@deepseek-ai/dsh-blue-core`

English | [中文](README.zh.md)

Blue terminal UI core: the only package in the tree that imports `@earendil-works/pi-tui`. Loading the plugin starts the terminal (a main-screen `TuiMainScreen` renderer over `ProcessTerminal`: raw mode, bracketed paste, Kitty keyboard negotiation) and registers the three L1 services; unloading the plugin stops the terminal and restores its state. The package imports no harness package — only pi-tui and Cordis.

## L1 services

The L1 contracts in `src/types.ts` are self-owned narrow interfaces: no pi-tui type, harness business type, or concrete renderer class appears in them; L0 (`src/terminal.ts`) delegates to pi-tui internally.

- `ctx.blueScreen` (`BlueScreen`) — component mounting. `addChild` returns a disposer, `showOverlay` returns a focus/unfocus handle, `setFocus` owns the single focus slot, `requestRender` schedules throttled redraws, `columns` reports the terminal width. `BlueComponent` is structurally compatible with pi-tui's `Component` but type-independent.
- `ctx.blueTheme` (`BlueTheme`) — the semantic color table. Every value is a `(text: string) => string` ANSI wrapper; the MVP ships one frozen built-in dark palette.
- `ctx.blueKeymap` (`BlueKeymap`) — the keybinding registry. `register(actions)` validates the batch (duplicate ids, keys already claimed by another action) before committing and returns a disposer; `matches(data, action)` tests an input sequence; `getKeys(action)` resolves bound keys.

All three are Cordis `Service` subclasses mounted by the plugin's `apply`; each unregisters automatically when the plugin's fiber unloads. Components consume the interfaces, never pi-tui types.

## Terminal lifecycle

`createTerminalRelease()` returns the `release` function for `installFailLoud(binName, proc, release)` from `@deepseek-ai/dsh-app-boot`: on a fatal load failure it stops the active terminal stack (draining pending input first) so raw mode and bracketed paste are restored before the process exits. It is a no-op when no Blue terminal is active. Services delegate through a stable proxy reference so a future renderer swap (main/alt screen) needs no consumer change.

## Model Experience

None, as the terminal UI core renders to the user and registers nothing model-facing.

#### KV Cache effect

None; the package adds nothing to any model request prefix.

## Known Limitations and Deferred Work

- **Crash-log directory is pi's default** — `TuiMainScreen` writes its width-overflow crash log to `~/.pi/agent` (or `PI_CODING_AGENT_DIR`) because pi-tui hardcodes that default and Blue has no dsh-owned path to thread through yet; a dsh-side log directory is deferred to the alt-screen phase.
- **Main-screen renderer only** — the alternate-screen viewport and runtime renderer swap are deferred; the stable proxy reference is the only seam in place.
- **Keymap conflict scope** — conflict detection covers actions registered through `ctx.blueKeymap`; pi-tui components (Editor, SelectList) resolve their own bindings from pi-tui's global keybindings table, which this package leaves untouched.
- **No theme switching** — the dark palette is built in and frozen; theme files, OSC 11 detection, and provider replacement are deferred.
