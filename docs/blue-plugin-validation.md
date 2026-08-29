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

For a v1 package, `package.json.blue.manifest` is the only discovery pointer.
The validator runs the public `./protocol/v1` parser, checks package identity,
the selected exports key, the `files` whitelist, an actual `npm pack` file
list, and direct runtime dependency/peer closure. Host-owned
`@deepseek-ai/cordis` must be a required peer and must not appear in
`dependencies` or `optionalDependencies`, which would permit a second service
instance. Conditional exports follow Node's ordered ESM conditions, including
`module-sync`.

JavaScript/TypeScript module syntax and triple-slash directives are parsed with
the TypeScript parser. The closure follows relative imports, exact package
self-references, explicit `types` conditions, root `types`/`typings`, and
adjacent declaration substitution. Every selected runtime/declaration file
must remain inside the package and appear in the tarball; complex `files` globs
defer to the authoritative pack list. Non-literal loads, `#imports`, pattern
self-references, absolute/file imports, and URL modules fail closed because
their complete public closure cannot be proven. Architecture checks walk only
that selected closure, and known `require`/`createRequire` aliases are followed
only when their module target is statically provable; opaque loader aliases are
rejected. The exported `apply` must be statically callable, and its lifecycle
marker must be reachable from that function (unreachable branches do not count),
so an existing package may retain a separate Web renderer without exposing
DOM/React state to Blue. The old flat Beta
distribution manifests remain an explicit transition lane until P2/P3 move
the existing examples and host admission; a manifest carrying `$schema` never
falls back to that lane.

## Fixture contract

An independent-install fixture accepts either a Blue workspace package or an
absolute package directory outside the workspace. It packs the target and its
complete production local Blue closure (`dependencies`, optional dependencies,
and peers; never development-only dependencies), installs all external peers in a throwaway npm
project, and loads only installed package exports through native ESM
conditions. All pack and install lifecycle scripts are disabled. An external v1
package adds `plugin.public-entry-packed-load`, which reparses the installed
manifest and imports its selected public entry from the tarball in a short-lived
probe process. Probe stdout/stderr, early exit, and timeout are fail-closed and
cannot corrupt the parent report; the remaining
scenarios verify headless projection, TUI rendering, provider swap,
unload/reload, stale-result rejection, abort, and
width scans at 20, 40, 80, and 120 columns. The fixture must not import
`packages/*` source paths. Acceptance requires `declared` and `executed` to be
identical with empty `skipped` and `failures` arrays.

In P1 these repository commands still execute from a Blue checkout. Accepting
an external package path is not yet the published, no-clone author runner
required by the R2 exit gate; that distribution remains pending and must be
closed no later than P4.

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
evidence by itself. The JSON report includes `harnessLine`, the complete
`harnessPackages` summary, every nested path/version in
`harnessPackageInstances`, and a reproduction command. A mismatch is
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
