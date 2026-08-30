# Plugin marketplace

::: warning Marketplace migration for rc.2
The marketplace registry and its first example plugin still use the transition
contract from before P1–P4. No current entry has completed the canonical
`0.1.1-rc.2` migration. To prevent an old plugin from being installed into an
rc.2 profile, this page temporarily hides install cards and does not treat the
existing `verified` flag as rc.2 compatibility evidence.
:::

`0.1.1-rc.2` publishes the machine contract and Host admission for seven Public
Beta capabilities: `commands`, `status`, `panes`, `overlays`,
`notifications.publish`, `session.read`, and `session.projections.read`. The
marketplace will reopen after two migrations are complete:

1. the registry validator adopts the P1 canonical schema, required/optional requests, and exact resources;
2. at least one plugin passes the rc.2 manifest, packed fixture, real profile, and human acceptance gates.

For now, start plugins from the canonical `blue.plugin.json` in the
[quickstart](/en/plugins/quickstart), then run the checkout-based checks in
[Debugging and validation](/en/plugins/testing). P5's no-clone author tooling
and final marketplace loop are not part of this RC.

## Submission status

New submissions are temporarily paused. This page will restore cards and the
[submission workflow](/en/marketplace/submit) after the registry migration.
Users with an older marketplace plugin should keep it on its original Blue
version and not depend on it from an rc.2 profile until that plugin migrates.
