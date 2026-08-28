# `@dsh-blue/blue-interaction` - Agent Notes

Implementation detail for this package. Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Runtime Boundary

Interaction code consumes app-owned `blueSessionReader`, `blueSessionProjections`, and `blueSessionActions`. Do not import or expose a Harness Agent/Session, add a direct `session/event` fold, or place renderer objects in frontend models. Renderer access stays behind `blueScreen`, `blueTheme`, `blueComponents`, `blueKeymap`, and the internal editor host.

`apply()` creates `InteractionStateService`, `EditorHostService`, `SkillsCatalogService`, `CommandModelService`, and `EditorModelService` in the parent interaction Fiber. Child plugin registrations are effect-bound. Source inject lists must be mirrored exactly by bundle e2e wrappers so rows cannot activate before these services exist.

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
The API 1.0 `complete` callback remains limited to `/`, `@`, and manual
requests; the additive `completeV2` callback opts into `#` and takes precedence
when both exist. Callback revisions are local to one editor runtime generation,
and only `onEvent` receives an owner-minted user gesture.
Changing whether the BTW pane is connected likewise fences a pending main
submit transform before Enter can cross routes; a busy-only refresh does not.

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

Async public submit transforms run behind core's pre-clear submission barrier,
in priority order. The editor stays intact until every transform succeeds.
Image markers are captured into one frozen public attachment snapshot, remain
attached through every text transform, and are consumed only after commit;
follow-up failure or safe retraction restores the exact marker/ref entries.
Commands, bash submissions, side-pane submissions, missing sessions, and other
owner-declined paths bypass public transforms.

`EditorModelService` maps the current renderer editor into readonly `EditorModel` state and structured `editor.set`, `editor.submit`, and `editor.abort` actions. Third-party consumers never receive a `BlueEditor`.

`blue-input` submits transformed blocks through `blueSessionActions.followup()` or `.steer()`, stores the stable message receipt for safe retraction, and derives busy/session state from `blueSessionReader`. Both the parent interaction plugin and the child input Fiber explicitly inject app-owned `blueRequests` and `blueRetractions`; submission opens the declared request lifecycle and the Escape/Ctrl-C path calls the declared retraction service directly, so Cordis service visibility cannot silently degrade a safe retraction into an ordinary interruption. Same-session reader refreshes retain the receipt; only a changed session id clears it. Escape and Ctrl-C preserve their distinct retraction/interruption behavior, including an idle parent with running continuable descendants. Up/Down always belong to editor history; raw wheel input and PageUp/PageDown scroll the transcript, or the BTW body while that pane is connected, and End resumes transcript tail-follow.

`blue-editor-plus` layers shell mode and slash/`@`/`#` completion over the same editor host. The `fd`/`fdfind` detection result is cached in `InteractionStateService.fdProbe`; the replaceable probe function is test-only. Missing or failed executables use the bounded filesystem fallback.

## Commands

`commands-plugin.ts` registers the base command families and owns the tree-scoped alias registrations through `InteractionStateService.aliases`. Session navigation emits the app-owned switch request events; model/mode/preset/tool/skill/session-info operations call `blueSessionActions`. Read operations use readonly reader/projection values.

The command-model service projects canonical commands into `CommandModel` values and executes only structured `command.execute` actions. Active executions receive owned abort controllers and resolve to no result after service disposal. Model/effort, trace, update, plugin, and session documents now build `BlueUiNode` trees through `CanonicalDocumentController`; the frontend `PanelModel` facade has been removed. Async command state invalidates the mounted controller only after generation/session fences accept the result, and loading snapshots do not reset grouped-tab selection. List-item variants render as one horizontal bracketed selector row, with Left/Right moving the selected variant; only that variant carries canonical `accent`/`strong` detail semantics. `/effort` uses this path and only displays levels supplied by provider metadata.

`session-export.ts` has two deliberate paths. Readable export/copy use the official `blueConversation` projection after flushing and reading the durable artifact; full export decodes the raw append-only artifact for audit fidelity. No display command may introduce a new event fold.

## Dialogs And Async Work

Dialogs mount through `EditorHostService.mountReplacement()`. The migrated list, multi-select, form, settings, and document controllers own only business state, key interpretation, and canonical event mapping; `CanonicalPanelAdapter` is the sole interaction-side bridge into core's canonical compiler. They do not assemble terminal rows, borders, ANSI, or local width math. Async panels capture a generation/session identity, abort on unload where possible, and reject stale completion before mutating UI or session actions.

