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

The fixture must install local tarballs into a throwaway directory and import
only package exports from that installation. It must not import
`packages/*/src`, resolve unpublished workspace peers from the registry, or
reuse a live dsh profile. Require `fixtureCleaned: true` so repeated validation
does not leak temporary installs.

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
previous-line run must use `--harness-line`; verify every version in
`harnessPackages` equals the requested line and record both exact versions.
