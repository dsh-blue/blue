# @dsh-blue/blue-remote

Headless F4 session runtime for Blue. It provides a multi-session projection
registry, current-session binding, and a narrow `RemoteTransport` proxy for
dsh-remote-style negotiate, sequence resume, write lease, action, and
question/approval capabilities.

The package does not import TUI or terminal APIs. Official connections are
adapted structurally with explicit read/write authorization, buffered
snapshot-to-subscribe replay, generation-fenced session attachments, and
bounded official requests. Question and approval replies use the official
client-response carrier and reject duplicate or malformed acceptance bodies.
Writer lease acquisition/release is deduplicated per connection generation;
expired or late grants are released, and background cleanup failures can be
reported through the adapter diagnostic callback.
Remote mutations use the package-owned `RemoteSessionAction` vocabulary through
`CurrentSessionBinding.execute()`; the readonly session bridge does not expose a
generic Blue plugin action facade.

Run `pnpm fixture:remote-upstream -- --upstream <checkout>` from the repository
root to exercise a real authenticated dsh-remote daemon over a Unix socket. To
run the same scenarios through fingerprint-pinned SSH forwarding, add:

```sh
--ssh --ssh-host <host> --ssh-user <user> \
  --ssh-private-key <path> --ssh-fingerprint <SHA256:...>
```

The SSH fingerprint must be supplied explicitly. The fixture never scans or
automatically trusts a host key. Human live-profile acceptance remains a
separate gate.
