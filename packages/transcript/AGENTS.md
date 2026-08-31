# `@dsh-blue/blue-transcript`

Repo-wide rules live in the root [AGENTS.md](../../AGENTS.md). This package is
the TUI renderer for canonical transcript, status, bottom-pane, and tool
models; it may depend on core but never exposes renderer objects upstream.

## Boundary

Transcript reads current-session facts only through app-owned
`blueSessionReader`/`blueSessionProjections` and consumes the official
`blueConversation` projections. It must not observe or fold raw Harness session
events. Agent-scoped tool presentation comes through the app's official
presenter seam, then becomes canonical `BlueUiNode` data before rendering.

The parent Fiber creates `SessionFactsService`, `TranscriptModelService`,
`BlueModelToolService`, the package-private status and bottom-pane registries,
and the tree-scoped status composition/presentation policy. Theme and locale
changes invalidate presentation caches; no product state lives in a module
singleton.

## Ownership

`official-model.ts` waits for the effect-scoped conversation-projection
readiness marker, then attaches to the current reader epoch and monotonic
projection sequence. Session/key mismatches, stale replay, and post-unload work
are rejected. `session-facts.ts` owns derived title/status/direct-child facts
and clears them before notifying on a session generation change.

Read/search grouping happens at this projection-consumer layer, not in domain
or core. Presenter vocabulary determines a read/search call; thinking is
transparent, while turn/content boundaries split runs. Groups retain bounded
semantic facts/previews and render the by-file/detail shape locally. Raw
fallback envelopes are summarized without exposing another event fold or
unbounded file/tool output.

`TranscriptPresentationPolicy` is frontend-tree state. It owns expansion,
completed-turn visibility, recent-turn scope, and user-message folding.
`TranscriptModelService` reconciles by stable model id, bounds retained
entries, reuses frames only for an unchanged model/width/policy state, and
disposes renderer resources on replacement, eviction, detach, or unload.

`BlueStatusEntryService` is the private additive fixed-footer registry;
producers publish canonical `BlueStatusNode` and layout metadata. The separate
`BlueStatusCompositionService` selects either `blue.default` or one explicitly
configured provider. Candidates are inert, dry-rendered at the actual footer
width, fenced by session/tree generation, and activated atomically. Failure
keeps a same-session last-known-good until its bounded breaker restores the
default; desired settings are never rewritten by fallback.

`BlueBottomPaneService` accepts only Blue-owned bottom panes. Priority controls
scarce-row allocation and proximity to the editor. Public panes/overlays do not
enter it; core's public surface bridge owns them. Activity, todo, agents, BTW,
and interaction's queue retain narrow renderer adapters only for behavior not
yet expressible by canonical nodes; each adapter keeps a documented deletion
condition in source and is clamped through core width truth. Activity's passive
rotation teaches only stable commands/features; focus- or state-sensitive key
guidance belongs to the active interaction surface. Todo's Ctrl-T hint remains
pane-local because it describes that pane's hidden content.

BTW owns one side-session handle for one pane lifetime, reads its official
conversation projection through the opaque identity, and disposes on close or
unload. App retains parent seeding, Agent filtering, and action ownership.

The workflow pane (`blue-pane-workflow`) folds the six `workflow/*` events the
engine dispatches unfiltered from its isolate realm — every fiber sees every
agent's runs, so a run renders only after cross-attribution: one member's
`agent-start.childId` must appear in the app-side child-session catalog
(`blueSessionProjections.children`), re-attempted on each later event, and a
run still unattributed at `workflow/end` is dropped unseen. A settled run
collapses to a one-row summary card that survives until the next turn begins
(the pane-agents kimi semantics); the in-stream record stays the `workflow`
tool's own generic result card.

`BlueModelToolService` converts official presentation facts to canonical call
and result nodes. The semantic renderer owns card status/header/chrome and
bounded expansion; it does not reintroduce the removed frontend View adapter,
intent registry, or renderer callback in shared models.

## Change Rules

- Every row fits `render(width)` and uses `blueComponents` width/compiler
  operations. Do not import core-private chrome or implement local width math.
- Image bytes stay renderer-owned and late-bound. Projection/frontend models
  carry references and semantic facts, not terminal payloads.
- The additive public status bridge and Experimental status-provider owner are
  separate Fibers with separate capability lifetime. Both use private
  `bluePluginControl`; ordinary plugins cannot enter internal registries.
- Locale catalogs/subscriptions are Fiber-owned. Translate Blue chrome only,
  not user text, paths, ids, tool output, or upstream errors.
- Do not restore the removed generic StatusModel/DockModel, frontend View,
  intent/fold/child-event compatibility layers, or public dock-model subpath.
  New behavior enters as projection/action + canonical node + renderer adapter.
- Runtime entries are derived from package exports; subpath changes also update
  the manifest files whitelist, bundle row, and direct lifecycle tests.

## Verification

Use `pnpm run verify:changed` for focused model/renderer edits. Projection
attachment, provider/status composition, bottom-pane allocation, tool
presentation, public bridge, exports, or bundle rows require
`pnpm run verify:full` and whole-tree e2e.

Every content renderer and retained bottom-pane adapter participates in
`tests/width-scan.spec.ts` through the real registry/gutter path. Preserve
focused tests for replay/live convergence, epoch/sequence fencing, grouping,
bounded previews, cache disposal, locale/theme invalidation, provider
swap/fallback/breaker/unload, side-session cleanup, and public owner
gap/replay. Version or package-surface changes also run
`pnpm run check:lib`, `pnpm run check:pack`, and the version consistency spec.
