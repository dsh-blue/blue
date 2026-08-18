# `@deepseek-ai/dsh-blue-transcript`

English | [中文](README.zh.md)

Blue terminal UI transcript layer over `dsh-blue-core`: a pure fold from session events to transcript items (user/assistant/tool), the components that render them, and the Cordis plugin mounting them on `blueScreen`. The package imports no pi-tui — every component is a self-contained `BlueComponent` returning styled ANSI lines.

## The fold

`src/fold.ts` is a pure, UI-free pipeline. `TranscriptFolder.apply(event)` folds one `SessionEvent` (from `@deepseek-ai/dsh-session`, type-only) and reports the created or mutated `TranscriptItem`; `foldSessionEvents(events)` is the one-shot form.

- `user/message` → user item (text blocks joined, images as `[image]`).
- `assistant/chunk` text/reasoning deltas accumulate into one streaming assistant item per step; the closing `assistant/message` rewrites the item from the authoritative assembled message.
- `tool/call` + `tool/result` pair by `callId` into one tool item: generic presentation with ellipsized arguments and a one-line result summary (a string `meta` presentation payload wins over the model-facing result text). An unpaired result still renders.
- Turn/step boundaries, request records, log-only markers, and merge-extended unknown types render nothing.

## Components and mounting

`src/components.ts` implements `BlueComponent` directly: `UserMessageComponent` (accent `❯` gutter), `AssistantMessageComponent` (minimal Markdown via `src/markdown.ts`, reasoning muted italic, streaming `▌` cursor, cached by text + width), `ToolCallComponent` (`○`/`●` state bullet plus an indented `⎿` summary), and the fixed single-line `StatusBarComponent` (model + agent status). Text measurement and wrapping live in `src/width.ts` (CJK wide cells, style-aware wrapping).

The plugin (`name: 'blue-transcript'`, `inject: ['blueScreen', 'blueTheme']`) mounts on `'blue/session-changed'` — emitted by `dsh-blue-app` after create/resume — or from `blueSession.current` when an agent already exists. It folds the `agent.session.events` snapshot first (resume seeds never replay `session/event`), then subscribes to the live feed and drops events at or below the snapshot's last seq; every applied event ends in `blueScreen.requestRender()`. Remounting on the next session change, and unloading the plugin, unmounts every component.

## Model Experience

None, as the transcript renders already-logged session events to the terminal and registers nothing model-facing.

#### KV Cache effect

None; the package adds nothing to any model request prefix.

## Known Limitations and Deferred Work

- **Width helpers are a pi-tui stand-in** — `src/width.ts` is exact for ASCII and CJK wide cells but approximate for emoji clusters and combining marks (no RGI/spacing-mark tables); when `dsh-blue-core` grows a component factory, these helpers should be replaced by it.
- **Markdown subset** — `src/markdown.ts` covers headings, fenced code, lists, quotes, rules, and inline code/bold/links; tables, nested constructs, and streaming-aware transforms are deferred.
- **Status bar has no extension seam** — the single model + status line is fixed; a `blueStatus` service waits for its first real consumer. The status line refreshes on session events rather than `agent/status`, so a status flip displays at the next session event.
