# `@dsh-blue/blue-app`

English | [中文](README.zh.md)

Blue terminal UI application: the command-line startup provider and the Agent driver for the interactive `dsh --profile blue` surface.

The `./startup` entry (`blue-startup`, inject `['cmdlineArgs']`) declares the app's command — an optional `[task]` positional and `--resume <id>` — and publishes the parsed values as the ordinary `blueStartup` service (`{ task?, resume? }`). On `--help` or a parse rejection the action never runs, nothing is published, and every consumer row stays pending until the launcher's bounded exit fires.

The main entry (`blue-app`, inject `['blueStartup', 'agentDefaultModel', 'agents', 'sessions', 'blueScreen']`) requires the launcher-provided `ctx.appExit` and throws without it. It provides `blueSession` — a mutable `{ current: Agent | null, modelRef: BlueModelSelectionRef | undefined }` reference — before doing anything else, waits for the Loader to settle, then resumes `--resume`'s session or creates a fresh Agent on the default model (the selection is installed into the agent scope with `installModelSelection`, same construction as the headless runner; the reference `src/model-ref.ts` builds resolves three tiers on read — an in-session pick, the session log's last request header, then the process default — so a resumed session keeps the model it was already using). A startup task is sent as the first user message. Every completed create/resume updates `blueSession.current` and `blueSession.modelRef` together and only then broadcasts `blue/session-changed(agent)`; the interaction layer's `/resume` arrives as `blue/request-resume(sessionId)`, which the driver serializes against in-flight work, resumes first, disposes the previous Agent, and publishes at that commit point — a failed switch keeps the live session and reports to stderr. Two payload-less events share the same discipline: `blue/request-new` (from `/new`) creates a fresh session, and `blue/request-fork` (from `/fork`) creates one seeded with the active session's full event log plus the lineage meta (`cwd`, `parentSession`, `seedLength`) — refused with a stderr note when no session is live or the active Agent is not `idle`. Both run through the serial queue, create before disposing, and commit with the same dispose-then-publish ordering; the creation parameters are factored into the module-level `createOptions` helper shared by startup creation and both switches. All three events and the `BlueSessionRef` type are declared in `src/types.ts`.

Terminal restore on a fatal load failure is the launcher's `installFailLoud` release, which disposes the tree; the `@dsh-blue/blue-core` effect stops the terminal. The core package also exports `createTerminalRelease()` for a future standalone Blue bin that owns `installFailLoud` itself.

## Model Experience

None, as the app submits user input as ordinary user messages; prompts and tools belong to the composed bundles.

#### KV Cache effect

None; the package adds nothing to any model request prefix.

## Known Limitations and Deferred Work

- **No dedicated bin** — the profile rides the generic `dsh` launcher, so `installFailLoud`'s release disposes the whole tree rather than calling the terminal release directly; a standalone Blue bin would hand `createTerminalRelease()` to `installFailLoud` itself. The assembled profile is exercised end to end by the bundle package's whole-tree e2e (`@dsh-blue/blue`, `tests/e2e.spec.ts`).
