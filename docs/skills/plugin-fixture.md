# Plugin Fixture Skill

An independent fixture must install the published package (or a packed tarball)
into a throwaway profile. It exercises headless projection replay/resume,
action abort and stale-result rejection, provider swap/fallback, TUI width
scans at 20/40/80/120 columns, and Fiber unload followed by a late event.

Use `node script/blue-plugin-fixture.mjs <package-dir> --install` to pack and
install the package into a throwaway directory. The runner imports package
exports, never `packages/*/src` paths, and executes the public
`FrontendHost` lifecycle contract when that export is present (publish,
failure fallback, unload, and late-result rejection). Projection/action and
width scenarios still require package-specific fixture assertions; the JSON
report distinguishes those from the generic checks so a manifest is not
mistaken for full coverage.
