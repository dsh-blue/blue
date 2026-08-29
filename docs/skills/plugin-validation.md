# Plugin Validation Skill

The loadable repository skill is `.agents/skills/plugin-validation/SKILL.md`.
This page is its human-facing summary.

`node script/blue-plugin-validate.mjs <package>` performs the static boundary
audit and verifies the v1 discovery pointer, shared manifest parser, selected
native-ESM public export closure, exact package self-references, TypeScript
declaration resolution, script-disabled actual tarball file list, package-local
real paths, host-owned Cordis peer placement, recursive runtime peers, and
Fiber lifecycle marker. Module syntax and triple-slash directives are parsed
with TypeScript; statically provable `require`/`createRequire` aliases are
followed, while opaque loads, package-import aliases, and pattern
self-references fail closed because their public closure is not machine-auditable.
`apply` must be a callable export and lifecycle evidence must be reachable from it.
`<package>` may be a directory outside the Blue workspace; the packed fixture
accepts the same target and reports every installed Harness instance.
P1 still runs these commands from a Blue checkout; distribution of the
no-clone author runner remains an R2 exit gate.
Run it together with the full Blue gate and `script/install-dev.sh` against a
tagged non-production profile. Record the profile name, Harness line, width
scenarios, fallback result, and unload/late-result result in the fixture log.
