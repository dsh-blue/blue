# `@dsh-blue/blue-interaction` - Agent Notes

Implementation detail for this package. Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Runtime Boundary

Interaction code consumes app-owned `blueSessionReader`, `blueSessionProjections`, and `blueSessionActions`. Do not import or expose a Harness Agent/Session, add a direct `session/event` fold, or place renderer objects in frontend models. Renderer access stays behind `blueScreen`, `blueTheme`, `blueComponents`, `blueKeymap`, and the internal editor host.

`apply()` creates `InteractionStateService`, `EditorHostService`, `SkillsCatalogService`, `CommandModelService`, and `EditorModelService` in the parent interaction Fiber. Child plugin registrations are effect-bound and must declare their own service injects; a parent entry's inject does not authorize an isolated service read in a child Fiber. Source inject lists must be mirrored exactly by bundle e2e wrappers so rows cannot activate before these services exist.

## Frontend-Tree State

`runtime-state.ts` owns all product-level mutable state shared across interaction child Fibers: command aliases; draft, input mode, and history; resolved settings and theme identity; models.dev cache; update in-flight state; file executable-probe cache; and image-paste backend/cooldown/marker state. Theme replacement rebuilds renderer-dependent children while this service survives. Another Cordis tree must receive a fresh service.

Module-level replacements are allowed only for explicit test/system seams: fetch, clock, shell process, external-editor launcher, clipboard reader/writer, OSC emitter, and bounded title-cap overrides. They must not retain product/session state.

## Editor Ownership

`EditorHostService` owns the live renderer editor reference, editor-slot replacement, enhancement presence, and ordered submit transformers per frontend tree. Every accessor takes `ctx`; no shared editor singleton exists. Reversible transformers register rollback callbacks in contribution order and execute them in reverse order after a safe retraction.

`EditorExtensionRuntime` is the frontend-tree owner for public
`editor.extensions` contributions. The plugin-host bridge publishes only an
inert, frozen callback binding; registration and host snapshots never execute
third-party code. The runtime validates passive before/after rows, diagnostics,
and actions, then recompiles the shell around the exact same `BlueEditor`
object so draft, history, undo, IME, paste state, and editor-plus hooks survive
an extension refresh. Action callbacks run FIFO per extension id with an
owner-minted user gesture. Refresh/unload aborts the old generation and clears
its queue, so a same-id replacement can run immediately.

The same runtime multiplexes Blue-owned slash/`@`/`#` sources with public `/`,
`@`, `#`, and manual completion. Accepted items retain their source and prefix;
one source cannot change another source's replacement range. Extension
completion has a 5-second bound. Action and submit callbacks have 30-second
bounds. Timeout, unload, extension refresh, buffer change, and session switch
abort pending work and reject late results without mutating the editor.
The current Beta compatibility `complete` callback remains limited to `/`, `@`, and manual
requests; the additive `completeV2` callback opts into `#` and takes precedence
when both exist. Callback revisions are local to one editor runtime generation,
and only `onEvent` receives an owner-minted user gesture.
Changing whether the BTW pane is connected likewise fences a pending main
submit transform before Enter can cross routes; a busy-only refresh does not.

`editor.extensions` is retained as an Experimental/reference capability in the
Beta host. Its mature lifecycle runtime remains covered, but it is not part of
the Stable v1 capability root.

The same stable outer delegate composes the selected `editor.provider` shell.
`./editor-provider-owner` advertises the capability only after
`blueEditorHost` exists, follows the persisted `blue.editorProvider` id, and
publishes inert candidates plus an owner-minted gesture dispatch boundary.
Installation order and priority never select a candidate. The runtime invokes
only the desired candidate after the actual editor width is known, validates
its exactly-one-visible-`editor-control` invariant, dry-renders through core's
checked shell seam, then atomically replaces only the inner component and
focus target. The screen child, outer focus identity, and injected
`BlueEditor` remain unchanged, preserving draft, cursor, history, IME, paste,
attachments, completion, and submit barriers across provider swaps.

