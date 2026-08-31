# Plugin marketplace

::: warning Marketplace migration for rc.3
The marketplace registry and its first example plugin still use the transition
contract from before P1–P4. No current entry has completed the canonical
`0.1.1-rc.3` migration. Bare `/plugin` indexes
`dsh-blue/blue-doudizhu` in its TUI Catalog, but labels it Needs migration and
disables Install. This page still hides install cards and does not treat the
existing `verified` flag as rc.3 compatibility evidence.
:::

`0.1.1-rc.3` provides the machine contract and Host admission for seven Public
Beta capabilities: `commands`, `status`, `panes`, `overlays`,
`notifications.publish`, `session.read`, and `session.projections.read`. The
marketplace will reopen after two migrations are complete:

1. the registry validator adopts the P1 canonical schema, required/optional requests, and exact resources;
2. at least one plugin passes the rc.3 manifest, packed fixture, real profile, and human acceptance gates.

For now, start plugins from the canonical `blue.plugin.json` in the
[quickstart](/en/plugins/quickstart), then use the published no-checkout
`blue-plugin validate/conformance` flow in
[Debugging and validation](/en/plugins/testing). The TUI Catalog is a bounded
metadata index shipped with Blue, not a marketplace service or submission
unlock.

## Submission status

New submissions are temporarily paused. This page will restore cards and the
[submission workflow](/en/marketplace/submit) after the registry migration.
Users with an older marketplace plugin should keep it on its original Blue
version and not depend on it from an rc.3 profile until that plugin migrates.
