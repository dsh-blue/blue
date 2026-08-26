# `@dsh-blue/blue-transcript`

English | [中文](README.zh.md)

Blue's terminal renderer for projection-backed transcript, status, tool, and dock models. This is the renderer adapter: Harness domain state is projected before it reaches this package, and only `@dsh-blue/blue-core` crosses into pi-tui.

## Transcript

The `./official-model` plugin consumes whole `blueConversation` values through app-owned `blueSessionProjections`. It maps user, assistant, thinking, tool, error, interruption, image, and retraction facts into stable renderer-neutral entries, resolving official tool presentations outside the domain projection. Stale, malformed, foreign-session, and late values are ignored.

`TranscriptModelService` reconciles semantic components by stable id, bounds each model to the newest 200 entries, caches stable completed frames, applies the configured turn window, forwards Ctrl-O expansion to the most recent configured turns, and disposes timers when entries retire. User-message fold thresholds, thinking/tool defaults, turn windows, and expansion range live in a frontend-tree-scoped presentation policy, so theme/provider reloads preserve settings without leaking them between trees.

The active runtime does not fold Harness session events and contains no legacy tool-intent registry. Generic, terminal, diff, search, read, and web tool shapes arrive through canonical projection/presentation models while retaining the shared status, argument, command, and expansion chrome. The BTW pane and connected editor share aligned side borders without a spacer row.

## Status And Dock

The main plugin owns four renderer bridges:

- `BlueStatusModelService` renders readonly `StatusModel` contributions in the two-band footer.
- `BlueDockModelService` orders bounded dock contributions by placement, priority, and id.
- `BlueModelToolService` converts official tool presentation facts into readonly frontend views.
- `TranscriptModelService` renders the official semantic conversation model.

Footer subplugins provide model, cwd, git, title, context, and session-mode facts. Activity, todo, and agents panes consume the `blueConversationFacts` projection through `blueSessionFacts`; the BTW pane obtains a disposable side session through `blueSessionActions` and renders its official conversation projection. No pane receives an Agent or Session.

`./plugin-host-bridge` is the owner adapter for third-party renderer-neutral dock and status contributions. Every registration, subscription, timer, and screen child is Fiber-bound and removed on unload.

## Other Subpaths

`./banner` mounts the welcome banner. `./status-basic-model`, `./status-cwd`, `./status-title`, `./status-git`, and `./status-context` publish footer models. `./pane-activity`, `./pane-todo`, `./pane-btw`, and `./pane-agents` publish dock models. `./dock-model`, `./tool-model`, and `./transcript-model` expose the renderer-neutral registries for composition.

All rendered rows obey the core visible-width contract, including narrow and CJK viewports.

## Model Experience

None. The package renders existing projection values and adds no prompt or request prefix.