Blue automatically wraps a valid provider shell with the admitted extension
envelope. If extension composition fails the canonical budget, the provider
shell stays usable without that envelope and the owner reports a bounded
notice; extension failure is not charged to the provider. Same-session
candidate failure retains the previous interactive shell, while first
activation, session switch, active-provider unload, and owner unload use
`blue.default`. Contained live render failure switches display and input to
the same fallback in the current frame. Three failures for one desired
candidate object in a rolling 60 seconds open a timer-free breaker; a new
same-id object may retry. Only a successful committed live frame from the
latest candidate generation resets its failure history; dry-render success and
a retained LKG frame do not. Provider change events are latest-wins, discrete
events are FIFO, and every callback is bounded, abortable, gesture-scoped, and
rejected after refresh/session/unload.

`editor.provider` is likewise Experimental/reference. Existing selection,
fallback, and state-preservation behavior remains product evidence, not a
Stable v1 compatibility promise.

Async public submit transforms run behind core's pre-clear submission barrier,
in priority order. The editor stays intact until every transform succeeds.
Image markers are captured into one frozen public attachment snapshot, remain
attached through every text transform, and are consumed only after commit;
follow-up failure or safe retraction restores the exact marker/ref entries.
Commands, bash submissions, side-pane submissions, missing sessions, and other
owner-declined paths bypass public transforms.

`EditorModelService` maps the current renderer editor into readonly `EditorModel` state and structured `editor.set`, `editor.submit`, and `editor.abort` actions. Third-party consumers never receive a `BlueEditor`.

`blue-input` submits transformed blocks through `blueSessionActions.followup()` or `.steer()`, stores the stable message receipt for safe retraction, and derives busy/session state from `blueSessionReader`. Both the parent interaction plugin and the child input Fiber explicitly inject app-owned `blueRequests` and `blueRetractions`; submission opens the declared request lifecycle and only the Escape path calls the declared retraction service, so Cordis service visibility cannot silently degrade a safe retraction into an ordinary interruption. Same-session reader refreshes retain the receipt; only a changed session id clears it. Ctrl-C never retracts: it first requests ordinary interruption even when a next-message draft is present, preserving that draft; only when no work can be interrupted does it clear an idle draft or enter the double-press exit path. Escape retains clear-then-safe-retract/fallback-interrupt behavior, including an idle parent with running continuable descendants. Up/Down always belong to editor history; raw wheel input and PageUp/PageDown scroll the transcript, or the BTW body while that pane is connected, and End resumes transcript tail-follow.

`blue-editor-plus` layers shell mode and slash/`@`/`#` completion over the same editor host. The `fd`/`fdfind` detection result is cached in `InteractionStateService.fdProbe`; the replaceable probe function is test-only. Missing or failed executables use the bounded filesystem fallback.

## Commands

`commands-plugin.ts` registers the base command families and owns the tree-scoped alias registrations through `InteractionStateService.aliases`. Session navigation emits the app-owned switch request events; model/mode/preset/tool/skill/session-info operations call `blueSessionActions`. Read operations use readonly reader/projection values.

The command-model service projects canonical commands into `CommandModel` values and executes only structured `command.execute` actions. Active executions receive owned abort controllers and resolve to no result after service disposal. Model/effort, trace, update, plugin, and session documents now build `BlueUiNode` trees through `CanonicalDocumentController`; the frontend `PanelModel` facade has been removed. Async command state invalidates the mounted controller only after generation/session fences accept the result, and loading snapshots do not reset grouped-tab selection. List-item variants render as one horizontal bracketed selector row, with Left/Right moving the selected variant; only that variant carries canonical `accent`/`strong` detail semantics. Filterable documents reserve every printable character, including `q`, for the query, so their footer advertises Escape as the sole close key. `/effort` uses this path and only displays levels supplied by provider metadata.

`session-export.ts` has two deliberate paths. Readable export/copy use the official `blueConversation` projection after flushing and reading the durable artifact; full export decodes the raw append-only artifact for audit fidelity. No display command may introduce a new event fold.