`CanonicalFormController` emits a public `form` inside an overlay `surface`.
`CanonicalPanelAdapter` alone caches core-created editor engines by canonical
field path/control id across compiler rebuilds. Core owns field rows, secret
masking, cursor/IME/bracketed-paste behavior, validation, and width containment;
controllers and canonical nodes retain only renderer-neutral values and events.
Enter reaches the active editor and its submit callback advances or submits;
Tab/Shift-Tab and Escape remain composite-owned roving/cancel keys.
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

## Optional Subpaths

- `editor-plus`: shell/completion enhancement.
- `pane-queue`: the sole cross-package consumer of transcript's package-private `blueBottomPanes` seam. It publishes a canonical fallback node from the app-owned queue snapshot and retains a narrow renderer adapter for the accepted one-line color split/exact truncation; remove the adapter when canonical inline layout reproduces both. The pane mounts independently through the shared bottom allocator and leaves no empty root on unload.
- `mode-status`: canonical `BlueStatusNode` producer over app mode snapshots through transcript's package-private `blueStatusEntries` seam. It is kept in interaction because the mode snapshot/action ownership is app/interaction, not transcript rendering.
- `attachments`: bounded filesystem `AttachmentStore`.
- `paste-image`: platform clipboard ingestion and reversible submit transformation.
- `command-model`: renderer-neutral command registry.
- `plugin-host-bridge`: public command/notification/editor-extension contributions. It unwraps the guarded host only for Blue-owned readiness, snapshot, gesture, and notification owner helpers; those helpers reject the guarded public service.
- `editor-provider-owner`: persisted exclusive editor-shell selection and owner-scoped event dispatch over the stable input runtime.

The plugin-host bridge advertises `commands`, `notifications`, and
`editor.extensions` only for its active Fiber. Unload removes concrete
command/notice/extension adapters and withdraws readiness without deleting
API-host aggregate contributions; a replacement Fiber replays the retained
snapshot. Public writes during the gap return `BLUE_CAPABILITY_ABSENT`. Each
public command or editor action execution receives an owner-minted
`userGesture` whose authority lasts through legal asynchronous handler work;
the invocation abort signal and final settlement both revoke it, so a plugin
cannot retain the proof for a later capturing overlay. Completion and submit
callbacks never receive a gesture.

`paste-image` state belongs to `InteractionStateService`; readers/clocks remain explicit test seams. Late clipboard results must check unload before saving, inserting markers, or notifying.

## Package And Tests

Keep `README.md` and `README.zh.md` synchronized. Any new subpath updates package exports, `files`, and `tsdown.config.ts` together. New content components join width scans. State changes require same-tree reload, separate-tree isolation, unload, abort, and late-result coverage proportional to the affected workflow.

`editor-extension-runtime.spec.ts` is the contract suite for inert shell
refresh, source-aware completion application, timeout/abort/stale behavior,
per-id action FIFO, async submit barriers, and attachment preservation.
`input-plugin.spec.ts` additionally proves attachment rollback at the real
follow-up rejection and safe-retraction boundaries.

`changelog-content.ts` mirrors `docs/release-notes/` exactly; historical
entries remain unchanged, while current-release behavior changes update both
sources in the same commit. `0.1.1-rc.1` is the first entry for the public
renderer-neutral UI kit, canonical plugin surfaces, selected provider owners,
and split `session.read`/`session.act` capabilities; keep it newest-first and
do not rewrite the byte content of the `0.1.0-*` history.

Specs that create filesystem fixtures use the shared `mkdtempTracked` helper
and call `registerTempDirCleanup()` at module scope. This is required for
eager `afterAll` cleanup when Vitest reuses a worker; the helper's process-exit
hook is only the recovery path for an interrupted worker.

`blue-commands` also owns `/plugin`. Read-only marketplace operations query the
official registry; the bare command opens the grouped Installed/Available panel,
whose mutations delegate to the profile owner (`dsh plugin`) and report that a
restart is required. GitHub specs must be pinned to a commit before this
command will invoke the installer; `BLUE_MARKETPLACE_GITHUB_PROXY` may rewrite
GitHub sources for networks that cannot reach github.com directly.

The W4a-B migration intentionally keeps source filenames such as
`select-list.ts` and `form-panel.ts` for stable internal imports, but the old
panel classes and root exports are gone. `CanonicalSelectController`,
`CanonicalMultiSelectController`, `CanonicalFormController`,
`CanonicalDocumentController`, `CanonicalSettingsController`,
`SettingsNoticeController`, and `CanonicalOverlayContainer` are package-private
composition controllers, not a second public UI kit.
