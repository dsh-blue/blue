# @dsh-blue/blue-app — agent notes

Implementation detail for this package (the user-facing surface is `README.md`/`README.zh.md`). Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md); decisions cited as Dxx are in [docs/blue-decisions.md](../../docs/blue-decisions.md).

## Startup

Command-line startup (`src/startup.ts`): `[task]` positional, `--resume <id>`.

## Agent driver

`src/index.ts` creates/resumes sessions while keeping the mutable Agent, Session, and model-selection reference private. It synchronously provides `blueSessionReader`, `blueSessionProjections`, `blueSessionActions`, and `blueToolPresentations` before waiting for Loader settlement. The reader publishes one cached, deeply frozen snapshot per app publication with a monotonic required revision and the request owner's required `sessionEpoch`. Current-session projection cuts and notifications carry that same epoch; absent keys are omitted instead of materialized as own `undefined` values. Official Blue consumers receive readonly snapshots, official projection values, structured result-bearing actions, and presenter views only inside the bundle's private runtime realm. `blueToolPresentations` is the presenter-view seam: Harness tool registrations are agent-scoped (the plain global `tools.get(name)` view misses the builtins), so the session commit point binds the active Agent as the viewing scope and the service resolves presenter hooks through it — the host Agent object never crosses the seam.

`src/plugin-host-session-bridge.ts` is the independent Interaction adapter for public `session.read` and `session.projections.read`. It waits for the composition-private `bluePluginControl`, `blueSessionReader`, and `blueSessionProjections`, then attaches both owner sources for the bridge Fiber lifetime. It maps an online reader with no current session to a null projection cut and wraps the internal unsubscribe function in an idempotent `BlueRegistration`. The projection-owner source remains composition-private: the bridge receives its shape through `bluePluginControl.attachSessionProjections` contextual typing and does not import that owner type from the public API package root. The API host owns exact field/key grants, JSON validation/detachment, size bounds, epoch/sequence fencing, owner replay, and consumer unload; the bridge never exposes `blueSessionActions`, the unscoped projection reader, Agent, or Session. Generic public `session.act` has no replacement: writes remain with their domain action owner.

Packed acceptance runs `node script/blue-plugin-fixture.mjs packages/app --install` on this release's sole supported Harness `0.1.2-alpha.2` line. Its `app.session-data-v1-scope-epoch-replay-unload` scenario imports only installed public API/app exports and proves exact field/key scope, detached freezing, same-id epoch restart, owner replay, stale callback rejection, consumer fencing, and the continued absence of generic `session.act`; all eight declared scenarios must execute without skips or failures.

The driver answers the payload-less `'blue/request-new'` and `'blue/request-fork'` events (fork: idle-guarded, seeded with the full event log plus `meta.{cwd,parentSession,seedLength}`), and `'blue/request-rewind'(sessionId, boundarySeq)`. Rewind rejects stale ids, non-idle agents, and prefixes with an open turn/step/tool call; the parent log is never mutated. All switches serialize on one queue and share the commit point: create/resume replacement → dispose old → assign internal current → publish the reader snapshot. No raw-session change event exists.

Inbox mutations publish a coalesced `'blue/queue-changed'` notification instead of rebuilding the broad session snapshot, so the queue dock updates without invalidating unrelated transcript and editor state. `blueSessionActions.interrupt()` cancels the running current Agent and walks live `origin: 'subagent'` lineage through the official Agent registry; running continuable descendants are stopped through `ctx.subagents.interrupt()` with exact-ancestor authority, including when the current parent is already idle.

## Safe message retraction

`src/retraction.ts` provides `blueRetractions.tryRetract(messageId)`: it matches the id to the current open main turn, rejects any assistant tool-call block or `tool/call`/`tool/result`, terminates the Blue lifecycle as `aborted/retracted`, emits `'blue/turn-retracted'`, and cancels with `keepInbox`. After the host `turn/end`, a microtask appends an empty interrupted `assistant/message` surface replacement over that turn's current nodes. The append-only audit remains, while `deriveMessages()` omits the withdrawn turn.

## Side-session actions

`blueSessionActions.createSideSession()` is the narrow app-owned boundary used by the BTW pane. It snapshots the active Agent's full event prefix, cwd, parent id, and provider/model route into a throwaway `btw-*` child, then runs the same Agent setup as create/resume/fork so the seed-selected preset remounts its scoped prompt, skills, and tools. A seed copies history only; it does not substitute for the child Agent Fiber's composition. The returned owned handle exposes only an opaque projection identity, plain-text follow-up, admitted `running`/`idle` status subscription, and idempotent disposal; no side session is committed to the current-session reader or the main switch queue.

## Model selection (S23, D38)

Every setup installs a three-tier selection reference (`src/model-ref.ts` — an in-session pick, the session log's last request header, then the process default; the harness web host's precedence). `blueSessionActions.modelSelection()` and `selectModel()` are its readonly/write boundaries, so a resumed session keeps the model it was already using without exporting the mutable reference.

The optional permission read stays inside the app boundary. Harness
`0.1.2-alpha.2` changed `PermissionPresetService.current` to accept the live
`Session` rather than a detached event array; `blueSessionActions.permissionPreset()`
passes the private current Session and returns only the resulting preset id.

## Preset mount (S28, D37)

The shared setup carries the preset mount: when `ctx.agentPresets` is composed (the bundle patch's roster row), every created/resumed/forked agent joins its preset's standing composition — the id resolved by folding the session's own record (newest `agent-preset/selected` event over the creation header, else the roster default) — so a `/preset` switch outlives the process. A composition without the roster skips the mount and agents read the global layer exactly as before.

## Exit epitaph (D47)

`src/exit-epitaph.ts` prints the farewell after teardown — `blue · session saved · resume with:` plus the bare `dsh --profile <name> --resume <id>` command on its own line. The driver's dispose effect arms it (`blue · session saved` only when the live session has events; the session object survives the fiber unload), and the `process 'exit'` hook flushes — the one point strictly after the screen restore and the persistence flush on every deliberate exit path (`/quit`, double Ctrl-C, startup failures, fail-loud), because the Cordis LIFO dispose order unloads blue-app before blue-core's stop effect and the base persistence rows after both. The armed line is a module-level single slot (latest arm wins, HMR-safe); the profile comes from a `process.argv` `--profile` scan defaulting to `blue`; `kill -9`/bare signals never fire it.