## Dialogs And Async Work

Dialogs mount through `EditorHostService.mountReplacement()`. The migrated list, multi-select, form, settings, and document controllers own only business state, key interpretation, and canonical event mapping; `CanonicalPanelAdapter` is the sole interaction-side bridge into core's canonical compiler. They do not assemble terminal rows, borders, ANSI, or local width math. Async panels capture a generation/session identity, abort on unload where possible, and reject stale completion before mutating UI or session actions.

`CanonicalFormController` emits a public `form` inside an overlay `surface`.
`CanonicalPanelAdapter` alone caches core-created editor engines by canonical
field path/control id across compiler rebuilds. On invalidation it blurs those
engines and detaches only its change/submit callbacks before the replacement
compiler leases them. It restores a controller selection either by semantic
group or by the form's vertical axis, and explicit free-text modes re-enter
editing after a structural rebuild. Core owns field rows, secret masking,
cursor/IME/bracketed-paste behavior, validation, and width containment;
controllers and canonical nodes retain only renderer-neutral values and events.
Up/Down moves within a form only from navigation state and remains editor-owned
while editing. Typing starts editing directly; Enter first enters an untouched
field, while editor submit advances or submits. Tab/Shift-Tab
remain composite-owned group navigation and Escape exits editing before cancel.
Approval, Questionnaire, PlanReview, Help, Info, and loading documents now
project canonical `surface`, `list`, `form`, `loader`, and content nodes through
the same adapter. Their controllers retain only answer/draft/window state and
historical key mapping. Core owns borders, pointers, form cursors, wrapping,
semantic paint, sanitation, and width containment. Help/Info retain bounded
Up/Down/PageUp/PageDown windows; their full rich-text leaf uses an exact private
path plus the compiler's post-wrap offset/row metadata, so narrow wrapping is
pageable rather than truncated and resize clamps against actual rendered rows.
Questionnaire keeps one draft per question, accepts 1-9 direct selection, and
Escape backs out of `Other` before cancelling the request.

Plan review preserves the full plan text, core Markdown presentation, live
post-wrap viewport window, two-axis scroll/decision keys, and revise answer
encoding. `CanonicalPanelAdapter` identifies the Plan body by one exact private
leaf path and forwards the live offset/row metadata; no public host or plugin
path can select this renderer substitution. Delete the private Markdown path
when the canonical vocabulary gains a validated Markdown/content node, delete
the row-window seam when canonical content boxes support controlled scrolling,
and delete the private editor resolver when canonical form controls carry full
editor semantics. Never restore package-local Markdown/editor rendering,
chrome, or width math.

Approval allowances and prompt serialization are local to one approval plugin apply. Reject feedback uses `steerCurrentAgent()` with the opaque request owner, so a session switch cannot steer a replacement Agent. Question panels follow the same abort/late-result discipline.

## Settings And Themes

`settings.ts` is the sole owner of the `blue` settings namespace. `currentBlueSettings()` reads the tree-scoped thunk; update check, `/settings`, paste image, and transcript settings must not register duplicate sections. Persisted theme changes go through `theme-switch.ts`; `currentThemeKey` and `lastAppliedTheme` live in the interaction state service, preserving same-tree reload behavior without cross-tree leakage.

The same schema owns the persisted `statusProvider` and `editorProvider` ids.
Their default sentinel is `blue.default`; arbitrary non-empty ids remain stored
so a temporarily absent provider can become active after installation or owner
reload. When the consolidated settings source becomes readable, this owner
emits `'blue/settings-source-ready'` with the resolved value. Provider owners
use that initialization handoff plus ordinary `settings/updated` commits;
neither channel is another settings registry or a write-back path.

Transcript tunables remain in this settings schema because interaction owns the settings UI, while transcript parses and applies them through its own tree-scoped presentation policy.

