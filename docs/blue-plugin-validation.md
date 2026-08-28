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

The compatibility form installs every `@deepseek-ai/dsh-*` peer discovered in
the packed closure at the exact requested line. Its JSON report includes
`harnessLine`, the actual `harnessPackages` versions, and a reproduction
command. A mismatch is `FIXTURE_HARNESS_LINE_MISMATCH`.
The temporary project is removed before the report returns; `fixtureCleaned`
must be `true`.

W5-C's downstream ecosystem has a whole-suite gate in addition to the generic
single-package fixture:

```sh
pnpm check:examples
```

It validates the user kit, six runnable plugins, and their composition bundle,
then packs API/UI/core plus the full example closure into one independent npm
project on both the current and previous Harness lines. Acceptance requires
the exact seven-scenario declared list to equal the executed list, empty
`skipped`/`failures`, exact installed Harness versions, and both `cleaned` and
`fixtureCleaned` set to `true`. The user kit has no plugin manifest or
capability; each runnable consumer retains its own admission and unload checks.

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
