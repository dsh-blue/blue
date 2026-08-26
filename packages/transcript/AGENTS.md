# `@dsh-blue/blue-transcript` - Agent Notes

Implementation detail for this package. Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Runtime Boundary

This package is the renderer adapter over `@dsh-blue/blue-frontend` models. It may depend on `blue-core`, but it must not expose pi-tui objects through frontend models and must not fold Harness event streams. App-owned `blueSessionReader`, `blueSessionProjections`, and `blueSessionActions` are the only current-session boundaries.

`src/index.ts` creates `SessionFactsService`, `BlueStatusModelService`, `BlueDockModelService`, `BlueModelToolService`, and `TranscriptModelService` once per parent transcript Fiber. Each service and screen contribution has an effect-bound disposer. Theme reloads rebuild renderer objects; no mutable presentation state is stored in a module singleton.

## Official Conversation Consumer

`src/official-model.ts` injects the effect-scoped `blueConversationProjection` readiness capability before reading `blueConversation`. It snapshots and subscribes through `blueSessionProjections`, rejects wrong keys/sessions and non-increasing sequence values, maps at most the newest `TRANSCRIPT_MODEL_WINDOW` entries by stable id, and drops late work after unload. Tool presentation is resolved through the official `tools` service outside the domain projection.

Consecutive reads group at this projection-consumer layer: a run of transcript-channel tool entries that present as reads (presenter vocabulary — a pending `kind: 'read'` call view or a settled read result card — never a name check) folds into one `transcript-read-group` entry with per-call facts (argument window, actual range, totals, state, and preview lines bounded by `READ_PREVIEW_LINE_LIMIT`). Thinking entries are transparent to a run; user/assistant/error/interrupted content, non-read tools, and turn changes break it; invisible todo/agents channels neither join nor break. A single read still groups — the transcript never prints read file content; `ReadGroupComponent` renders the by-file tree (files in first-read order, a multi-window file nests its windows, a single-window file inlines) with the tools-category Ctrl-O expansion. `src/read-group.ts` is the sanctioned re-entry of the retired legacy read-group module's behavior under the new architecture (projection + frontend model + renderer adapter + bundle fixtures), not a compatibility shortcut. `src/envelope.ts` parses the file tools' model-facing XML envelopes conservatively and collapses recognized ones to a one-line summary in presenter-less fallbacks; non-envelopes pass through untouched and expanded cards keep the raw text as the debug view.

`src/session-facts.ts` reads `blueConversationFacts` for status and dock producers. It tracks the current reader epoch, current-session projection, title, and direct child projections. Session changes clear child state before notifying consumers; stale or late projection callbacks cannot repopulate a retired epoch.

## Presentation Policy

`TranscriptPresentationPolicy` is allocated by `apply()` and passed into the semantic renderer. It owns thinking/tool initial expansion, completed-turn visibility, recent-turn Ctrl-O scope, user-message fold thresholds, and the retained recent-step setting value. Settings updates mutate only this tree's policy and invalidate mounted semantic components. Standalone services use the immutable shipped defaults.

`TranscriptModelComponent` first caps entries to `TRANSCRIPT_MODEL_WINDOW = 200`, then filters semantic entries to the newest `windowTurns`. Ctrl-O applies only to the newest `expandTurns`; older cards use their category default. Reconciliation replaces components only when an entry signature changes and disposes timers/resources on replacement, eviction, unregister, reattach, or service disposal. A stable model identity, including a streaming model, reuses its aggregate rendered-row array for the same width, expansion state, and policy snapshot; projection changes replace the immutable model identity, while thinking ticks, invalidation, image readiness, policy refresh, resize, expansion, and disposal clear the aggregate cache.

## Components And Width

User, assistant, thinking, tool, error, and interruption models reuse the package components. The interruption tombstone is the text-presentation `■ interrupted` row in the theme error color, without an emoji marker. Image bytes remain renderer-owned and late-bound through the attachment store. Every assembled row must fit the width passed to `render(width)`; use `blueComponents` width helpers or `@dsh-blue/blue-core/chrome`, never local codepoint counting. Add every content renderer to `tests/width-scan.spec.ts`.

## Status Models

`BlueStatusModelService` owns the two-band footer registry. Models order by priority then id and are rendered through `StatusModelFooterComponent`; refresh is explicit and registrations are idempotently disposable. The shipped producers are:

- `status-basic-model`: current model from app/facts.
- `status-cwd`: abbreviated current cwd.
- `status-git`: TTL-cached repository badge; command runner and clock are explicit test seams.
- `status-title`: projected current title.
- `status-context`: context occupancy from conversation facts.

`plugin-host-bridge.ts` maps public API status views into this registry and owns the corresponding disposers. It does not restore the deleted `BlueStatusEntry` service.

## Dock Models

Activity, todo, and agents consume `blueSessionFacts`. Activity derives its phase from projection facts and owns only its presentation timer. Todo renders the projected whole list and keeps only its local expanded/collapsed view state. Agents renders projected spawn-class facts plus bounded direct-child overlays; no child Session or event subscription enters the renderer.

BTW calls `blueSessionActions.createSideSession()`, holds the returned owned handle for one pane lifetime, reads its official `blueConversation` projection through the opaque identity, and disposes the handle on close/unload. Its dock renderer has no trailing spacer: the gutter-wrapped pane side borders meet the connected editor's `├┤` row directly. Parent seeding and Agent status filtering remain in app.

## Tool And Plugin Models

`BlueModelToolService` converts official generic/terminal/diff/search/read/web presentation facts into readonly frontend views and never reads session events. The semantic transcript renderer keeps `ToolCallComponent` as the status/header/key-argument/shell chrome and nests the official view as its bounded body; tools without a presenter retain the generic rich fallback instead of receiving a synthetic name-only view. There is no `blueIntents` registry and no intent subpath export.

`plugin-host-bridge.ts` is the only route from public plugin dock/status models into owner registries. Reordering replaces the mounted public dock block atomically; unload runs every screen/status disposer.

## Package Surface

Subpath exports, `files`, and `tsdown.config.ts` entries move together. The deleted legacy status, intent, fold, child-event, phase, and read-group modules must not be reintroduced as compatibility shortcuts. New behavior enters as projection/action + frontend model + renderer adapter + bundle row/fixture evidence.