The `/settings` inventory starts with the Harness-owned `locale` namespace. `locale.preference` cycles raw `undefined` (follow system), `zh`, and `en`; display labels and Blue-owned settings chrome are translated through the tree's `blueLocale` service. `CanonicalSettingsController.updatePresentation()` reprojects level-one rows and the live canonical settings node in place, preserving controller/panel identity, cursor, an open form, and its editor draft. Command descriptions, slash completion copy, help, question/approval chrome, and shell notices use the same dynamic translator. Locale observers attach to the current provider synchronously, then follow Cordis provider unload/reload without retaining a dead service. Command models notify subscribers after a locale revision without changing command/action identity. User, model, and tool text; paths; ids; command names; provider/model names; and upstream error details remain untranslated.

## Optional Subpaths

- `editor-plus`: shell/completion enhancement.
- `pane-queue`: the sole cross-package consumer of transcript's package-private `blueBottomPanes` seam. It publishes a canonical fallback node from the app-owned queue snapshot and retains a narrow renderer adapter for the accepted one-line color split/exact truncation; remove the adapter when canonical inline layout reproduces both. The pane mounts independently through the shared bottom allocator and leaves no empty root on unload.
- `mode-status`: canonical `BlueStatusNode` producer over app mode snapshots through transcript's package-private `blueStatusEntries` seam. It is kept in interaction because the mode snapshot/action ownership is app/interaction, not transcript rendering.
- `attachments`: bounded filesystem `AttachmentStore`.
- `paste-image`: platform clipboard ingestion and reversible submit transformation.
- `command-model`: renderer-neutral command registry.
- `plugin-host-bridge`: public command, publish-only notification, and Experimental editor-extension contributions. It injects the composition-private control for readiness, snapshot, gesture, and notification observation; it never unwraps the guarded public host.
- `editor-provider-owner`: persisted exclusive editor-shell selection and owner-scoped event dispatch over the stable input runtime.

The plugin-host bridge advertises `commands`, `notifications.publish`, and
`editor.extensions` only for its active Fiber. Unload removes concrete
command/notice/extension adapters and withdraws readiness without deleting
API-host aggregate contributions; a replacement Fiber replays the retained
snapshot. Public writes during the gap return `BLUE_CAPABILITY_ABSENT`. Each
public command or editor action execution receives an owner-minted
`userGesture` whose authority lasts through legal asynchronous handler work;
the invocation abort signal and final settlement both revoke it, so a plugin
cannot retain the proof for a later capturing overlay. Completion and submit
callbacks never receive a gesture. The command adapter checks its captured
owner generation before dispatch and after both fulfilled and rejected
settlement; a removed Harness registration also carries a local live fence.
Retained old handlers therefore return a stale command error without invoking
plugin code. The API host independently fences settlement after the plugin
consumer Fiber unloads.

`paste-image` state belongs to `InteractionStateService`; readers/clocks remain explicit test seams. Late clipboard results must check unload before saving, inserting markers, or notifying.

## Package And Tests

Keep `README.md` and `README.zh.md` synchronized. Any new subpath updates package exports, `files`, and `tsdown.config.ts` together. New content components join width scans. State changes require same-tree reload, separate-tree isolation, unload, abort, and late-result coverage proportional to the affected workflow.

`editor-extension-runtime.spec.ts` is the contract suite for inert shell
refresh, source-aware completion application, timeout/abort/stale behavior,
per-id action FIFO, async submit barriers, and attachment preservation.
`width-scan.spec.ts` owns the shared `ADVERSARIAL x SCAN_WIDTHS` gate for the
canonical single-select, multi-select, form, settings, document select/loading,
and migrated dialog paths. Approval coverage must enter through the actual
plugin request and mounted prompt, not a separately constructed private class.
Plan-review scroll tails use the compact `showing <start>-<end>/<total>` form so
the complete range survives a closed overlay's inner-width budget; its footer
keeps the compact `←→ 1-3 choose · ↑↓ scroll · Esc` command vocabulary.
`editor-provider-runtime.spec.ts` directly proves that provider swaps retain
one editor's draft, history, cursor, mode, attachment snapshot, focus, and
exact renderer IME marker byte pass-through, plus fallback/breaker behavior
and unload fencing. Real pi-tui IME composition remains a live acceptance
scenario; the fake-editor unit assertion does not substitute for it.
`input-plugin.spec.ts` additionally proves attachment rollback at the real
follow-up rejection and safe-retraction boundaries.

