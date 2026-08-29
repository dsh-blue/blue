# `@dsh-blue/blue-transcript` - Agent Notes

Implementation detail for this package. Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Runtime Boundary

This package is the renderer adapter over `@dsh-blue/blue-frontend` models. It may depend on `blue-core`, but it must not expose pi-tui objects through frontend models and must not fold Harness event streams. App-owned `blueSessionReader`, `blueSessionProjections`, and `blueSessionActions` are the only current-session boundaries.

Transcript-owned locale catalogs are registered per contributing Fiber. Banner, activity, long-message fold, image/interruption chrome, and the transcript expansion key description read dynamic translators; user/assistant/tool content, paths, ids, and upstream errors are never translated. A locale revision invalidates mounted transcript renderer caches and reprojects the keymap description while preserving component/model identity; provider gaps fall back to English source keys. Catalog registrations and subscriptions unload with their frontend-tree Fibers.

`src/index.ts` creates `SessionFactsService`, the package-private
`BlueStatusEntryService`, tree-scoped `BlueStatusCompositionService`,
`BlueBottomPaneService`, `BlueModelToolService`, and
`TranscriptModelService` once per parent transcript Fiber. Each service and
screen contribution has an effect-bound disposer. Theme reloads rebuild
renderer objects; no mutable presentation state is stored in a module
singleton.

## Official Conversation Consumer

