# Plugin Fixture Skill

The loadable repository skill is `.agents/skills/plugin-fixture/SKILL.md`.
This page is its human-facing summary.

An independent fixture must install the published package (or a packed tarball)
into a throwaway profile. It exercises headless projection replay/resume,
action abort and stale-result rejection, provider swap/fallback, TUI width
scans at 20/40/80/120 columns, and Fiber unload followed by a late event.

Use `node script/blue-plugin-fixture.mjs <package-dir> --install` to pack and
install a workspace or external package into a throwaway directory. Packing
and installation disable lifecycle scripts. The runner imports package exports
through Node's native ESM conditions, never `packages/*/src` paths, and
executes the public
`FrontendHost` lifecycle contract when that export is present (publish,
failure fallback, unload, and late-result rejection). Projection/action and
width scenarios still require package-specific fixture assertions; the JSON
report distinguishes those from the generic checks so a manifest is not
mistaken for full coverage.

For the previous supported Harness ABI, append
`--harness-line <exact-version>`. The runner recursively pins Harness
dependencies, optional dependencies, and peers in the temporary install only.
It reports the complete name summary under `harnessPackages` and every nested
path/version under `harnessPackageInstances`, then rejects any instance off the
requested line. Workspace manifests and the lockfile remain unchanged.
Successful and failed runs remove the throwaway install and report
`fixtureCleaned: true`.

This P1 runner is repository-owned and still starts from a Blue checkout. The
published no-clone runner remains an explicit R2 exit gate rather than a P1
release claim.
