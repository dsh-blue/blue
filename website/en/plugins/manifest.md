# Plugin Package Specification

Published Blue plugins must include `blue.plugin.json` at the package root and declare it from `package.json`:

```json
{ "blue": { "manifest": "./blue.plugin.json" } }
```

The manifest requires `schemaVersion`, `id`, `entry`, `api`, and `capabilities`, and should declare `blue`, `harness`, and `node` compatibility ranges. The `id` must match the npm package name, the entry point's exported `name`, and the loader name in `cordis.patch.yml`.

The installer checks the manifest, exports/files, static boundaries, packed fixture, lifecycle, and width behavior before activation. Failed validation is rejected by default; `--force` only places the package in quarantine and never auto-loads it. Validation is not a security sandbox: third-party npm/GitHub code still requires trust.

## Install and Search

```sh
blue plugin search doudizhu
blue plugin info @dsh-blue/blue-doudizhu
blue plugin install @dsh-blue/blue-doudizhu
```

The running Blue process supports `/plugin search`, `/plugin info`, and `/plugin install`; restart Blue after installation to activate it. GitHub sources must be pinned to a commit, for example `github:dsh-blue/blue-doudizhu@<sha>`.

## Creative Mode

Use `cordis-plugin-development` to validate a prototype, then `blue-plugin-development` to produce the persistent package, and finally run `blue-plugin-validate` and the packed fixture. See the [Creative mode walkthrough](/en/plugins/creative-mode).
