# Submission guide

The marketplace is open for submissions. Listing a plugin means opening a PR against [`dsh-blue/marketplace`](https://github.com/dsh-blue/marketplace); the website rebuilds within minutes of the merge (with a daily scheduled rebuild as a fallback).

## Submission statuses

Every plugin is in one of three states, shown as the badge on its card:

- **Verified** (`verified`): passed the machine contract below plus human acceptance — one-click install from the TUI `/plugin` panel;
- **Unverified** (`unverified`): installable via CLI, but full compatibility is not yet verified — **new listings enter in this state**;
- **Adapting** (`adapting`): the author is working with the maintainers on the current Harness line; the entry must link an `adaptingIssue` tracking issue.

## Submission flow

1. Develop the plugin from the [quickstart](/en/plugins/quickstart); the package root points to a canonical `blue.plugin.json` through `package.json.blue.manifest`;
2. Run the published no-checkout `blue-plugin validate/conformance` flow from [Debugging and validation](/en/plugins/testing);
3. Fork `dsh-blue/marketplace`, add an entry to `registry.json` (fields documented in that repo's README; new listings use `status: "unverified"`), and provide bilingual detail pages at `content/<id>/zh.md` and `en.md`;
4. Open the PR; the repo's validate CI checks the field whitelist, id uniqueness, and bilingual content completeness;
5. After maintainer review the PR is merged; entries that complete compatibility acceptance are flipped to `verified` by a maintainer.

## The "verified" bar

- the manifest `id` equals the package name, and `entry` is a public exports subpath;
- required/optional requests, capability versions, and exact resources pass the shared parser and validator;
- the canonical manifest uses only the seven Public Beta capabilities, not Experimental/reference facets;
- packed installation, the supported Harness line, Fiber unload, width scans, and a real profile have reproducible evidence;
- bilingual metadata, version, license, repository, and install sources match the actual artifact.

[Back to the plugin marketplace](/en/marketplace/)
