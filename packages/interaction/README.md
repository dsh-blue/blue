# `@deepseek-ai/dsh-blue-interaction`

English | [中文](README.zh.md)

Blue terminal UI interaction layer over [`dsh-blue-core`](../../blue/core/README.md): the bottom input editor with slash-command dispatch, the built-in `/quit` and `/resume` commands, the `ctx.userQuestions` overlay provider, and the interactive `approval/request` answerer. The package imports no pi-tui; its components (`BlueInput`, `BlueSelect`, `BluePanel`) are self-contained implementations of the L1 `BlueComponent`/`BlueFocusable` contracts, resolving keys through `ctx.blueKeymap` and styling through `ctx.blueTheme`.

## Plugins

The single entry plugin `blue-interaction` mounts five sub-plugins; every registration is effect-bound, so unloading the fiber reverts every contribution (HMR-safe: the provider/command/key registrations disappear with the fiber).

- **`blue-interaction-keys`** — registers the shared key-action batch (`blue.interaction.submit/cancel/cursor-left/cursor-right/delete-backward/move-up/move-down/toggle`) on `ctx.blueKeymap` as one validated unit. All interactive components resolve keys against these actions and generate footer hints with `getKeys`.
- **`blue-input`** — mounts the focused bottom editor. Submit parses the line with `parseCommand`: a slash command dispatches through `ctx.commands.execute` (never reaching the model; success/error text flashes in the hint line), anything else becomes a `createUserMessage({ source: { kind: 'user' } })` follow-up on the current agent — queued by the harness inbox when the agent is running. Slash-prefixed input shows up to three matching commands from `ctx.commands.list` as a discovery hint.
- **`blue-commands`** — registers `/quit` (requests exit through the launcher-owned `ctx.appExit`; an error result when the launcher provided none) and `/resume <session-id>` (emits `blue/request-resume`; the app layer performs the actual resume).
- **`blue-questions`** — registers the single `ctx.userQuestions` provider. Each question opens a modal overlay: a select list when it carries options (Space toggles in multi-select mode, Enter confirms), a single-line input otherwise (the text becomes the answer's `custom`). Escape rejects with `ASK_DISMISSED`; an aborted request signal closes the overlay and rejects with `ASK_ABORTED`.
- **`blue-approval`** — answers the `approval/request` waterfall for the agent currently attached to the UI: a modal Allow once / Reject overlay (`'allowed-once'` / `'rejected'`; Escape or an aborted signal yields `'cancelled'`). Requests for any other agent, or arriving before a session attaches, delegate with `next()` — returning without `next()` short-circuits the waterfall.

## The `blueSession` contract

The current agent is read with `ctx.get('blueSession')` (never `inject`) because the app plugin may activate after this one. `BlueSessionRef` and the `blue/request-resume` event are owned and declared by `@deepseek-ai/dsh-blue-app`; this package consumes them through type-only imports.

## Model Experience

None, as the interaction layer renders prompts and overlays to the user; the approval and user-question seams own any model-visible effect of the answers collected here.

#### KV Cache effect

None; the package adds nothing to any model request prefix.

## Known Limitations and Deferred Work

- **MVP editor** — `BlueInput` supports insert/backspace/cursor movement/submit and single-chunk bracketed paste; kill-ring, undo, word movement, and multi-line editing are deferred. Wide glyphs count as one column in width math.
- **Slash hint only** — input shows a matching-commands hint for `/` prefixes; full autocomplete (selection popup, argument completion) is deferred.
- **No Esc-to-cancel-agent** — Escape dismisses overlays but does not cancel a running agent; that binding is deferred.
