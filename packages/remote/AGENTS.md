# @dsh-blue/blue-remote

F4 session runtime and dsh-remote proxy adapter. This package is headless and must
not import pi-tui, ANSI, DOM, React, or raw terminal APIs.

This validation-only package keeps its own `0.1.0-rc.2` version outside the
product release set. Its Blue peers use the explicit preview window
`>=0.1.1-rc.1 <0.1.2`; a prerelease caret rooted on `0.1.0` does not admit the
`0.1.1` product line and breaks independent packed installs.

`tests/adversarial.spec.ts` covers cancellation during a projection baseline load and asserts that an aborted attach cannot leave a session slot behind.
The remote adapter accepts the legacy dsh-remote v1 health shape and the authenticated v2 `system.describe`/`system.negotiate` contract. `DshRemoteTransport` maps v2 capability aliases, `host.events` SSE chunks, `session.prompt`/`session.cancel`, and `lease.acquire`/`lease.release` to Blue's narrow transport and `WriteLease` contracts. v2 callers pass `acceptedAbis` to the constructor; an empty or omitted list preserves health-only probing for legacy clients. `requestTimeoutMs` bounds official list/history/prompt/cancel calls; upstream mutation deadlines may return `OUTCOME_UNKNOWN`, so callers must not retry a write as if it definitely failed.

Official connections open the mux stream before `session.list`/tail `session.history`, apply only buffered events newer than that baseline, and fence detached session ids while another session keeps the mux alive. Read/write attachments are deduplicated per session/access and carry an epoch: detach or dispose invalidates pending completion, releases a late attachment, and prevents it from entering the active maps. Attachment and stream release failures are contained during teardown. Interrupt throws the shared typed capability carrier on v1; `CurrentSessionBinding.execute()` maps remote action failures through its package-owned `ActionCoordinator`, while v2 maps interrupt to `session.cancel`.

Remote session snapshots start at revision zero and advance once per admitted mux event; buffered replay carries the event snapshot's revision into the rebuilt baseline. This keeps the public readonly session fence monotonic without exposing the remote transport watermark as a renderer or domain object.

`RemoteSessionAdapter` fences connection generations, drops late events, and owns at most one current writer lease. Concurrent acquire/release calls share one transport operation within a generation. Finite `expiresAt` values are checked through an injectable clock; expired and late grants are released before reacquisition. Old-generation release completion cannot restore or deduplicate against a new connection. Explicit release failures return `BLUE_ACTION_REJECTED`; disconnect cleanup failures go to the optional `onDiagnostic` sink without blocking detach. Lease and attachment tests cover caller abort, concurrent acquisition, stale/expired grants, reconnect overlap, missing release carriers, network failure, and late cleanup.

Remote mutations use the package-owned `RemoteSessionAction` vocabulary. It is
a transport/domain contract, not the removed generic Blue plugin
`session.act` capability, and it never enters `BluePluginApi`.
`CurrentSessionBinding.execute()` is the structured action boundary: it owns
caller abort and session-switch stale fencing separately from readonly
`SessionBridge` state.

`createDshRemoteWireClient()` is the explicit compatibility seam for an already-authenticated official `@dsh-remote/core` connection. It forwards only the connection contract, Host carrier, async agent action carrier, and session attachment API; every action gets an explicit read/session-write policy. Question and approval replies use the official `/api/respond` client-response envelope, not an invented unary action. A successful empty response remains compatible; a JSON body must explicitly contain `accepted: true`, so duplicate or malformed responses are rejected. Blue does not import or retain the external connection object. Delete the facade when the host publishes a stable Blue-native transport contract with the same capability and unload semantics.

`pnpm fixture:remote-upstream -- --upstream <dsh-remote-core checkout>` boots the real upstream backend over a Unix socket. Add `--ssh --ssh-host <host> --ssh-user <user> --ssh-private-key <path> --ssh-fingerprint <SHA256:...>` to drive the same daemon through upstream `connectSsh()`; the fingerprint is mandatory and never discovered or trusted automatically. Both lanes prove pairing/authentication/negotiation, two-session routing, action error/timeout/cancel, duplicate response rejection, lease contention/expiry/disconnect cleanup, transport loss, same-identity reconnect, sequence resume, and late-event cleanup. The recorded upstream ABI is rc.6. The dedicated `blue-remote-frontend-runtime` profile mounts only `blue-remote-runtime` in its local patch and proves that the headless service does not block PTY/tmux resize, copy mode, or clean exit. Human acceptance remains separate.
