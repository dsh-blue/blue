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

`EditorModelService` maps the current renderer editor into readonly `EditorModel` state and structured `editor.set`, `editor.submit`, and `editor.abort` actions. Third-party consumers never receive a `BlueEditor`.

`blue-input` submits transformed blocks through `blueSessionActions.followup()` or `.steer()`, stores the stable message receipt for safe retraction, recalls queued text through the action service, and derives busy/session state from `blueSessionReader`. Escape and Ctrl-C preserve their distinct retraction/interruption behavior. Up/Down belong to editor history (or queue recall); transcript navigation is limited to raw wheel input, PageUp/PageDown, and End, except while BTW explicitly owns contextual Up/Down scrolling.

`blue-editor-plus` layers shell mode and slash/`@`/`#` completion over the same editor host. The `fd`/`fdfind` detection result is cached in `InteractionStateService.fdProbe`; the replaceable probe function is test-only. Missing or failed executables use the bounded filesystem fallback.

## Commands

`commands-plugin.ts` registers the base command families and owns the tree-scoped alias registrations through `InteractionStateService.aliases`. Session navigation emits the app-owned switch request events; model/mode/preset/tool/skill/session-info operations call `blueSessionActions`. Read operations use readonly reader/projection values.

The command-model service projects canonical commands into `CommandModel` values and executes only structured `command.execute` actions. Active executions receive owned abort controllers and resolve to no result after service disposal. Model/effort, trace, and update dialogs publish `PanelModel` snapshots and structured actions into the shared `FrontendPanel`; no command-specific focusable renderer or renderer-owned business state remains. List-item variants render as one horizontal bracketed selector row, with Left/Right moving the theme-highlighted variant; `/effort` uses this path and only displays levels supplied by provider metadata.

`session-export.ts` has two deliberate paths. Readable export/copy use the official `blueConversation` projection after flushing and reading the durable artifact; full export decodes the raw append-only artifact for audit fidelity. No display command may introduce a new event fold.

## Dialogs And Async Work

Dialogs mount through `EditorHostService.mountReplacement()` and the shared list/form/info/settings/question/approval/model/plan-review components. They own focus and use core width helpers. Async panels capture a generation/session identity, abort on unload where possible, and reject stale completion before mutating UI or session actions.

Approval allowances and prompt serialization are local to one approval plugin apply. Reject feedback uses `steerCurrentAgent()` with the opaque request owner, so a session switch cannot steer a replacement Agent. Question panels follow the same abort/late-result discipline.

## Settings And Themes

`settings.ts` is the sole owner of the `blue` settings namespace. `currentBlueSettings()` reads the tree-scoped thunk; update check, `/settings`, paste image, and transcript settings must not register duplicate sections. Persisted theme changes go through `theme-switch.ts`; `currentThemeKey` and `lastAppliedTheme` live in the interaction state service, preserving same-tree reload behavior without cross-tree leakage.

Transcript tunables remain in this settings schema because interaction owns the settings UI, while transcript parses and applies them through its own tree-scoped presentation policy.

## Optional Subpaths

- `editor-plus`: shell/completion enhancement.
- `pane-queue`: queue projection and recall action.
- `mode-status`: `StatusModel` producer over app mode snapshots.
- `attachments`: bounded filesystem `AttachmentStore`.
- `paste-image`: platform clipboard ingestion and reversible submit transformation.
- `command-model`: renderer-neutral command registry.
- `plugin-host-bridge`: public command/notification contributions.

`paste-image` state belongs to `InteractionStateService`; readers/clocks remain explicit test seams. Late clipboard results must check unload before saving, inserting markers, or notifying.

## Package And Tests

Keep `README.md` and `README.zh.md` synchronized. Any new subpath updates package exports, `files`, and `tsdown.config.ts` together. New content components join width scans. State changes require same-tree reload, separate-tree isolation, unload, abort, and late-result coverage proportional to the affected workflow.
