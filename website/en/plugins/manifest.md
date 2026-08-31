# Plugin package specification

A canonical `0.1.1-rc.3` plugin package ships `blue.plugin.json` at its root.
Package discovery reads only the `package.json.blue.manifest` pointer:

```json
{
  "name": "@acme/blue-clock",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./blue.plugin.json": "./blue.plugin.json"
  },
  "files": ["lib/**/*", "blue.plugin.json", "cordis.patch.yml"],
  "blue": { "manifest": "./blue.plugin.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

## Canonical manifest

Use the complete copyable manifest in the [quickstart](/en/plugins/quickstart), or the machine examples in the public [corpus](/schema/blue.plugin.v1.corpus.json). Every top-level field is required:

| Field | Contract |
| --- | --- |
| `$schema` | exactly `https://dsh-blue.dev/schema/blue.plugin.v1.schema.json` |
| `schemaVersion` | currently exactly `1` |
| `id` | must equal `package.json.name` |
| `entry` | a public package `exports` subpath such as `.` or `./blue`, never a `lib/` file path |
| `api` | Host API semver range; currently `^1.0.0-beta.1` |
| `compatibility` | required `blue`, `harness`, and `node` semver ranges |
| `capabilities` | discriminated requests split into `required` and `optional`, each with a version and applicable exact resources |

The npm package name, exported Cordis entry `name`, and `cordis.patch.yml` loader-row `id` are three independent namespaces. Only `manifest.id === package.json.name` is a distribution contract. Keeping the others aligned may simplify diagnostics, but validation does not require them to match.

## Machine contract

- the [Draft 2020-12 schema](/schema/blue.plugin.v1.schema.json) is the shape authority and sets `additionalProperties: false`;
- the [positive/negative corpus](/schema/blue.plugin.v1.corpus.json) locks schema, runtime-parser, and validator conclusions together;
- `@dsh-blue/blue-api/protocol/v1` exports the generated readonly type, schema, parser, and product/protocol map;
- `@dsh-blue/blue-api/capabilities/v1` exports the catalog and negotiator for the seven Public Beta capabilities.

Canonical `open()` admits required requests atomically and returns exact grants plus `unavailableOptional` for optional requests. A manifest carrying `$schema` never falls back to the old flat compatibility lane.

## Current validation path

The published `@dsh-blue/blue-plugin-kit` provides the machine catalog,
canonical generator, shared validator, and packed-install conformance command
without a Blue checkout. Read the catalog first, generate or edit the package,
then close both Harness lines:

```sh
blue-plugin catalog --json
blue-plugin create ./my-plugin --name @acme/my-plugin
blue-plugin validate ./my-plugin
blue-plugin conformance ./my-plugin
blue-plugin conformance ./my-plugin --harness-line 0.1.1-rc.1
```

See [Debugging and validation](/en/plugins/testing) for report details and
acceptance conditions. Conformance imports the plugin under test;
script-disabled pack is not a security sandbox, so users must still trust
third-party npm/GitHub code.

## Installation and creative mode

Bare `/plugin` opens Installed and Catalog tabs. Installed scans only packages
in the current profile that declare `package.json.blue.manifest` and exposes
Verify/Remove actions with compatible/incompatible/invalid state. Catalog opens
from a vetted bundled snapshot, then refreshes an explicit GitHub index in the
background. Only a canonical compatible manifest receives an Install action,
pinned to the resolved full commit; legacy entries remain inspectable with
Install disabled. Local `list/search/info/verify` and direct install still
accept only an existing local path/tarball, an exact npm `package@version`, or
a full-commit GitHub source. Install/remove delegates to the dsh profile owner
and activates only after restart; it never replaces the live tree.

Creative mode retains inspect/define/run/update/stop/rollback for ephemeral
prototypes. After acceptance, the formal `blue-plugin-development` skill first
requires an explicit ephemeral/local/GitHub/npm outcome. The local path closes
the deterministic `catalog -> create -> validate -> dual conformance` loop.
Prototype acceptance never authorizes a repository, commit, tag, or npm
release. The TUI Catalog is not the Website Marketplace: marketplace cards,
routes, and submissions remain paused.
