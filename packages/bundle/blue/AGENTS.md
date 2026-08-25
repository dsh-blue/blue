# @dsh-blue/blue (bundle) — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../../docs/blue-decisions.md).

## Patch layout

The installable unit. Its `cordis.patch.yml` inserts the Blue plugin rows over `dsh-base` in three commented segments. The baseline now starts with the stable `blue-api-host`, followed by `blue-core`, theme, banner, transcript, and the basic status; the API host owns capability-scoped third-party registrations before renderer packages activate. The shared module-root `hmr` row remains disabled: it reloads owner module roots and can replace core services, while creative updates are version switches of isolated dynamic child Fibers. The enhancement and assembly segments retain the existing rows; the enhancement segment's intent trio closes with `blue-intent-cordis`, followed later by the public view bridge after every official pane. The interaction bridge follows `blue-interaction`; together the two bridges are the only route from public dock/status/commands/notifications models into concrete owner registries. The bundle module itself mounts nothing. The five library packages are its `workspace:^` dependencies. (The `blue-status-tips` footer row retired with the S30 footer swap.)

## Session-title cadence swap (S30) + bridge (D41)

The base ships the first-prompt title provider (one auxiliary-model title per session); Blue runs the Claude Code shape — every human message re-titles, so a mis-derived title self-corrects on the next one. The swap is a pair (the `sessionTitle` service accepts one provider at most, so both halves must move together): the base `session-title-llm` row is disabled (a Blue-only disable — outside the thin-host lockstep list the drift guard compares against the web-app patch, with its own named allowlist in `bundle.spec.ts`), and the `@deepseek-ai/dsh-session-title-all-prompts-llm` row is inserted with the base row's policy config copied verbatim (targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64 / timeoutMs 60000). The package rides the bundle's dev pins (the version spec keeps it on the harness line).

The all-prompts row alone is inert from a session's second message on (D41): `dsh-session-title@0.1.1-rc.1` starts derivations from the once-per-session `request/header` event or from `onMainRequest`, whose boundary gate rejects the message that opened a turn under dsh-agent-loop's event order (`step/start` precedes the `user/message`). The `blue-session-title-cadence` bridge (mounted with the `blue-interaction` baseline) drives the public `sessionTitle.refresh` on every human message instead — retire it when an upstream fix lands (checked at the R1 pin move 2026-08-22: 0.1.1-rc.2's dsh-session-title diff is version-line only, the ordering bug is still live, so the bridge stays).

## Dock order discipline

Sibling rows mount concurrently, so the dock order is pinned by the `blueComponents` activation round: `blue-pane-activity`/`blue-pane-queue` carry a row-level `inject: [blueComponents]` (never `blueStatus` — `/theme` would dispose the handler's own fiber mid-swap).

The whole-tree e2e keeps BTW's side stream asynchronous and asserts its first
reply arrives while the parent Agent is still `running`. This is the
concurrency contract for `/btw`; a test that only uses an immediately
completed mock response would miss the production network timing.

## Thin-host migration (S28, D37)

Three parts:

1. `blue-agent-presets` mounts the upstream roster service over this bundle's own `presets/` root. The nonstandard row id is deliberate: dsh profile boot forcibly replaces `roots` only on an `agent-presets` row, which would otherwise make direct profile launches read the host's generic `cordis` persona. Blue carries standard/code/minimal byte-for-byte from the pinned harness line plus its Blue-specific cordis mode; `presets.spec.ts` guards both the baseline drift and real model-request persona assembly. No launch path writes the host installation.
2. Ahead of the insert, the web-app bundle's own ruling is ported row-for-row: twenty-three dsh-base agent-plane rows disabled (`tool-*`, plan-mode, the compaction trio, the delegation four, the workflow trio, `agent-instructions`; `tool-subagent-report` and `system-prompt` stay host-plane), which moves the agent plane behind the presets and gives `/preset` true replacement semantics.
3. The host-plane `cordis-host-runner` row (also the web-app's own ruling — dsh-base mounts no provider) supplies `dynamicCordisRunner` + `cordisInspect`, the inject of the shipped `cordis` preset's `tool-cordis` row; without it that preset's standing mount fails the roster's activation audit. Blue wraps it in `blue-creative-host`, a Cordis isolate realm that withholds raw Blue services, commands, session projections, and approval/plan controls from every dynamic child while leaving `bluePluginHost` inherited as the additive UI route. The runner's required `tools` and Agent ownership plane stay inherited. The web client's half (`cordis-client-runner`) is deliberately not ported.

`bundle.spec.ts` pins the disable list to the web-app's (drift guard) and asserts every id addresses a real base row. The runtime dependencies `@deepseek-ai/dsh-agent-presets` and `@deepseek-ai/dsh-cordis-host-runner` ride the bundle's `dependencies` so `dsh plugin add` installs them.

## Distribution contract

The bundle tarball contains runtime JS, declarations, `cordis.patch.yml`, and the complete `presets/` roster. Its five Blue dependencies are `workspace:*` in the repository and exact versions after packing. The candidate release workflow installs this tarball in a scratch dsh profile before promoting any tag.
