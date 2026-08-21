# @dsh-blue/blue-app — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Startup

Command-line startup (`src/startup.ts`): `[task]` positional, `--resume <id>`.

## Agent driver

`src/index.ts` creates/resumes sessions and publishes them via `blueSession`. It answers the payload-less `'blue/request-new'` and `'blue/request-fork'` events (fork: idle-guarded, seeded with the full event log plus `meta.{cwd,parentSession,seedLength}`). All switches serialize on one queue and share the commit point (dispose old → assign `current` → broadcast `'blue/session-changed'`), with creation parameters factored into the module-level `createOptions` helper.

## Model selection (S23, D38)

Every setup installs a three-tier selection reference (`src/model-ref.ts` — an in-session pick, the session log's last request header, then the process default; the harness web host's precedence), and the three commit points publish it as `blueSession.modelRef` beside `current`, so a resumed session keeps the model it was already using.

## Preset mount (S28, D37)

The shared setup carries the preset mount: when `ctx.agentPresets` is composed (the bundle patch's roster row), every created/resumed/forked agent joins its preset's standing composition — the id resolved by folding the session's own record (newest `agent-preset/selected` event over the creation header, else the roster default) — so a `/preset` switch outlives the process. A composition without the roster skips the mount and agents read the global layer exactly as before.
