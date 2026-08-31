# Plugin marketplace

`0.1.2-alpha.1` provides the machine contract and Host admission for seven Public
Beta capabilities: `commands`, `status`, `panes`, `overlays`,
`notifications.publish`, `session.read`, and `session.projections.read`.

Start plugins from the canonical `blue.plugin.json` in the
[quickstart](/en/plugins/quickstart), then use the published no-checkout
`blue-plugin validate/conformance` flow in
[Debugging and validation](/en/plugins/testing). The TUI Catalog is a bounded
metadata index shipped with Blue, not a marketplace service or submission
unlock.

## Submissions

The marketplace is open — see the [submission guide](/en/marketplace/submit).
New listings enter as **Unverified** and are flipped to **Verified** by a
maintainer after compatibility acceptance. Users with an older marketplace
plugin should keep it on its original Blue version until the plugin finishes
migrating.

## Status legend

Every listed plugin is in one of three states:

- **Verified**: passed the canonical manifest and current Harness-line
  compatibility checks — one-click install from the TUI `/plugin` panel, or via
  the CLI command on the card.
- **Unverified**: installable via the CLI command, but full compatibility is
  not verified and not guaranteed.
- **Adapting**: the author is working with us on the current Harness line;
  installation is not offered yet — the card links the tracking issue where you
  can follow the progress.

While the registry migration completes, the legacy `verified` boolean is not
alpha compatibility evidence — the `status` field is authoritative.

<MarketplaceGrid />
