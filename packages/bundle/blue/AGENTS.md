# @dsh-blue/blue (bundle) — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../../docs/blue-decisions.md).

## Patch layout

The installable unit. Its `cordis.patch.yml` inserts the Blue plugin rows over `dsh-base` in three commented segments — the baseline segment (five rows: `blue-core` + `blue-theme-dark` + `blue-banner` + `blue-transcript` + `blue-status-basic`; the banner sits before the transcript so the shared `blueComponents` activation round keeps it the first scroll child across `/theme` reloads), the enhancement segment (fifteen rows: `blue-editor-plus` + `blue-attachments` + `blue-paste-image` + `blue-status-cwd` + `blue-status-git` + `blue-status-title` + `blue-status-mode` + `blue-status-context` + `blue-intent-diff` + `blue-intent-terminal` + `blue-pane-activity` + `blue-pane-queue` + `blue-pane-todo` + `blue-pane-btw` + `blue-pane-agents`), and the assembly segment closing the plain baseline (three rows: `blue-interaction` + `blue-startup` + `blue-app`) — twenty-three Blue rows total, headed by two host-plane rows: the upstream `agent-presets` roster (D37) and the `session-title-all-prompts-llm` cadence row (S30). The bundle module itself mounts nothing. The four library packages are its `workspace:^` dependencies. (The `blue-status-tips` footer row retired with the S30 footer swap — the session title took its slot and the tips live on the activity pane's spinner rows only.)

## Session-title cadence swap (S30)

The base ships the first-prompt title provider (one auxiliary-model title per session); Blue runs the Claude Code shape — every human message re-titles, so a mis-derived title self-corrects on the next one. The swap is a pair (the `sessionTitle` service accepts one provider at most, so both halves must move together): the base `session-title-llm` row is disabled (a Blue-only disable — outside the thin-host lockstep list the drift guard compares against the web-app patch, with its own named allowlist in `bundle.spec.ts`), and the `@deepseek-ai/dsh-session-title-all-prompts-llm` row is inserted with the base row's policy config copied verbatim (targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64 / timeoutMs 60000). The package rides the bundle's dev pins (the version spec keeps it on the harness line).

## Dock order discipline

Sibling rows mount concurrently, so the dock order is pinned by the `blueComponents` activation round: `blue-pane-activity`/`blue-pane-queue` carry a row-level `inject: [blueComponents]` (never `blueStatus` — `/theme` would dispose the handler's own fiber mid-swap).

## Thin-host migration (S28, D37)

Two parts:

1. The upstream `agent-presets` roster row sits at the head of the insert block — the dsh CLI launcher keys on the row id to inject the shipped preset root; Blue never resolves preset paths.
2. Ahead of the insert, the web-app bundle's own ruling is ported row-for-row: twenty-three dsh-base agent-plane rows disabled (`tool-*`, plan-mode, the compaction trio, the delegation four, the workflow trio, `agent-instructions`; `tool-subagent-report` and `system-prompt` stay host-plane), which moves the agent plane behind the presets and gives `/preset` true replacement semantics.

`bundle.spec.ts` pins the disable list to the web-app's (drift guard) and asserts every id addresses a real base row. The runtime dependency `@deepseek-ai/dsh-agent-presets` rides the bundle's `dependencies` so `dsh plugin add` installs it.
