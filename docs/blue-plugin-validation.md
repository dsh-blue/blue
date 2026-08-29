# Blue Plugin Validation

This is the repeatable F6 acceptance checklist for plugins that consume the
Blue frontend runtime.

## Development and migration

Classify each contribution as Domain, Interaction, Renderer, or Composition;
record its host/agent/session/frontend scope; and keep the renderer adapter in
its own package. Migration review must flag direct pi-tui/ANSI/DOM imports,
session-event folding, module singletons, implicit bundle dependencies, and
missing Fiber cleanup. The replacement must expose a plain model fallback and
an explicit capability check.

`blue-plugin-validate.mjs` accepts both source-form ESM exports and equivalent
tsdown output where `name`/`apply` are declared first and collected in a
trailing `export { ... }` statement. This validates packed runtime shape
without requiring one bundler's textual formatting. It does not relax the
stable `name`, exported `apply`, public `lib` entry, manifest, or Fiber-owned
lifecycle requirements.

## Fixture contract

An independent-install fixture packs the target and its complete local
workspace closure, installs all external peers in a throwaway npm project, and
loads only installed package exports. It verifies headless projection, TUI
rendering, provider swap, unload/reload, stale-result rejection, abort, and
width scans at 20, 40, 80, and 120 columns. The fixture must not import
`packages/*` source paths. Acceptance requires `declared` and `executed` to be
identical with empty `skipped` and `failures` arrays.

Run the current and previous supported Harness contracts without changing the
repository pins:

```sh
node script/blue-plugin-fixture.mjs <package> --install
node script/blue-plugin-fixture.mjs <package> --install --harness-line 0.1.1-rc.1
```

The compatibility form discovers every `@deepseek-ai/dsh-*` dependency, peer,
and optional dependency recursively from npm metadata, pins the complete set
as root dependencies and overrides, then scans every nested `node_modules`
instance for the exact requested line. `--legacy-peer-deps` may permit an old
line to install against newer packed peer ranges, but is never compatibility
evidence by itself. The JSON report includes `harnessLine`, the actual
`harnessPackages` versions, and a reproduction command. A mismatch is
`FIXTURE_HARNESS_LINE_MISMATCH`.
The temporary project is removed before the report returns; `fixtureCleaned`
must be `true`.

The `blue-harness-adapter` target adds an eighth installed-package scenario,
`locale.preference-live-reload-unload`. It verifies persisted preference boot,
live updates, settings-provider unload/reload, and final locale-service unload
on both supported Harness lines.

W5-C's downstream ecosystem has a whole-suite gate in addition to the generic
single-package fixture:

```sh
pnpm check:examples
```

It validates the user kit, six runnable plugins, and their composition bundle,
then packs the complete Blue host runtime dependency closure plus the full
example closure into one independent npm project on both the current and
previous Harness lines. The composition's packed `@dsh-blue/blue` peer must be
an exact installed tarball version and resolve from a resolver rooted at the
installed composition, including the host's public entry; a fixture-root
import or `--legacy-peer-deps` is not evidence of peer closure.

Acceptance requires the exact seven-scenario declared list to equal the
executed list, empty `skipped`/`failures`, recursively exact installed Harness
versions, and both `cleaned` and `fixtureCleaned` set to `true`. The user kit
has no plugin manifest or capability. Each runnable plugin's packed manifest
must match its fixed expected capability list and its runtime `open()` request.
All six consumers execute capability-absent and admitted paths; absent paths
must leave no partial registration. The overlay path additionally proves that
rejection for missing `overlays` does not consume its owner-minted gesture.

## Ecosystem audits

- `dsh-openpencil`: absent renderer capabilities keep the domain plugin active,
  while the Blue adapter exposes a plain fallback and unloads all providers.
- `dsh-lark`: actions are capability-gated and notifications are projected as
  renderer-neutral models; duplicate notification keys are collapsed and all
  subscriptions are disposed with the plugin Fiber.

Automated acceptance also requires `pnpm run typecheck`, `pnpm run lint`,
`pnpm run test:coverage`, `pnpm run build`, `pnpm run check:lib`, and
`pnpm run smoke:happy` in the repository. Product acceptance additionally
requires the dedicated non-production profile smoke and explicit user live
acceptance; the packed fixture does not replace that gate.
