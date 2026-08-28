# @dsh-blue/blue (bundle) — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../../docs/blue-decisions.md).

## Patch layout

The installable unit contributes 31 Blue-owned rows: two host-support rows plus 29 product rows split into 8 baseline, 15 enhancement, and 6 assembly rows. The baseline contains the API host, core/theme, banner, transcript model hosts/footer, conversation projection, and official transcript consumer. Conversation is baseline because no legacy event-fold renderer remains. Official tool presentation uses canonical models and no intent rows are mounted. Core's surface bridge owns public panes/overlays, while the view and interaction bridges own additive status/commands/notifications; independent status/editor-provider owners are the exclusive composition routes. The app-owned session bridge mounts after `blue-app` provides its reader/requester and owns public `session.read`/`session.act` readiness. The bundle module itself mounts nothing.

F3 `blue-context` remains a validation-only adapter for the cutover release. It supplies the official app-projection-to-frontend adapter when installed independently; the bundle's `/context` command and `blue-status-context` consume app-owned renderer-neutral session details/facts instead. The independent fixture covers projection replay, multi-key coalescing, session-epoch rejection, and unload without adding the package to the bundle dependency closure.

F5 carries baseline `blue-conversation` and `blue-transcript-official` rows. The domain row registers the official append-origin `blueConversation` and `blueConversationFacts` projections and publishes its effect-scoped readiness capability. The consumer injects that capability, so concurrent sibling activation cannot snapshot resumed history before replay exists. The legacy transcript fold, status-entry registry, intent presenters, and child-event tracker are deleted.

F6 keeps `blue-openpencil` and `blue-lark` as validation-only ecosystem adapters. They are intentionally absent from the installable bundle dependency closure and are exercised through independent packed fixtures. OpenPencil observes only official dsh-tools results, drops signed result metadata, and publishes bounded tool/notification models. Lark registers an official command and uses the optional public loopback settings route without retaining credentials. Missing external capabilities produce no contribution and do not pending the tree; their package `AGENTS.md` files record the compatibility seams and deletion conditions.

F5 keeps the registries in their owning parent plugins: `blue-transcript` owns the package-private `blueStatusEntries` and bottom-only `blueBottomPanes` composition seams plus `blueStatusComposition`, `blueToolModels`, and `blueTranscriptModels`; `blue-interaction` owns `blueCommandModels`, `blueEditorModels`, and the frontend-tree-scoped interaction state service. The basic/cwd/git/title/context/mode rows publish canonical status nodes through `blueStatusEntries`; activity/todo/agents/BTW and the interaction-owned queue publish canonical fallback nodes through `blueBottomPanes`. Public plugin panes/overlays enter through the API host and core surface bridge; additive status enters through the transcript owner bridge.

W5-A adds one independent composition row, `blue-status-provider-owner`, after
the additive bridge. It advertises only `status.provider`, consumes the
tree-scoped composition service and app-owned readonly session reader, and
follows the persisted `blue.statusProvider` selection. Provider candidates
remain inert on installation; `blue.default` is the built-in fallback, and a
bad or absent desired id is never written back. Bundle e2e fixture wrappers
must mirror source inject lists exactly; no contribution may duplicate content
in the default composition. The API host durably buffers provider candidates,
so boot-time sibling rows may register before this owner becomes ready; its
initial snapshot must replay them. Whole-tree regression coverage mounts the
ecosystem candidate rows during Loader boot, not only after `bootBlue()`.

W5-B adds `blue-editor-provider-owner` immediately after the parent
interaction row. Its row-level `blueEditorHost` injection delays the active
renderer binding until the stable frontend-tree editor composition exists;
candidate registration may already be ready through the host buffer. The owner
follows `blue.editorProvider`, publishes inert candidates into the existing
editor outer delegate, and preserves `blue.default` on owner unload or failed
first activation; it never creates a second editor engine. Candidate
registration is host-buffered across that boot gap and owner reload; provider
selection, live shell/LKG state, breaker, gestures, and fallback remain owned
by this frontend tree.

The BTW row explicitly injects app-owned `blueSessionActions`. Although it appears before `blue-app`, Cordis holds the pane fiber until the app provides the action service; the app itself still publishes the service synchronously before its loader-settlement Agent creation. This ordering keeps Agent/session seeding out of transcript without adding an implicit race.

The `blue-plugin-session-bridge` assembly row follows `blue-app` and explicitly injects `blueSessionReader` plus `blueSessionRequester`. Its package plugin additionally injects `bluePluginHost`, so public session capabilities cannot become ready before both the API host and app-owned facades exist. Creative child Fibers inherit only `bluePluginHost`; the app reader/requester and broad action service remain isolated.

## Session-title cadence swap (S30) + bridge (D41)

The base ships the first-prompt title provider (one auxiliary-model title per session); Blue runs the Claude Code shape — every human message re-titles, so a mis-derived title self-corrects on the next one. The swap is a pair (the `sessionTitle` service accepts one provider at most, so both halves must move together): the base `session-title-llm` row is disabled (a Blue-only disable — outside the thin-host lockstep list the drift guard compares against the web-app patch, with its own named allowlist in `bundle.spec.ts`), and the `@deepseek-ai/dsh-session-title-all-prompts-llm` row is inserted with the base row's policy config copied verbatim (targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64 / timeoutMs 60000). The package rides the bundle's dev pins (the version spec keeps it on the harness line).

