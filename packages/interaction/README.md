# `@deepseek-ai/dsh-blue-interaction`

English | [中文](README.zh.md)

Blue terminal UI interaction layer over [`dsh-blue-core`](../../blue/core/README.md): the bottom input editor with slash-command dispatch, the built-in `/quit` and `/resume` commands, the `ctx.userQuestions` overlay provider, and the interactive `approval/request` answerer. The package imports no pi-tui: the main editor is the pi-tui Editor behind `ctx.blueComponents.createEditor` (multi-line, history, kill-ring, undo, and paste markers built in), single-select lists come from `ctx.blueComponents.createSelectList`, and `BlueSelect` survives only as the package-internal multi-select list (pi-tui ships no multi-select). `BluePanel` is the package's sole public component export; overlays resolve keys through `ctx.blueKeymap` and style through `ctx.blueTheme`.

## Plugins

The single entry plugin `blue-interaction` mounts five sub-plugins; every registration is effect-bound, so unloading the fiber reverts every contribution (HMR-safe: the provider/command/key registrations disappear with the fiber).

- **`blue-interaction-keys`** — registers the shared key-action batch (`blue.interaction.submit/cancel/move-up/move-down/toggle`) on `ctx.blueKeymap` as one validated unit. The multi-select `BlueSelect` resolves keys against these actions and generates footer hints with `getKeys`; text-editing keys are owned by the pi-tui Editor itself.
- **`blue-input`** — mounts the focused bottom editor: the pi-tui Editor from `ctx.blueComponents.createEditor`, with the muted hint line as a separate `HintLine` component pinned below. Submit parses the line with `parseCommand`: a slash command dispatches through `ctx.commands.execute` (never reaching the model; success/error text flashes in the hint line), anything else becomes a `createUserMessage({ source: { kind: 'user' } })` follow-up on the current agent — queued by the harness inbox when the agent is running. The `onSubmit` callback argument already carries the paste-expanded, trimmed text. Slash-prefixed input shows up to three matching commands from `ctx.commands.list` as a discovery hint. The mounted editor and its submit router are published through a package-local shared ref so `blue-editor-plus` can layer input modes and autocomplete over the same component.
- **`blue-commands`** — registers `/quit` (requests exit through the launcher-owned `ctx.appExit`; an error result when the launcher provided none) and `/resume <session-id>` (emits `blue/request-resume`; the app layer performs the actual resume).
- **`blue-questions`** — registers the single `ctx.userQuestions` provider. Each question opens a modal overlay: a select list when it carries options (Space toggles in multi-select mode, Enter confirms), a single-line input otherwise (the text becomes the answer's `custom`). Escape rejects with `ASK_DISMISSED`; an aborted request signal closes the overlay and rejects with `ASK_ABORTED`.
- **`blue-approval`** — answers the `approval/request` waterfall for the agent currently attached to the UI: a modal Allow once / Reject overlay (`'allowed-once'` / `'rejected'`; Escape or an aborted signal yields `'cancelled'`). Requests for any other agent, or arriving before a session attaches, delegate with `next()` — returning without `next()` short-circuits the waterfall.

The **`./editor-plus`** subpath plugin (`blue-editor-plus`) is the optional enhancement layer over the shared editor: the entry plugin does not mount it — a host patch opts in by adding the row. It attaches and re-attaches through the `'blue/input-editor-changed'` event, preserving the handlers `blue-input` installed.

- **`!` bash mode** — a buffer holding exactly `!` switches to bash mode without the `!` entering the buffer; the border switches to `colors.shellMode` (the only mode cue — the pi-tui Editor has no prompt-symbol carrier), and every bash submission falls back to prompt mode first. Commands run through the package's own `child_process` executor (combined output capped at 200 lines and 64 KB) and echo into the scroll region as a `ShellEchoComponent` — deliberately not part of the session transcript.
- **Dispatching autocomplete** — one `BlueAutocompleteProvider` serving slash-command completion (prefix match over `ctx.commands.list`) and `@` file completion (`fd` first, an fs scan as fallback, capped at 200 candidates), installed through `BlueEditor.setAutocompleteProvider`.
- **Shared history** — prompt and bash submissions share the pi-tui Editor's internal history; the component exposes no per-mode filtering.

## The `blueSession` contract

The current agent is read with `ctx.get('blueSession')` (never `inject`) because the app plugin may activate after this one. `BlueSessionRef` and the `blue/request-resume` event are owned and declared by `@deepseek-ai/dsh-blue-app`; this package consumes them through type-only imports.

## Model Experience

None, as the interaction layer renders prompts and overlays to the user; the approval and user-question seams own any model-visible effect of the answers collected here.

#### KV Cache effect

None; the package adds nothing to any model request prefix.

## Known Limitations and Deferred Work

- **Bash-mode cue is border color only** — the pi-tui Editor has no prompt-symbol carrier, so bash mode shows only through the `colors.shellMode` border.
- **No per-mode history** — prompt and bash submissions share the pi-tui Editor's internal history; the component exposes no per-mode filtering.
- **Autocomplete scope** — completion covers slash-command names and `@` file paths; argument completion is deferred.
- **No Esc-to-cancel-agent** — Escape dismisses overlays but does not cancel a running agent; that binding is deferred.
