# `@dsh-blue/blue-transcript`

English | [中文](README.zh.md)

Blue's terminal renderer for projection-backed transcript and canonical status, tool, and bottom-pane nodes. This is the renderer adapter: Harness domain state is projected before it reaches this package, and only `@dsh-blue/blue-core` crosses into pi-tui.

## Transcript

The `./official-model` plugin consumes whole `blueConversation` values through app-owned `blueSessionProjections`. It maps user, assistant, thinking, tool, error, interruption, image, and retraction facts into stable renderer-neutral entries, resolving official tool presentations outside the domain projection. Stale, malformed, foreign-session, and late values are ignored.

`TranscriptModelService` reconciles semantic components by stable id, bounds each model to the newest 200 entries, caches stable completed frames, applies the configured turn window, forwards Ctrl-O expansion to the most recent configured turns, and disposes timers when entries retire. User-message fold thresholds, thinking/tool defaults, turn windows, and expansion range live in a frontend-tree-scoped presentation policy, so theme/provider reloads preserve settings without leaking them between trees.

The active runtime does not fold Harness session events and contains no legacy tool-intent registry. Generic, terminal, diff, search, read, and web tool shapes arrive through canonical projection/presentation models while retaining the shared status, argument, command, and expansion chrome. The BTW pane and connected editor share aligned side borders without a spacer row.

## Status And Bottom Panes

The main plugin owns five renderer bridges:

- The package-private `BlueStatusEntryService` collects canonical `BlueStatusNode` contributions for the built-in two-band footer.
- `BlueStatusCompositionService` renders either that `blue.default` footer or one user-selected status-provider candidate.
- The package-private `BlueBottomPaneService` orders bounded Blue-owned bottom panes by priority and id; it has no left/right lanes.
- `BlueModelToolService` converts official tool presentation facts into readonly frontend views.
- `TranscriptModelService` renders the official semantic conversation model.

Footer subplugins provide model, cwd, git, title, context, and session-mode facts as canonical status nodes. Activity, todo, and agents panes consume the `blueConversationFacts` projection through `blueSessionFacts`; the BTW pane obtains a disposable side session through `blueSessionActions` and renders its official conversation projection. Advanced activity, todo, agents, BTW, and queue chrome remains behind width-bounded renderer adapters until the canonical vocabulary can express it exactly. No pane receives an Agent or Session.

`./status-provider-owner` advertises `status.provider` and follows the persisted `blue.statusProvider` id. Candidates remain inert until selected. The selected callback receives only a frozen public session snapshot, sanitized visible additive entries, and a busy flag; Blue compiles and dry-renders it at the footer's actual width before activation. Invalid, empty, over-three-row, or failing output cannot replace a working same-session provider. A first-activation failure or session switch uses `blue.default`, and three failures in a rolling 60 seconds open a timer-free breaker. Blue never rewrites a missing or failing desired id.

`./plugin-host-bridge` is the owner adapter for third-party renderer-neutral dock and status contributions. It advertises those capabilities only while its Fiber is active; a replacement bridge restores retained public contributions from the host snapshot. Every registration, subscription, timer, and screen child is Fiber-bound and removed on unload.

## Other Subpaths

`./banner` mounts the welcome banner; `./banner-content` exports the displayed `BLUE_VERSION` constant, kept in lockstep with `package.json`. `./status-basic-model`, `./status-cwd`, `./status-title`, `./status-git`, and `./status-context` publish canonical footer nodes; `./status-provider-owner` owns exclusive provider selection. `./pane-activity`, `./pane-todo`, `./pane-btw`, and `./pane-agents` publish canonical bottom-pane nodes. `./tool-model` and `./transcript-model` expose renderer-neutral registries for composition; the bottom-pane service is intentionally not exported as a subpath.

All rendered rows obey the core visible-width contract, including narrow and CJK viewports.

## Model Experience

None. The package renders existing projection values and adds no prompt or request prefix.
