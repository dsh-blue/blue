# @dsh-blue/blue-remote

Headless F4 session runtime for Blue. It provides a multi-session projection
registry, current-session binding, and a narrow `RemoteTransport` proxy for
dsh-remote-style negotiate, sequence resume, write lease, action, and
question/approval capabilities.

The package does not import TUI or terminal APIs. A real daemon transport can
implement `RemoteTransport`; the included tests are the deterministic protocol
fixture used by the Blue gates.