`changelog-content.ts` mirrors `docs/release-notes/` exactly; historical
entries remain unchanged, while current-release behavior changes update both
sources in the same commit. `0.1.2-alpha.1` records the Harness alpha API and
shipped-preset migration; older entries retain their accepted contracts and
historical compatibility claims. Keep it newest-first and do not rewrite the
byte content of older release history.

Specs that create filesystem fixtures use the shared `mkdtempTracked` helper
and call `registerTempDirCleanup()` at module scope. This is required for
eager `afterAll` cleanup when Vitest reuses a worker; the helper's process-exit
hook is only the recovery path for an interrupted worker.

`blue-commands` also owns `/plugin`. P5 removes the old marketplace registry
from runtime authority: the fixed Installed tab derives only from
current-profile dependencies whose package exposes
`package.json.blue.manifest`. Its rows carry compatibility state plus explicit
Verify/Remove variants. The fixed Catalog tab starts from a release-vetted,
immutable snapshot of an explicit repository list and refreshes bounded GitHub
metadata in the background; close/unload aborts the fetch and both fulfill and
reject continuations carry a live fence. A failed refresh retains the bundled
snapshot. No repository code is imported or executed while indexing. Only a
canonical P1 manifest compatible with the current API/Blue/Harness/Node lines
receives an Install variant, and its source is pinned to the resolved full
40-character commit using pnpm's `github:owner/repo#commit` delimiter. The
release-vetted `dsh-blue/blue-doudizhu` snapshot is canonical at `0.3.0` and
installable; a legacy entry remains visible as Needs migration with Details
available and a disabled `[Migration required]` action instead of a misleading
Install label. This TUI catalog
is not the paused Website Marketplace and does not start P6 outreach or
migration.

Direct install accepts existing local paths/tarballs, exact npm versions, or
GitHub sources pinned to a full 40-character commit. Local directories must
pass the published `@dsh-blue/blue-plugin-kit` validator before `dsh plugin` is
invoked; they are normalized to pnpm `file:` installs so the profile
materializes their declared dependency closure instead of retaining a
dependency-blind source symlink. Source changes therefore require another
install before restart. All mutations report that restart is required and
never replace the live Cordis tree. `BLUE_GITHUB_PROXY` may rewrite only
already-pinned GitHub sources. GitHub shorthand always reaches pnpm as
`github:owner/repo#commit`; the accepted legacy `@commit` spelling is normalized
at this boundary because pnpm otherwise resolves it as a malformed repository.
Plugin tab selection survives async loading;
rows use action-first variants so actions remain visible before long metadata,
and the selected action is repeated in the footer when list details disappear
at 40 columns or below.

The parent interaction Fiber also mounts `blue-plugin-author-environment` as a
child that waits for the official Harness `shellEnv` registry. It contributes
only `DSH_BLUE_PLUGIN_NODE` and `DSH_BLUE_PLUGIN_BIN`, resolved to the current
Node executable and the bundle-installed plugin-kit entry. The creative author
skill invokes those absolute paths instead of trusting ambient PATH, a global
install, or a guessed profile root. Shell-env owns per-execution collection and
the child Fiber owns registration cleanup.

The W4a-B migration intentionally keeps source filenames such as
`select-list.ts` and `form-panel.ts` for stable internal imports, but the old
panel classes and root exports are gone. `CanonicalSelectController`,
`CanonicalMultiSelectController`, `CanonicalFormController`,
`CanonicalDocumentController`, `CanonicalSettingsController`,
and `SettingsNoticeController` are package-private composition controllers, not
a second public UI kit. `CanonicalPanelAdapter` is the one package-private
compiler bridge shared by those controllers; do not add compatibility wrapper
classes around it.
