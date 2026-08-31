# Plugin marketplace

::: warning Marketplace migration for alpha.1
The marketplace registry still uses the transition contract from before P1–P4.
The pinned `dsh-blue/blue-doudizhu@0.3.0` commit has the earlier RC canonical
manifest but does not declare Harness `0.1.2-alpha.2`, so `/plugin` correctly
marks it incompatible pending its own migration. This page still hides install
cards and does not treat the existing `verified` flag as alpha compatibility evidence.
:::

`0.1.2-alpha.1` provides the machine contract and Host admission for seven Public
Beta capabilities: `commands`, `status`, `panes`, `overlays`,
`notifications.publish`, `session.read`, and `session.projections.read`. The
marketplace will reopen after two migrations are complete:

1. the registry validator adopts the P1 canonical schema, required/optional requests, and exact resources;
2. the migrated plugin completes human acceptance and its manifest, packed-fixture, and real-profile evidence enters submission governance.

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
version. The migrated `@dsh-blue/blue-doudizhu@0.3.0` can be installed exactly
from the TUI Catalog or npm, but that does not reopen Website submissions.
