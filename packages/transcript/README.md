# `@deepseek-ai/dsh-blue-transcript`

English | [中文](README.zh.md)

Blue terminal UI transcript layer over `dsh-blue-core`: a pure fold from session events to transcript items (user/assistant/tool), the components that render them, and the Cordis plugin mounting them on `blueScreen`. The package imports no pi-tui — components either return styled ANSI lines directly or delegate to the `blueComponents` factory.

## The fold

`src/fold.ts` is a pure, UI-free pipeline. `TranscriptFolder.apply(event)` folds one `SessionEvent` (from `@deepseek-ai/dsh-session`, type-only) and reports the created or mutated `TranscriptItem`; `foldSessionEvents(events)` is the one-shot form.

- `user/message` → user item (text blocks joined, images as `[image]`).
- `assistant/chunk` text/reasoning deltas accumulate into one streaming assistant item per step; the closing `assistant/message` rewrites the item from the authoritative assembled message.
- `tool/call` + `tool/result` pair by `callId` into one tool item: generic presentation with ellipsized arguments and a one-line result summary (a string `meta` presentation payload wins over the model-facing result text); the fold also keeps the unsummarized result text as `fullText` for expansion. An unpaired result still renders.
- Turn/step boundaries, request records, log-only markers, and merge-extended unknown types render nothing.

## Components and mounting

`src/components.ts` implements `BlueComponent`: `UserMessageComponent` (accent `❯` gutter), `AssistantMessageComponent` (Markdown delegated to `blueComponents.createMarkdown` — pi-tui's Markdown with `setText` caching; reasoning muted italic; streaming `▌` cursor), `ToolCallComponent` (`○`/`●` state bullet plus an indented `⎿` summary; `setExpanded` switches it between the summary and the unsummarized `fullText`), and the fixed single-line `StatusBarComponent` (model + agent status). Text measurement, wrapping, and truncation come from the `blueComponents` pure functions (`visibleWidth` / `wrapText` / `truncateToWidth`); `ellipsize` lives in `src/fold.ts` and is re-exported from the package root.

The plugin (`name: 'blue-transcript'`, `inject: ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap']`) mounts on `'blue/session-changed'` — emitted by `dsh-blue-app` after create/resume — or from `blueSession.current` when an agent already exists. It folds the `agent.session.events` snapshot first (resume seeds never replay `session/event`), then subscribes to the live feed and drops events at or below the snapshot's last seq; every applied event ends in `blueScreen.requestRender()`. Remounting on the next session change, and unloading the plugin, unmounts every component. It also registers the global key action `blue.transcript.toggle-collapse` (Ctrl-O, handler-carrying, consumed by core's dispatcher ahead of focus routing) which toggles every tool-call component between the one-line summary and its `fullText`; the collapse state resets on each session change.

## Model Experience

None, as the transcript renders already-logged session events to the terminal and registers nothing model-facing.

#### KV Cache effect

None; the package adds nothing to any model request prefix.

## Known Limitations and Deferred Work

- **Width and Markdown are pi-tui's** — measurement/wrapping go through `blueComponents` and Markdown through its `createMarkdown`; pi-tui's own accuracy limits (e.g. emoji cluster width) apply, and streaming-aware Markdown transforms are deferred.
- **Status bar has no extension seam** — the single model + status line is fixed; a `blueStatus` service waits for its first real consumer. The status line refreshes on session events rather than `agent/status`, so a status flip displays at the next session event.
