# F4 Remote SSH And Profile Dogfood - 2026-08-24

This record is automated acceptance evidence for the F4 remote runtime. It is
not user live acceptance and does not authorize a production bundle switch or
merge.

## Environment

- Blue branch: `p2/frontend-runtime`
- Upstream checkout: `/home/x/dev/dsh-remote-core`
- Upstream commit: `423c736869aad20304f470580165bc6dd82d2fbf`
- Upstream ABI: dsh/connection/host `0.1.0-rc.6`, session format `0`
- SSH transport: `127.0.0.1:22`, user `x`, key `/home/x/.ssh/id_ed25519`
- Pinned SSH host key: `SHA256:jFmAhqRr22abO63s44dOmEz/o2VCMXaXB0fFo0c+6as`
- Dedicated profile: `blue-remote-frontend-runtime`
- Production profile `blue`: not used or modified
- Upstream checkout was dirty before the run and remained read/run-only

## Daemon Fixture

The baseline and SSH commands were:

```sh
pnpm fixture:remote-upstream -- --upstream /home/x/dev/dsh-remote-core

pnpm fixture:remote-upstream -- \
  --upstream /home/x/dev/dsh-remote-core \
  --ssh \
  --ssh-host 127.0.0.1 \
  --ssh-port 22 \
  --ssh-user x \
  --ssh-private-key /home/x/.ssh/id_ed25519 \
  --ssh-fingerprint SHA256:jFmAhqRr22abO63s44dOmEz/o2VCMXaXB0fFo0c+6as
```

Both processes exited 0. The fixture starts the real upstream backend, pairs
and authenticates clients, negotiates protocol v2, and drives Blue only through
the built `@dsh-blue/blue-remote` public surface and the upstream structural
connection contract.

| Evidence | Unix | SSH |
|---|---:|---:|
| First connect | 1 ms | 258 ms |
| Intentional request timeout | 40 ms | 41 ms |
| Same-identity reconnect | 0 ms | 253 ms |
| Total | 1195 ms | 3459 ms |
| Initial seq | session-one `4`, session-two `6` | same |
| Resumed seq | `8` | `8` |
| Lease fencing | `1 -> 2` | `1 -> 2` |
| Disconnect released lease | yes | yes |
| Exit code | 0 | 0 |

The executed scenarios were multi-session snapshot/live routing, prompt and
cancel with explicit authorization, structured remote failure, timeout,
caller cancellation, question/approval response, duplicate response rejection,
writer contention/release, one-second lease expiry and stale release,
disconnect cleanup, transport loss, same-identity reconnect, sequence resume,
and late-event rejection. Timeout/cancel returned `OUTCOME_UNKNOWN`, the stale
release returned `LEASE_LOST`, and the lost transport returned
`OUTCOME_UNKNOWN` after the daemon had accepted a mutation boundary.

## Dedicated Profile

`PROFILE=blue-remote-frontend-runtime script/install-dev.sh` linked this
checkout. Its profile-local patch is:

```yaml
- insert:
    - id: blue-remote-runtime
      name: '@dsh-blue/blue-remote'
```

`dsh --profile blue-remote-frontend-runtime --dump-config` showed that row once.
The standalone pseudo-TTY command was:

```sh
(sleep 5; printf '/quit\r'; sleep 2) \
  | timeout 60 script -qec \
      "dsh --profile blue-remote-frontend-runtime" \
      /tmp/blue-remote-profile-smoke.typescript
```

It exited 0. The transcript contained alternate-screen, bracketed-paste, and
SGR mouse enable/disable pairs; it contained no uncaught error or terminal-width
overflow. A tmux run booted at `80x24`, reflowed at `42x18`, returned to
`96x32`, accepted `/quit`, and reported pane status 0. Tmux copy mode selected
and returned the row containing `Welcome to Blue!`.

The profile and the main `blue-frontend-runtime` acceptance profile remain in
place. Human acceptance is still pending; production-disabled rows and legacy
fallbacks remain unchanged.
