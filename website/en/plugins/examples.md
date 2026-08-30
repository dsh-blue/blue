# Example catalog

The repository's `examples/` directory contains one shared user kit, six
runnable opt-in plugins, and a validation bundle composing all six rows. They
are publish-shaped reference implementations, but are outside Blue's default
bundle and current release set.

::: warning Contract level of these examples
The six runnable plugins originated in PR #77 and their `blue.plugin.json`
files still use the old flat transition lane. The two providers are also
Experimental/reference only. They prove public UI, packaging, lifecycle, and
width behavior, but are **not** P1 canonical manifest templates. Copy a new
plugin manifest only from the [quickstart](/en/plugins/quickstart).
:::

| Package | Capability | Contract demonstrated |
| --- | --- | --- |
| `@dsh-blue-example/user-kit` | none | pure component library shared by two plugins; installation contributes no UI |
| `@dsh-blue-example/header` | `panes` | header lane, shared kit, narrow hiding, Fiber unload |
| `@dsh-blue-example/right-inspector` | `panes` | right lane, shared kit, narrow fallback to bottom |
| `@dsh-blue-example/bottom-log` | `panes` | passive bottom pane with no timer or background reader |
| `@dsh-blue-example/overlay` | `commands`, `overlays` | `/example-overlay`, capturing gesture, close and late-use containment |
| `@dsh-blue-example/status-provider` | `status.provider` | inert candidate; installation neither selects it nor writes settings |
| `@dsh-blue-example/editor-provider` | `editor.provider` | inert shell with exactly one host-owned `editor-control` |

Every runnable plugin ships `blue.plugin.json`, a one-row `cordis.patch.yml`,
and a public build entry. `@dsh-blue-example/blue-ecosystem` composes the six
rows in the order above; composition itself is not an eighth runtime scenario.

## Using the examples

From a source checkout, link an individual package into a dedicated profile:

```sh
pnpm run build
dsh plugin --profile blue-examples add link:/path/to/blue/examples/header
dsh --profile blue-examples
```

You can also install the composition bundle to activate all six plugins at
once. Install Blue into the same profile first, then add the
`examples/blue-ecosystem` link or packed tarball. These packages currently
serve contract validation; do not assume they are published to npm.

The status and editor providers remain inert after installation. They activate
only when the user selects `example.status.compact` or
`example.editor.focused` in `settings.yaml`; selecting `blue.default` restores
the built-in implementation. Plugins must never write those settings.

## Validation evidence

```sh
pnpm check:examples
```

The gate runs the compatibility validator on all eight packages, then on both the current and
previous Harness line it:

- packs API, UI, core, kit, six plugins, and composition with `pnpm pack`;
- installs every tarball into one temporary npm project without workspace links;
- imports only installed public exports;
- checks transition manifests, one-row patches, six-row composition, and absence of `src/` or local protocol leaks;
- runs eight scenarios plus width scans at 20/40/80/120 columns;
- requires `declared === executed === 8`, no skips or failures, and complete fixture cleanup.

Start your own plugin from the [quickstart](/en/plugins/quickstart), then use the
[public UI kit](/en/plugins/ui-kit) to extract shared components.
