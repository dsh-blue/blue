# `@dsh-blue/blue-plugin-kit`

Published P5 author tooling. The package is a CLI, not a Cordis plugin and not
part of a frontend tree. `src/create.ts` generates a local package only after
the caller explicitly chooses a persistent outcome. It reads the shipped API
schema/catalog and never carries a second capability list.

`src/cli.ts` is the injected-I/O dispatcher; `src/bin.ts` is only the executable
shim. `src/index.ts` exports the installed runtime resolver and exact Harness
fixture line used by `/plugin`. The public commands are `catalog --json`,
`create`, `validate`, and `conformance`; conformance always enables the
independent install scenario.

`runtime/validate.mjs` and `runtime/conformance.mjs` are the authoritative
implementations. The repository `script/blue-plugin-*.mjs` files are thin
compatibility entries. Validation is static and script-disabled packing is
mandatory. Conformance uses a throwaway npm project, normal peer resolution,
the exact lines listed by `supportedHarnessLines`, native ESM exports, and
always reports cleanup. `0.1.2-alpha.1` lists only Harness `0.1.2-alpha.2`;
no RC line is implied or tested. Its external fixture derives the host Cordis
range from the installed Blue API package instead of carrying a second pin.
Neither command is a security sandbox.

The generator refuses a non-empty destination and never creates a repository,
commit, tag, profile installation, or npm release. Keep `README.md` and
`README.zh.md` synchronized. Changes to the bin update package files/build
claims, installed-tarball author fixture, author skill evals, tutorial packed
fixtures, and this file together. `script/check-pack.mjs` installs the packed
API/UI/frontend/core/kit artifacts in a throwaway npm project and executes the
installed bin through create, validate, and conformance, so source-checkout
success alone is insufficient.
