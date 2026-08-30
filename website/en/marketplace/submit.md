# Submission guide

::: warning New submissions are paused
The `dsh-blue/marketplace` registry validator and existing example entry have
not yet migrated to the canonical P1–P4 contract in `0.1.1-rc.2`. Do not open a
new listing PR until that migration completes. An old `verified` value records
historical verification on the previous Host; it does not establish rc.2
compatibility.
:::

When submissions reopen, the minimum gate will match rc.2's machine contract:

- the package root points to canonical `blue.plugin.json` through `package.json.blue.manifest`;
- manifest `id` equals the package name, and `entry` is a public exports subpath;
- required/optional requests, capability versions, and exact resources pass the shared parser and validator;
- the canonical manifest uses only the seven Public Beta capabilities, not Experimental/reference facets;
- packed installation, current/previous Harness lines, Fiber unload, width scans, and a real profile have reproducible evidence;
- bilingual metadata, version, license, repository, and install sources match the actual artifact.

Until then, develop from the [quickstart](/en/plugins/quickstart) and run the
checkout-based [validation scripts](/en/plugins/testing). P5 owns the no-clone
author command, formal skill, and automated registry conformance. This page
will restore the field reference, pull-request flow, and review checklist when
those pieces are available.

[Back to the plugin marketplace](/en/marketplace/)