The all-prompts row alone is inert from a session's second message on (D41): `dsh-session-title@0.1.1-rc.2` starts derivations from the once-per-session `request/header` event or from `onMainRequest`, whose boundary gate rejects the message that opened a turn under dsh-agent-loop's event order. App-owned `title-cadence.ts` drives the public `sessionTitle.refresh` on each human message while keeping Session/Event values inside blue-app; retire it when upstream provides equivalent cadence.

## Dock order discipline

Sibling rows mount concurrently. Activity/todo/agents explicitly inject `blueComponents` plus `blueSessionFacts`; queue injects components plus app reader/actions and refreshes from the narrow app-owned queue-change notification; BTW injects components plus app actions. Their row-level dependencies and internal bottom-pane priority/id ordering pin activity → queue → todo → BTW → agents, with the interaction editor last. There is no internal left/right lane. Queue never claims Up/Down from editor history.

## Thin-host migration (S28, D37)

Three parts:

1. `blue-agent-presets` mounts the upstream roster service over this bundle's own `presets/` root. The nonstandard row id is deliberate: dsh profile boot forcibly replaces `roots` only on an `agent-presets` row, which would otherwise make direct profile launches read the host's generic `cordis` persona. Blue carries standard/code/minimal byte-for-byte from the pinned harness line plus its Blue-specific cordis mode; `presets.spec.ts` guards both the baseline drift and real model-request persona assembly. No launch path writes the host installation.
2. Ahead of the insert, the web-app bundle's own ruling is ported row-for-row: twenty-three dsh-base agent-plane rows disabled (`tool-*`, plan-mode, the compaction trio, the delegation four, the workflow trio, `agent-instructions`; `tool-subagent-report` and `system-prompt` stay host-plane), which moves the agent plane behind the presets and gives `/preset` true replacement semantics.
3. The host-plane `cordis-host-runner` row (also the web-app's own ruling — dsh-base mounts no provider) supplies `dynamicCordisRunner` + `cordisInspect`, the inject of the shipped `cordis` preset's `tool-cordis` row; without it that preset's standing mount fails the roster's activation audit. Blue wraps it in `blue-creative-host`, a Cordis isolate realm that withholds raw Blue services, commands, session projections, and approval/plan controls from every dynamic child while leaving `bluePluginHost` inherited as the additive UI route. The runner's required `tools` and Agent ownership plane stay inherited. The web client's half (`cordis-client-runner`) is deliberately not ported.

The creative isolate enumerates every `blue*` Context service except
`bluePluginHost`, including validation-only adapters so installing one cannot
widen a dynamic child's authority. `bundle.spec.ts` mechanically extracts
Context declarations, literal providers, and Blue service constants from all
package sources; a new service fails until the isolate or explicit public
allowlist is updated. Owner registries are never a compatibility fallback.

The three creative authoring skills resolve from the preset-local `baseUrl`.
Every `SKILL.md` frontmatter must parse through the pinned filesystem skill
provider and declare the same name as its directory; `presets.spec.ts` guards
this discovery contract because a malformed file is ignored even when shipped.

`bundle.spec.ts` pins the disable list to the web-app's (drift guard) and asserts every id addresses a real base row. The runtime dependencies `@deepseek-ai/dsh-agent-presets` and `@deepseek-ai/dsh-cordis-host-runner` ride the bundle's `dependencies` so `dsh plugin add` installs them.

## Distribution contract

The bundle tarball contains runtime JS, declarations, `cordis.patch.yml`, and the complete `presets/` roster. Its frontend-runtime Blue dependencies, including the public `blue-api` and pure `blue-ui` construction layer, are `workspace:*` in the repository and exact versions after packing, so an npm install cannot select an internal `*-test.*` prerelease. The candidate release workflow installs this tarball in a scratch dsh profile before promoting any tag.

The whole-tree e2e keeps `/help` scroll assertions aligned with the expanded command roster and mounts the published host runner plus tool-cordis package for creative-mode coverage. Its explicit `@deepseek-ai/dsh` dev dependency supplies the pinned host preset tree and dynamic preset package closure without leaking that graph into the dependency-free `blue-cli` tarball. Scripted model calls exercise `cordis_define`/`cordis_run`, VM isolation, pane/status/command/notice rendering, stop, restart, update, rollback, process restart, and durable buffering across a missing view owner through the real chain. The safe-retraction case emits a creative-style `commands/change` during streamed thinking and requires the same-session reader refresh to preserve the editor receipt, erase the whole turn, and leave no interruption tombstone. Cases that mount real file-backed settings without exercising first-run onboarding, including the persisted status/editor-provider replay cases, seed their temporary credentials file explicitly, so the fixture never inherits success from a developer-machine API key. VT goldens pin the composed tool-card chrome (including bounded official presenter bodies) and horizontal model/effort variants, so renderer changes update both behavior assertions and the affected snapshots.

The independent W4 dialogs slice asserts Help, Info, Approval, Questionnaire,
PlanReview, and form behavior through the canonical core compiler rather than
interaction-owned terminal rows. Bundle e2e checks Plan decisions by stripped
semantic text because core paint may place SGR boundaries inside a label/badge;
the questionnaire VT golden owns the corresponding canonical overlay and
editor-backed focused-input shape. These are composition acceptance assertions,
not transcript renderer ownership.

VT snapshot fixtures use the shared tracked-temp helper for their fixed cwd as
well as per-case settings and attachment roots, so a worker cannot leave one
directory behind for every snapshot run.
