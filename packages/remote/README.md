# @dsh-blue/blue-remote

Headless F4 session runtime for Blue. It provides a multi-session projection
registry, current-session binding, and a narrow `RemoteTransport` proxy for
dsh-remote-style negotiate, sequence resume, write lease, action, and
question/approval capabilities.

The package does not import TUI or terminal APIs. Official connections are
adapted structurally with explicit read/write authorization, buffered
snapshot-to-subscribe replay, and effect-owned session attachments. Question
and approval replies use the official client-response carrier.

Run `pnpm fixture:remote-upstream -- --upstream <checkout>` from the repository
root to exercise a real authenticated dsh-remote daemon over a Unix socket.
SSH bootstrap remains a separate live-profile acceptance step.