`src/official-model.ts` injects the effect-scoped `blueConversationProjection` readiness capability before reading `blueConversation`. It snapshots and subscribes through `blueSessionProjections`, rejects wrong keys/sessions and non-increasing sequence values, maps at most the newest `TRANSCRIPT_MODEL_WINDOW` entries by stable id, and drops late work after unload. Tool presentation is resolved through `blueToolPresentations` (blue-app's agent-scoped presenter seam) outside the domain projection — the plain global `tools.get(name)` view misses the Harness's agent-scoped builtin registrations, which the D58 dogfood exposed when no presenter view resolved on a real profile.

Reads and searches group at this projection-consumer layer (one family per run — a read run and a search run never merge; a tool of the other family between them splits both): a run of transcript-channel tool entries that present as reads (presenter vocabulary — a pending `kind: 'read'` call view or a settled read result card — never a name check) folds into one `transcript-read-group` entry with per-call facts (argument window, actual range, totals, state, and preview lines bounded by `READ_PREVIEW_LINE_LIMIT`). Thinking entries are transparent to a run; user/assistant/error/interrupted content, non-read tools, and turn changes break it; invisible todo/agents channels neither join nor break. A single read still groups — the transcript never prints read file content; `ReadGroupComponent` renders the by-file tree (files in first-read order, a multi-window file nests its windows, a single-window file inlines) with the tools-category Ctrl-O expansion. `src/read-group.ts` is the sanctioned re-entry of the retired legacy read-group module's behavior under the new architecture (projection + frontend model + renderer adapter + bundle fixtures), not a compatibility shortcut. Consecutive grep/glob calls (presenter vocabulary: a pending `kind: 'search'` call or a settled search card, its `shape` separating content matches from path lists) fold into a `transcript-search-group` — pattern rows carry file/match/path counts (capped searches say `kept of total`), never match text; Ctrl-O nests file rows with bounded match previews (`SEARCH_PREVIEW_MATCH_LIMIT`) and the capped path page (`SEARCH_PATH_LIMIT`). The registry-facing search result view compacts to counts for the same reason the read view does. Read-kind calls without a file (the jobs reader declares `kind: 'read'` too) still join read runs; their row falls back to the salient argument label so the member stays visible, and the jobs reader's incremental `[status: ...]` trailer summarizes to `+N lines · status X`. `src/envelope.ts` recognizes the three raw shapes a presenter-less result can carry — the file tools' XML envelopes, the jobs reader's incremental `[status: ...]` trailer, and whole-text JSON objects/arrays (the ask-user reader's answers payload) — and collapses each to a one-line summary in presenter-less fallbacks; everything else passes through untouched and expanded cards keep the raw text as the debug view.

`src/session-facts.ts` reads `blueConversationFacts` for status and bottom-pane producers. It tracks the current reader epoch, current-session projection, title, and direct child projections. Session changes clear child state before notifying consumers; stale or late projection callbacks cannot repopulate a retired epoch.

## Presentation Policy

`TranscriptPresentationPolicy` is allocated by `apply()` and passed into the semantic renderer. It owns thinking/tool initial expansion, completed-turn visibility, recent-turn Ctrl-O scope, user-message fold thresholds, and the retained recent-step setting value. Settings updates mutate only this tree's policy and invalidate mounted semantic components. Standalone services use the immutable shipped defaults.

`TranscriptModelComponent` first caps entries to `TRANSCRIPT_MODEL_WINDOW = 200`, then filters semantic entries to the newest `windowTurns`. Ctrl-O applies only to the newest `expandTurns`; older cards use their category default. Reconciliation replaces components only when an entry signature changes and disposes timers/resources on replacement, eviction, unregister, reattach, or service disposal. A stable model identity, including a streaming model, reuses its aggregate rendered-row array for the same width, expansion state, and policy snapshot; projection changes replace the immutable model identity, while thinking ticks, invalidation, image readiness, policy refresh, resize, expansion, and disposal clear the aggregate cache.

## Components And Width

User, assistant, thinking, tool, error, and interruption models reuse the package components. The interruption tombstone is the text-presentation `■ interrupted` row in the theme error color, without an emoji marker. Image bytes remain renderer-owned and late-bound through the attachment store. Every assembled row must fit the width passed to `render(width)`; use `blueComponents` width helpers, never local codepoint counting or core-private chrome imports. The BTW top rule travels through the narrow `BlueComponents.topRule` renderer operation. Add every content renderer to `tests/width-scan.spec.ts`.

## Canonical Status Footer

`BlueStatusEntryService` is the transcript-owned, package-private two-band footer registry. Producers publish canonical `BlueStatusNode` values plus fixed-footer layout metadata; `StatusFooterComponent` compiles them through core's status compiler. Entries order by priority then id. The footer is the registry's invalidation target, so register/refresh/dispose clears its row cache before requesting a frame. Source and compiler failures render a canonical danger node while preserving the entry's priority, band, row, and overflow policy. Refresh is explicit and registrations are idempotently disposable. The shipped producers are:

- `status-basic-model`: current model from app/facts.
- `status-cwd`: abbreviated current cwd.
- `status-git`: TTL-cached repository badge; command runner and clock are explicit test seams.
- `status-title`: projected current title.
- `status-context`: context occupancy from conversation facts.

`BlueStatusCompositionService` is the frontend-tree owner of the rendered
footer. `blue.default` selects the fixed additive footer above. A selected
public `BlueStatusProvider` instead receives a freshly owned, recursively
frozen `BlueStatusSnapshot`: a cloned public session snapshot, visible
additive entries re-admitted through the status validator, and `busy=true`
only while the session status is `running`. Invalid additive nodes become a
bounded danger entry and hidden entries stay absent.

Candidates remain inert in `blue-api`. Selection follows the persisted
`blue.statusProvider` string and is never derived from priority, install order,
or candidate presence. The composition waits for the gutter child width,
invokes only the selected callback, compiles it through core, and dry-renders
at that exact width; zero rows, more than three rows, validation failure, and
contained runtime failure reject the candidate before an atomic activation.
Within one session an unsuccessful A -> B replacement retains A. The first
activation failure and every session-id change use the default while retrying,
so no provider generation crosses a session boundary. Desired ids, including
missing or invalid ones, are never written back. Reentrant selection,
candidate refresh, owner reload, and unload are fenced by the tree generation.

The selected/desired candidate generation may keep the prior active
generation as its last-known-good surface across two refresh/runtime failures.
In an A -> bad B replacement, retained A is B's LKG surface, so failures while
rendering it remain charged to desired B rather than `active.id`. Three
failures in a rolling 60-second window open B's timer-free breaker and restore
the default; a successful dry-render resets the selected generation's failure
history. The service keeps no expiry timer and contains footer, provider
invalidation, and repaint exceptions.

`plugin-host-bridge.ts` forwards public API status nodes into this registry and owns the corresponding disposers. The internal registry is not a public plugin surface.
Its Fiber advertises the public `status` capability before taking the aggregate
snapshot. Unload withdraws that readiness and owner mounts while
leaving consumer contributions in the API host; a replacement bridge restores
them from the snapshot. It follows the host's status-local revision so a
public status refresh invalidates an existing entry, while unrelated aggregate
mutations remain inert.

`./status-provider-owner` is the separate composition plugin that advertises
only `status.provider`, subscribes candidates and the app-owned readonly
session reader, and follows both settings updates and the settings-source-ready
handoff. Its unload detaches provider generations and restores the default
without changing the persisted desired id. Status-provider snapshots retain
the app-owned session revision while cloning and freezing the session/model
data, so provider generations observe the same public read fence.

## Canonical Bottom Panes

Activity, todo, and agents consume `blueSessionFacts`. Activity derives its phase from projection facts and owns only its presentation timer. Todo renders the projected whole list and keeps only its local expanded/collapsed view state. Agents renders projected spawn-class facts plus bounded direct-child overlays; no child Session or event subscription enters the renderer.

`BlueBottomPaneService` is package-private and accepts only Blue-owned bottom panes; it has no placement field or left/right lane. Each canonical `BlueUiNode` mounts independently through core's shared dock allocator, and `priority` controls both scarce-row allocation (larger first) and visual proximity to the fixed editor. Source/compiler/adapter failures fall back to a canonical danger node without changing priority or bottom placement. Public plugin panes do not enter this registry: core's canonical surface bridge owns their placement, compilation, events, and lifecycle.

Five accepted renderer adapters preserve behavior that the frozen W1 vocabulary cannot yet express. Every adapter is clamped through core's width truth and retains the registry's preferred-row cap:

- activity: animated per-character theme gradient; delete when canonical rich text can express a time-varying semantic gradient.
- todo: completed-row strikethrough and exact divider/title chrome; delete when canonical spans expose strike and the compiler reproduces that chrome.
- agents: the detailed live-agent card; delete when a canonical agent-card node covers its status/detail layout.
- BTW: markdown, connected-border splice, scrolling, and high-water behavior; delete when canonical surfaces expose those four behaviors together.
- queue (owned by interaction): one-line semantic color split with exact truncation; delete when canonical inline layout reproduces its label/content paint and truncation.

`tests/width-scan.spec.ts` drives an accepted adapter through the actual
`BlueBottomPaneService` mount, adapter clamp, and gutter path for every shared
`ADVERSARIAL x SCAN_WIDTHS` case. Adapter-specific unit tests do not replace
this registry-level width gate.

BTW calls `blueSessionActions.createSideSession()`, holds the returned owned handle for one pane lifetime, reads its official `blueConversation` projection through the opaque identity, and disposes the handle on close/unload. A new question replaces the visible turn before async creation begins; the fork snapshot `asOfSeq` (and a fresh snapshot for each continuation) separates inherited assistant history from replies created after that question. Its interactive dock model uses priority 100 so it receives scarce rows before passive agents/todo/queue panes. Its renderer has no trailing spacer: the gutter-wrapped pane side borders meet the connected editor's `├┤` row directly. Parent seeding and Agent status filtering remain in app.

## Tool And Plugin Models

`BlueModelToolService` converts official generic/terminal/diff/search/read/web presentation facts into canonical `BlueUiNode` values and never reads session events. `ToolPresentationModel.call` and `.result` carry those nodes, while the exported `toolCallNode` and `toolResultNode` helpers replace the deleted legacy view helpers. `ToolModelComponent` compiles the selected node directly through core's canonical compiler and retains the existing 12-row collapsed and 200-row expanded budgets so hidden-line counts stay exact; its plain fallback is also a canonical node compiled through the same path. The semantic transcript renderer keeps `ToolCallComponent` as the status/header/key-argument/shell chrome and nests the official node as its bounded body; tools without a presenter retain the generic rich fallback instead of receiving a synthetic name-only node. There is no frontend-view adapter, `blueIntents` registry, or intent subpath export.

`plugin-host-bridge.ts` is the only route from public additive-status contributions into the transcript owner; `status-provider-owner.ts` is the only route for exclusive status-provider candidates. Both unwrap the guarded host only for owner-only readiness and snapshot helpers; those helpers reject the guarded public service. Status render results, including ordinary records and arrays from a dynamic VM realm, enter through core's sole status validator/compiler. Public panes and overlays use core's canonical surface bridge instead of a transcript compatibility path.

## Package Surface

Subpath exports, `files`, and `tsdown.config.ts` entries move together.
`./status-provider-owner` is an independent composition entry because its
capability lifetime and settings/session subscriptions must not be coupled to
the additive bridge. The former public `./dock-model` subpath remains removed;
the same-named source module holds only the package-private
`BlueBottomPaneService` composition seam, and its Cordis declaration
merge travels through the package root for the shipped interaction queue only.
The deleted generic `StatusModel`/`DockModel` contracts, seven-kind frontend
`View`, frontend-renderer bridge, and legacy status, intent, fold, child-event,
and phase modules must not be reintroduced as
compatibility shortcuts. New behavior enters as projection/action + canonical
node + renderer adapter + bundle row/fixture evidence.
