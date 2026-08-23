# @dsh-blue/blue-remote

F4 session runtime and dsh-remote proxy adapter. This package is headless and must
not import pi-tui, ANSI, DOM, React, or raw terminal APIs.

`tests/adversarial.spec.ts` covers cancellation during a projection baseline load and asserts that an aborted attach cannot leave a session slot behind.
The remote adapter accepts the legacy dsh-remote v1 health shape and the authenticated v2 `system.describe`/`system.negotiate` contract. `DshRemoteTransport` maps v2 capability aliases, `host.events` SSE chunks, `session.prompt`/`session.cancel`, and `lease.acquire`/`lease.release` to Blue's narrow transport and `WriteLease` contracts. v2 callers pass `acceptedAbis` to the constructor; an empty or omitted list preserves health-only probing for legacy clients. `RemoteSessionAdapter` fences generation, drops late events, and releases an outstanding lease on disconnect. Interrupt is capability-absent on v1 and maps to `session.cancel` on v2.

`createDshRemoteWireClient()` is the explicit compatibility seam for an already-authenticated official `@dsh-remote/core` connection. It forwards only the connection contract, host stream, and async agent action carrier; Blue does not import or retain the external connection object. Delete the facade when the host publishes a stable Blue-native transport contract with the same capability and unload semantics.
