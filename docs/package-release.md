# Blue package and release workflow

Blue publishes ten packages as one `0.2.0-alpha.1` lockstep release:
`api`, `ui`, `frontend`, `conversation`, `core`, `app`,
`transcript`, `interaction`, `bundle/blue`, and `cli`. The exact release
order lives in `script/package-contract.mjs`. The supported Harness line is
`0.1.2-alpha.3`.

Package manifests are the build source of truth. Concrete JavaScript exports
and bins become tsdown entries; TypeScript project references emit declarations.
Published packages contain runtime JavaScript, declarations, and explicitly
listed consumer configuration. Source, maps, workspace protocols, and local
paths must not leak.

Run:

```sh
pnpm run build
pnpm run check:lib
pnpm run check:pack
pnpm run check:examples
```

`check:pack` writes `.artifacts/pack/index.json` and ten tarballs, then runs
manifest/export/bin/protocol checks, publint, AreTheTypesWrong, package budgets,
and an external UI-kit install fixture. Release automation publishes those
exact artifacts and does not rebuild.

`@dsh-blue/blue-cli` carries archived dsh runtimes. Refresh its isolated npm
lock with `pnpm run release:lock-cli`; do not resolve it through workspace
links.

Tags execute the CI release workflow: publish verified artifacts to
`candidate`, install the exact registry versions on Linux/macOS/Windows, then
promote alpha to `alpha`, RC to `rc` and `latest`, and stable to
`latest`. Local release commands must not publish.
