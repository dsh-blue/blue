# `@dsh-blue/blue-app`

Repo-wide rules live in the root [AGENTS.md](../../AGENTS.md).

App owns process startup, current-Agent selection, session navigation, request
lifecycle, retraction, exit epitaph, and the temporary all-prompt title cadence
bridge. It consumes native Harness `agents` and `sessionController`
services. It does not expose session reader/action/projection facades.

`blueCurrentAgent` returns the exact live Agent selected by this frontend
tree. Selection must be a current member of `ctx.agents`; Agent disposal
clears it. Subscribers receive immediate replay and monotonic revisions.
App owns selection only, not Agent behavior.

Navigation requests serialize through one queue. A new selection is committed
only after native resolution succeeds; failure retains the previous Agent and
writes one diagnostic. Startup task submission begins request lifecycle before
calling `Agent.followup`.

Consumers use native dsh services with the selected Agent or its Session.
Do not recreate adapters, snapshots, action coordinators, model reference
copies, or compatibility exports.

Changes to startup, selection, navigation, request transitions, retraction, or
title cadence require the full app suite, bundle e2e, `pnpm run verify:full`,
and dedicated-profile acceptance.
