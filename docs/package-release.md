# Blue package and release workflow

Blue publishes seven packages as one lockstep release. Build output is generated from the package manifests: runtime exports and `bin` entries are the tsdown inputs, while TypeScript emits declarations into the ignored build cache. Published packages contain runtime JavaScript, declarations, and only the configuration or documentation required by consumers; source files, intermediate JavaScript, and maps are not distribution artifacts.

Run the local release gates in this order:

```sh
pnpm build
pnpm check:lib
pnpm check:pack
```

`check:pack` creates `.artifacts/pack/index.json` and seven tarballs. It runs `publint`, AreTheTypesWrong, manifest checks, bin checks, dependency protocol checks, shrinkwrap checks, and package-size budgets. Release automation consumes those exact tarballs; it never rebuilds a second copy.

`@dsh-blue/blue-cli` carries an npm shrinkwrap for its nested dsh host. Update it only with `pnpm release:lock-cli`, which resolves in an isolated npm project so pnpm workspace links cannot leak into the published lock. The profile itself remains a dsh-managed pnpm workspace: install `pnpm@11` before first `blue` boot or an upgrade. A matching profile starts without a repeated pnpm check.

Tags run the CI-only release workflow. It publishes each verified tarball to `candidate`, installs the exact registry versions on Linux, macOS, and Windows, then promotes `rc` and `latest`. The current credential is a granular npm token stored as the repository `NPM_TOKEN` Actions secret; the auth step is intentionally isolated so it can later be replaced by npm Trusted Publishing/OIDC without changing build, verification, or promotion behavior. npm may refuse deleting the temporary `candidate` tag, so cleanup is best-effort after the stable tags converge.
