# Publishing a plugin

A Blue plugin is an ordinary npm package with `blue.plugin.json`. Official Blue packages are published by CI; do not run `npm publish` locally.

## Publishing

```sh
# npm publish is executed by the protected CI release workflow
```

Confirm before publishing:

- `exports` points at the build output, and the `files` whitelist covers every export target (the validate script's `package` group checks this);
- `@dsh-blue/blue-api` is in `dependencies`, `@deepseek-ai/cordis` in `peerDependencies` — the latter is provided by the host dsh installation, and bundling it into `dependencies` produces a second service instance;
- the manifest's `api` range targets the host's API line (currently `^1.0.0`). When the host's major version upgrades, `open()` fails explicitly with `BLUE_API_INCOMPATIBLE` — after the user upgrades Blue, the plugin is "refused at mount" rather than "drifting in behavior".

## User install path

```sh
blue plugin install my-scope/blue-clock
```

Then add the plugin row to the profile's `cordis.patch.yml`:

```yaml
- id: my-plugin-clock
  name: 'my-scope/blue-clock'
```

A package without a `dsh.bundle` declaration installs as a plain dependency only — the patch row is the switch that actually loads the plugin. Remember to spell out both steps for users in your README.

## Versioning policy recommendations

- **Follow Blue's preview cadence**: while Blue is on the rc line, publish your plugin with the `@rc` dist-tag too, upgrading in sync with the host;
- **Write the `api` range wide, verify strictly**: `^1.0.0` in the manifest accepts every minor of 1.x; when each new Harness/Blue line comes out, verify with the fixture's [`--harness-line`](/en/plugins/testing#fixture-the-packed-install-contract) before declaring compatibility;
- **A capability change is a minor**: adding a capability to the manifest is a compatibility-surface change that alters the `open()` result — treat it as a semver minor and state the minimum required Blue version in the changelog.

## Plugin marketplace

The [plugin marketplace](/en/marketplace/) is live: after publishing, submit a listing to [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) and users can install your plugin from the marketplace in one line (any plugin installable from GitHub qualifies — npm is not a requirement). The listing process and field reference are in the [submission guide](/en/marketplace/submit). The distribution mechanism is still an npm/GitHub source plus a patch row — keep your package independently installable (this is what the fixture verifies), and listing requires no rework of the package.
## Plugin protocol and marketplace

Published plugins must include `blue.plugin.json` and pass the static validator
and packed fixture before marketplace submission. Use `blue plugin install` or
`/plugin install`; GitHub sources must be pinned to a commit. See the [plugin
package specification](/en/plugins/manifest) and the marketplace submission guide.
