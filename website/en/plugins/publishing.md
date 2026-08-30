# Publishing a plugin

A Blue plugin is an ordinary npm package with `blue.plugin.json`. Official Blue packages are published by CI; do not run `npm publish` locally.

## Publishing

```sh
# npm publish is executed by the protected CI release workflow
```

Confirm before publishing:

- `exports` points at the build output, and the `files` whitelist covers every export target (the validate script's `package` group checks this);
- `@dsh-blue/blue-api@0.1.1-rc.2` is in `dependencies` (add `@dsh-blue/blue-ui@0.1.1-rc.2` when using its builders), while `@deepseek-ai/cordis` is in `peerDependencies`. Cordis is host-provided; bundling it as a dependency produces a second service instance;
- the canonical manifest targets `^1.0.0-beta.1` in `api`, while `compatibility.blue` and `compatibility.harness` cover only product lines proven by packed fixtures. This is a preview declaration, not a promise about future Stable `1.x`.

## User install path

```sh
blue plugin add @my-scope/blue-clock@0.1.0
```

A package declaring `package.json.dsh.bundle.patch` is composed from its bundled patch by dsh. Only a package without that declaration installs as a plain dependency and needs a manually added profile row:

```yaml
- id: my-plugin-clock
  name: 'my-scope/blue-clock'
```

The running TUI retains `/plugin install`, but do not install entries from the
old registry while the rc.2 marketplace migration is in progress. Use
`blue plugin add` above only with an explicitly rc.2-compatible package spec;
restart Blue after installation to activate the new row.

## Versioning policy recommendations

- **Follow Blue's preview cadence**: while Blue is on the rc line, publish your plugin with the `@rc` dist-tag too, upgrading in sync with the host;
- **A Beta range does not pre-claim Stable compatibility**: use `^1.0.0-beta.1` for the current Beta host, but do not infer support for every future Stable `1.x`. Re-run the fixture's [`--harness-line`](/en/plugins/testing#fixture-the-packed-install-contract) for each new Harness/Blue/API line before updating the compatibility claim;
- **A capability change is a minor**: adding a capability to the manifest is a compatibility-surface change that alters the `open()` result — treat it as a semver minor and state the minimum required Blue version in the changelog.

## Plugin marketplace

The marketplace registry and its existing verified entry still use pre-rc.2
legacy `dock`/`notifications` metadata and have not completed the canonical
P1–P4 migration. Website builds therefore remove fetched data and detail routes
and pause submissions. The old `verified` flag is not rc.2 compatibility or
conformance evidence. Cards, submissions, and one-line installation promises
return only after the registry validator and at least one plugin migrate.
