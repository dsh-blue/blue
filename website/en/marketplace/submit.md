# Submission guide

::: warning New submissions are paused
The `dsh-blue/marketplace` registry validator and existing example entry have
not yet migrated to the canonical P1–P4 contract in `0.1.2-alpha.1` and its sole Harness `0.1.2-alpha.2` support line. Do not open a
new listing PR until that migration completes. An old `verified` value records
historical verification on the previous Host; it does not establish rc.3
compatibility.
:::

When submissions reopen, the minimum gate will match rc.3's machine contract:

- the package root points to canonical `blue.plugin.json` through `package.json.blue.manifest`;
- manifest `id` equals the package name, and `entry` is a public exports subpath;
- required/optional requests, capability versions, and exact resources pass the shared parser and validator;
- the canonical manifest uses only the seven Public Beta capabilities, not Experimental/reference facets;
- packed installation, the supported Harness line, Fiber unload, width scans, and a real profile have reproducible evidence;
- bilingual metadata, version, license, repository, and install sources match the actual artifact.

Until then, develop from the [quickstart](/en/plugins/quickstart) and run the
published no-checkout author commands and formal skill from
[Debugging and validation](/en/plugins/testing). Visibility in the TUI Catalog
does not establish a marketplace listing. This page will restore the field
reference, pull-request flow, and review checklist after the registry adopts
canonical automated conformance.

[Back to the plugin marketplace](/en/marketplace/)
