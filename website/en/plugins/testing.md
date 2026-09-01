# Debugging and validation

An ordinary Cordis plugin uses ordinary test tooling. Cover at least:

1. strict TypeScript typecheck and lint;
2. a real Cordis `Context` mounting required services and the entry;
3. native dsh command/projection/tool behavior;
4. exact registry Agent identity through `blueCurrentAgent`, including null,
   selection changes, and disposal;
5. pane/status/overlay/editor-extension definitions and render output;
6. complete registration, listener, and timer cleanup on Fiber disposal;
7. async callback abort, timeout, and late results;
8. bounded UI at 20/40/80/120 columns.

Package gate:

```sh
npm pack --dry-run
```

Install the real tarball into an empty directory, import its public entry, and
verify `exports`, `types`, `files`, peer resolution, and absence of leaked
`workspace:`, `link:`, or machine-local paths.

Finally install the file snapshot into a dedicated profile and accept startup,
the primary workflow, narrow width, session switching, unload, and restart.
