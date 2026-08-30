# Plugin package specification

A canonical `0.1.1-rc.2` plugin package ships `blue.plugin.json` at its root.
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

`0.1.1-rc.2` ships the shared parser, repository validator, and packed-install fixture, but the latter two still run from a Blue checkout. P5 will provide the no-clone author commands. The current installer neither runs the fixture automatically nor provides a `--force` quarantine security boundary.

```sh
node script/blue-plugin-validate.mjs /path/to/my-plugin
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install --harness-line 0.1.1-rc.1
```

See [Debugging and validation](/en/plugins/testing) for report details and acceptance conditions. These checks are not a security sandbox; users must still trust third-party npm/GitHub code.

## Installation and creative mode

The launcher's read-only marketplace commands are `blue plugin list|search|info`. Installation mutations use `blue plugin add <spec>` and execute through the dsh profile owner. The running TUI also offers `/plugin install`; restart after installation.

Creative mode currently supports inspect/define/run/update/stop/rollback for ephemeral in-session prototypes. The deterministic "accepted prototype -> local persistent package -> validator -> dual-Harness fixture" loop belongs to P5 and is not shipped by this RC.
