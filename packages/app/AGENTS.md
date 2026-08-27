# @dsh-blue/blue-app — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Startup

Command-line startup (`src/startup.ts`): `[task]` positional, `--resume <id>`.

## Agent driver

`src/index.ts` creates/resumes sessions while keeping the mutable Agent, Session, and model-selection reference private. It synchronously provides `blueSessionReader`, `blueSessionProjections`, `blueSessionActions`, and `blueToolPresentations` before waiting for Loader settlement. Consumers receive readonly snapshots, official projection values, and structured result-bearing actions only. `blueToolPresentations` is the presenter-view seam: Harness tool registrations are agent-scoped (the plain global `tools.get(name)` view misses the builtins), so the session commit point binds the active Agent as the viewing scope and the service resolves presenter hooks through it — the host Agent object never crosses the seam.

The driver answers the payload-less `'blue/request-new'` and `'blue/request-fork'` events (fork: idle-guarded, seeded with the full event log plus `meta.{cwd,parentSession,seedLength}`), and `'blue/request-rewind'(sessionId, boundarySeq)`. Rewind rejects stale ids, non-idle agents, and prefixes with an open turn/step/tool call; the parent log is never mutated. All switches serialize on one queue and share the commit point: create/resume replacement → dispose old → assign internal current → publish the reader snapshot. No raw-session change event exists.

Inbox mutations publish a coalesced `'blue/queue-changed'` notification instead of rebuilding the broad session snapshot, so the queue dock updates without invalidating unrelated transcript and editor state. `blueSessionActions.interrupt()` cancels the running current Agent and walks live `origin: 'subagent'` lineage through the official Agent registry; running continuable descendants are stopped through `ctx.subagents.interrupt()` with exact-ancestor authority, including when the current parent is already idle.

## Safe message retraction

`src/retraction.ts` provides `blueRetractions.tryRetract(messageId)`: it matches the id to the current open main turn, rejects any assistant tool-call block or `tool/call`/`tool/result`, terminates the Blue lifecycle as `aborted/retracted`, emits `'blue/turn-retracted'`, and cancels with `keepInbox`. After the host `turn/end`, a microtask appends an empty interrupted `assistant/message` surface replacement over that turn's current nodes. The append-only audit remains, while `deriveMessages()` omits the withdrawn turn.

## Side-session actions

`blueSessionActions.createSideSession()` is the narrow app-owned boundary used by the BTW pane. It snapshots the active Agent's full event prefix, cwd, parent id, and provider/model route into a throwaway `btw-*` child, then runs the same Agent setup as create/resume/fork so the seed-selected preset remounts its scoped prompt, skills, and tools. A seed copies history only; it does not substitute for the child Agent Fiber's composition. The returned owned handle exposes only an opaque projection identity, plain-text follow-up, admitted `running`/`idle` status subscription, and idempotent disposal; no side session is committed to the current-session reader or the main switch queue.

## Model selection (S23, D38)

Every setup installs a three-tier selection reference (`src/model-ref.ts` — an in-session pick, the session log's last request header, then the process default; the harness web host's precedence). `blueSessionActions.modelSelection()` and `selectModel()` are its readonly/write boundaries, so a resumed session keeps the model it was already using without exporting the mutable reference.

## Preset mount (S28, D37)

The shared setup carries the preset mount: when `ctx.agentPresets` is composed (the bundle patch's roster row), every created/resumed/forked agent joins its preset's standing composition — the id resolved by folding the session's own record (newest `agent-preset/selected` event over the creation header, else the roster default) — so a `/preset` switch outlives the process. A composition without the roster skips the mount and agents read the global layer exactly as before.

## Exit epitaph (D47)

`src/exit-epitaph.ts` prints the farewell after teardown — `blue · session saved · resume with:` plus the bare `dsh --profile <name> --resume <id>` command on its own line. The driver's dispose effect arms it (`blue · session saved` only when the live session has events; the session object survives the fiber unload), and the `process 'exit'` hook flushes — the one point strictly after the screen restore and the persistence flush on every deliberate exit path (`/quit`, double Ctrl-C, startup failures, fail-loud), because the Cordis LIFO dispose order unloads blue-app before blue-core's stop effect and the base persistence rows after both. The armed line is a module-level single slot (latest arm wins, HMR-safe); the profile comes from a `process.argv` `--profile` scan defaulting to `blue`; `kill -9`/bare signals never fire it.
