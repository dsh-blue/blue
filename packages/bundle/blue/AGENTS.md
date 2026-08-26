# @dsh-blue/blue (bundle) — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../../docs/blue-decisions.md).

## Patch layout

The installable unit contributes 28 Blue-owned rows: two host-support rows plus 26 product rows split into 8 baseline, 14 enhancement, and 4 assembly rows. The baseline contains the API host, core/theme, banner, transcript model hosts/footer, conversation projection, and official transcript consumer. Conversation is baseline because no legacy event-fold renderer remains. Official tool presentation uses canonical models and no intent rows are mounted. The view and interaction bridges are the only route from public dock/status/command/notification contributions into concrete owner registries. The bundle module itself mounts nothing.

F3 `blue-context` remains a validation-only adapter for the cutover release. It supplies the official app-projection-to-frontend adapter when installed independently; the bundle's `/context` command and `blue-status-context` consume app-owned renderer-neutral session details/facts instead. The independent fixture covers projection replay, multi-key coalescing, session-epoch rejection, and unload without adding the package to the bundle dependency closure.

F5 carries baseline `blue-conversation` and `blue-transcript-official` rows. The domain row registers the official append-origin `blueConversation` and `blueConversationFacts` projections and publishes its effect-scoped readiness capability. The consumer injects that capability, so concurrent sibling activation cannot snapshot resumed history before replay exists. The legacy transcript fold, status-entry registry, intent presenters, and child-event tracker are deleted.

F6 keeps `blue-openpencil` and `blue-lark` as validation-only ecosystem adapters. They are intentionally absent from the installable bundle dependency closure and are exercised through independent packed fixtures. OpenPencil observes only official dsh-tools results, drops signed result metadata, and publishes bounded tool/notification models. Lark registers an official command and uses the optional public loopback settings route without retaining credentials. Missing external capabilities produce no contribution and do not pending the tree; their package `AGENTS.md` files record the compatibility seams and deletion conditions.

F5 adds no parallel composition rows for registries: `blue-transcript` owns `blueStatusModels`, `blueDockModels`, `blueToolModels`, and `blueTranscriptModels`; `blue-interaction` owns `blueCommandModels`, `blueEditorModels`, and the frontend-tree-scoped interaction state service. The basic/cwd/git/title/context/mode status rows inject `blueStatusModels`, while activity/todo/agents consume `blueSessionFacts`. Bundle e2e fixture wrappers must mirror source inject lists exactly; no model may duplicate content in the default composition.

The BTW row explicitly injects app-owned `blueSessionActions`. Although it appears before `blue-app`, Cordis holds the pane fiber until the app provides the action service; the app itself still publishes the service synchronously before its loader-settlement Agent creation. This ordering keeps Agent/session seeding out of transcript without adding an implicit race.

## Session-title cadence swap (S30) + bridge (D41)

The base ships the first-prompt title provider (one auxiliary-model title per session); Blue runs the Claude Code shape — every human message re-titles, so a mis-derived title self-corrects on the next one. The swap is a pair (the `sessionTitle` service accepts one provider at most, so both halves must move together): the base `session-title-llm` row is disabled (a Blue-only disable — outside the thin-host lockstep list the drift guard compares against the web-app patch, with its own named allowlist in `bundle.spec.ts`), and the `@deepseek-ai/dsh-session-title-all-prompts-llm` row is inserted with the base row's policy config copied verbatim (targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64 / timeoutMs 60000). The package rides the bundle's dev pins (the version spec keeps it on the harness line).

The all-prompts row alone is inert from a session's second message on (D41): `dsh-session-title@0.1.1-rc.2` starts derivations from the once-per-session `request/header` event or from `onMainRequest`, whose boundary gate rejects the message that opened a turn under dsh-agent-loop's event order. App-owned `title-cadence.ts` drives the public `sessionTitle.refresh` on each human message while keeping Session/Event values inside blue-app; retire it when upstream provides equivalent cadence.

## Dock order discipline

Sibling rows mount concurrently. Activity/todo/agents explicitly inject `blueComponents` plus `blueSessionFacts`; queue injects components plus app reader/actions and refreshes from the narrow app-owned queue-change notification; BTW injects components plus app actions. Their row-level dependencies and `DockModel` priority/id ordering pin activity → queue → todo → btw → agents, with the interaction editor last. Queue never claims Up/Down from editor history.

## Thin-host migration (S28, D37)

Three parts:

1. `blue-agent-presets` mounts the upstream roster service over this bundle's own `presets/` root. The nonstandard row id is deliberate: dsh profile boot forcibly replaces `roots` only on an `agent-presets` row, which would otherwise make direct profile launches read the host's generic `cordis` persona. Blue carries standard/code/minimal byte-for-byte from the pinned harness line plus its Blue-specific cordis mode; `presets.spec.ts` guards both the baseline drift and real model-request persona assembly. No launch path writes the host installation.
2. Ahead of the insert, the web-app bundle's own ruling is ported row-for-row: twenty-three dsh-base agent-plane rows disabled (`tool-*`, plan-mode, the compaction trio, the delegation four, the workflow trio, `agent-instructions`; `tool-subagent-report` and `system-prompt` stay host-plane), which moves the agent plane behind the presets and gives `/preset` true replacement semantics.
3. The host-plane `cordis-host-runner` row (also the web-app's own ruling — dsh-base mounts no provider) supplies `dynamicCordisRunner` + `cordisInspect`, the inject of the shipped `cordis` preset's `tool-cordis` row; without it that preset's standing mount fails the roster's activation audit. Blue wraps it in `blue-creative-host`, a Cordis isolate realm that withholds raw Blue services, commands, session projections, and approval/plan controls from every dynamic child while leaving `bluePluginHost` inherited as the additive UI route. The runner's required `tools` and Agent ownership plane stay inherited. The web client's half (`cordis-client-runner`) is deliberately not ported.

`bundle.spec.ts` pins the disable list to the web-app's (drift guard) and asserts every id addresses a real base row. The runtime dependencies `@deepseek-ai/dsh-agent-presets` and `@deepseek-ai/dsh-cordis-host-runner` ride the bundle's `dependencies` so `dsh plugin add` installs them.

## Distribution contract

The bundle tarball contains runtime JS, declarations, `cordis.patch.yml`, and the complete `presets/` roster. Its frontend-runtime Blue dependencies are `workspace:^` in the repository and exact versions after packing. The candidate release workflow installs this tarball in a scratch dsh profile before promoting any tag.

The whole-tree e2e keeps `/help` scroll assertions aligned with the expanded command roster and the creative preset host-runner dependency; package composition remains the source of truth for both rows. Cases that mount real file-backed settings without exercising first-run onboarding seed their temporary credentials file explicitly, so the fixture never inherits success from a developer-machine API key. VT goldens pin the composed tool-card chrome (including bounded official presenter bodies) and horizontal model/effort variants, so renderer changes update both behavior assertions and the affected snapshots.
