# @dsh-blue/blue-app — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Startup

Command-line startup (`src/startup.ts`): `[task]` positional, `--resume <id>`.

## Agent driver

`src/index.ts` creates/resumes sessions and publishes them via `blueSession`. It answers the payload-less `'blue/request-new'` and `'blue/request-fork'` events (fork: idle-guarded, seeded with the full event log plus `meta.{cwd,parentSession,seedLength}`), and the additive `'blue/request-rewind'(sessionId, boundarySeq)` request. Rewind rejects stale session ids, non-idle agents, and prefixes with an open turn/step/tool call, then creates an ordinary child Agent from `events.slice(0, boundarySeq)` with the same lineage metadata; the parent log is never mutated. All switches serialize on one queue and share the commit point (dispose old → assign `current` → broadcast `'blue/session-changed'`), with creation parameters factored into the module-level `createOptions` helper.

## Model selection (S23, D38)

Every setup installs a three-tier selection reference (`src/model-ref.ts` — an in-session pick, the session log's last request header, then the process default; the harness web host's precedence), and the three commit points publish it as `blueSession.modelRef` beside `current`, so a resumed session keeps the model it was already using.

## Preset mount (S28, D37)

The shared setup carries the preset mount: when `ctx.agentPresets` is composed (the bundle patch's roster row), every created/resumed/forked agent joins its preset's standing composition — the id resolved by folding the session's own record (newest `agent-preset/selected` event over the creation header, else the roster default) — so a `/preset` switch outlives the process. A composition without the roster skips the mount and agents read the global layer exactly as before.

## Exit epitaph (D47)

`src/exit-epitaph.ts` prints the farewell after teardown — `blue · session saved · resume with:` plus the bare `dsh --profile <name> --resume <id>` command on its own line. The driver's dispose effect arms it (`blue · session saved` only when the live session has events; the session object survives the fiber unload), and the `process 'exit'` hook flushes — the one point strictly after the screen restore and the persistence flush on every deliberate exit path (`/quit`, double Ctrl-C, startup failures, fail-loud), because the Cordis LIFO dispose order unloads blue-app before blue-core's stop effect and the base persistence rows after both. The armed line is a module-level single slot (latest arm wins, HMR-safe); the profile comes from a `process.argv` `--profile` scan defaulting to `blue`; `kill -9`/bare signals never fire it.

## Distribution contract

The `.`/`./startup`/`./invariant` entries are built directly from their source files and published with their declaration counterparts. Keep the manifest exports and source entry names aligned; `pnpm check:pack` is the release gate.
