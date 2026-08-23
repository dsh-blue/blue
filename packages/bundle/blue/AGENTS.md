# @dsh-blue/blue (bundle) — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../../docs/blue-decisions.md).

## Patch layout

The installable unit. Its `cordis.patch.yml` inserts the Blue plugin rows over `dsh-base` in three commented segments. The baseline now starts with the stable `blue-api-host`, followed by `blue-core`, theme, banner, transcript, and the basic status; the API host owns capability-scoped third-party registrations before renderer packages activate. The enhancement and assembly segments retain the existing rows. The bundle module itself mounts nothing. Every package referenced by a row, including the frontend-runtime support closure, is a `workspace:^` dependency. (The `blue-status-tips` footer row retired with the S30 footer swap.)

The F3 `blue-context` row is present but `disabled: true`. It supplies the official session-projection-to-frontend adapter when explicitly enabled in the `blue-frontend-runtime` acceptance profile. Production composition continues to use the legacy `/context` and `blue-status-context` consumers until live acceptance; enabling the row does not disable those fallbacks, and the interaction command selects the renderer-neutral model only while the service is live.

## Session-title cadence swap (S30) + bridge (D41)

The base ships the first-prompt title provider (one auxiliary-model title per session); Blue runs the Claude Code shape — every human message re-titles, so a mis-derived title self-corrects on the next one. The swap is a pair (the `sessionTitle` service accepts one provider at most, so both halves must move together): the base `session-title-llm` row is disabled (a Blue-only disable — outside the thin-host lockstep list the drift guard compares against the web-app patch, with its own named allowlist in `bundle.spec.ts`), and the `@deepseek-ai/dsh-session-title-all-prompts-llm` row is inserted with the base row's policy config copied verbatim (targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64 / timeoutMs 60000). The package rides the bundle's dev pins (the version spec keeps it on the harness line).

The all-prompts row alone is inert from a session's second message on (D41): `dsh-session-title@0.1.1-rc.1` starts derivations from the once-per-session `request/header` event or from `onMainRequest`, whose boundary gate rejects the message that opened a turn under dsh-agent-loop's event order (`step/start` precedes the `user/message`). The `blue-session-title-cadence` bridge (mounted with the `blue-interaction` baseline) drives the public `sessionTitle.refresh` on every human message instead — retire it when an upstream fix lands (checked at the R1 pin move 2026-08-22: 0.1.1-rc.2's dsh-session-title diff is version-line only, the ordering bug is still live, so the bridge stays).

## Dock order discipline

Sibling rows mount concurrently, so the dock order is pinned by the `blueComponents` activation round: `blue-pane-activity`/`blue-pane-queue` carry a row-level `inject: [blueComponents]` (never `blueStatus` — `/theme` would dispose the handler's own fiber mid-swap).

## Thin-host migration (S28, D37)

Two parts:

1. The upstream `agent-presets` roster row sits at the head of the insert block — the dsh CLI launcher keys on the row id to inject the shipped preset root; Blue never resolves preset paths.
2. Ahead of the insert, the web-app bundle's own ruling is ported row-for-row: twenty-three dsh-base agent-plane rows disabled (`tool-*`, plan-mode, the compaction trio, the delegation four, the workflow trio, `agent-instructions`; `tool-subagent-report` and `system-prompt` stay host-plane), which moves the agent plane behind the presets and gives `/preset` true replacement semantics.

`bundle.spec.ts` pins the disable list to the web-app's (drift guard) and asserts every id addresses a real base row. The runtime dependency `@deepseek-ai/dsh-agent-presets` rides the bundle's `dependencies` so `dsh plugin add` installs it.
