---
name: plugin-fixture
description: Build or run an independent packed-install contract fixture for a Blue frontend plugin. Use for projection replay/resume, action abort/stale rejection, provider swap/fallback, unload/late events, width scans, or local tarball peer closure; do not use for ordinary unit tests.
---

# Exercise A Packed Plugin

Build the workspace first, then run:

```sh
node script/blue-plugin-fixture.mjs <package-dir> --install
node script/blue-plugin-fixture.mjs <package-dir> --install --harness-line <previous-exact-version>
```

The fixture must pack with lifecycle scripts disabled, install local tarballs
into a throwaway directory, and import only package exports from that
installation through Node's native ESM loader. External plugin entry imports
run in a short-lived probe process; unexpected stdout/stderr, early exit, and
timeout fail closed while the parent always emits one JSON report and cleans
the fixture. Export resolution must exercise
the ordered Node conditions (including `module-sync` when declared), not a
hand-selected `import` target or a directory/source shortcut. It must not
import `packages/*/src`, resolve unpublished workspace peers from the registry,
or reuse a live dsh profile. Require `fixtureCleaned: true` so repeated
validation does not leak temporary installs.

Require executed evidence for every scenario declared in the JSON report:

- projection baseline plus replay/resume and duplicate-sequence rejection;
- structured action success, caller abort, session/request stale rejection;
- provider swap, activation failure to plain fallback, unload, and late
callback rejection;
- renderer width scans at 20, 40, 80, and 120 columns using core's width
  truth;
- package-specific capability-absent and domain/adapter unload behavior.

On failure, preserve the machine-readable report fields `package`, `scenario`,
`code`, `message`, and `reproduce`. A scenario listed only under `declared` or
`skipped` is not acceptance evidence. For compatibility work, run the same
contract against the current and previous supported Harness lines. The
previous-line run must use `--harness-line`; recursively inspect dependency,
optional-dependency, and peer closures and verify every installed
`@deepseek-ai/dsh-*` package instance equals the requested line. Record the
per-instance paths and exact versions, not only a name-to-version summary.
