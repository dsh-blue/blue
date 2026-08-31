# Debugging and validation

This page covers the local iteration loop and the two mechanical pre-publish
gates: static boundary validation (`validate`) and independent packed install
(`conformance`). Both commands ship in `@dsh-blue/blue-plugin-kit`; no Blue
repository checkout is required.

## Install the tool and read the machine contract

```sh
npm install --global @dsh-blue/blue-plugin-kit@0.1.2-alpha.1
blue-plugin catalog --json
```

The catalog is authoritative for capability names, versions, resources,
quotas, Blue/API versions, and the supported Harness lines. This release lists
only `0.1.2-alpha.2`, with no RC line. Read it before generating a package:

```sh
blue-plugin create ./my-blue-plugin --name @acme/my-blue-plugin
```

## Iteration loop

```text
edit -> rebuild your package -> restart a scratch profile
```

A link install points at the package directory, so rebuilt output takes effect
without reinstalling. Run `dsh plugin --profile <name> add` again only after a
dependency-graph change. Profile mutation remains owned by dsh; Blue never
hot-replaces a persistent plugin inside the running Cordis tree.

Headless smoke check through a pseudo-TTY:

```sh
(sleep 10; printf '/now\r'; sleep 2; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue-my-plugin" /tmp/my-plugin-smoke.typescript
```

The recording should contain the plugin's observable result, a clean process
exit, bracketed-paste shutdown, and no terminal-width overflow.

## validate: static boundary checks

```sh
blue-plugin validate /path/to/my-plugin
```

The JSON report groups checks as follows:

| Group | Checks |
| --- | --- |
| `package` | canonical manifest, package identity/entry/exports, the `files` plus script-disabled `npm pack` closure, and direct peer/dependency closure |
| `architecture` | renderer/raw-terminal dependencies stay behind their boundary; no Agent/Session package-internal imports; frontend code does not fold Harness session events |
| `lifecycle` | the entry has observable Fiber-lifecycle or registration-ownership markers |

A green `validate` result proves static package boundaries only. It neither
executes the plugin nor acts as a security review.

## conformance: independent packed-install contract

```sh
blue-plugin conformance /path/to/my-plugin
blue-plugin conformance /path/to/my-plugin --harness-line 0.1.2-alpha.2
```

`conformance` script-disables and packs the plugin, installs it with normal
peer resolution in a throwaway npm project, and loads only public exports. It
then verifies Host admission, widths 20/40/80/120, Fiber unload,
capability-absent fallback, output/timeout fencing, and cleanup. The default is
the catalog's sole Harness line; the explicit form pins that same exact version
in the report.

A passing report requires:

- `declared` exactly equals `executed`;
- `skipped` and `failures` are empty;
- `peerResolution` is `normal`;
- every `harnessPackages` entry equals the requested exact version;
- cleanup succeeds.

This command imports and executes the package under test. Script-disabled pack
blocks lifecycle scripts but is not a security sandbox; run it only on trusted
source.

## Unload and real-profile checks

Install the verified local package in a dedicated profile:

```sh
dsh plugin --profile blue-my-plugin add file:/path/to/my-plugin
dsh --profile blue-my-plugin
```

Local directories use a `file:` snapshot so pnpm materializes the plugin's own
dependency closure. Reinstall after every source change and then restart. A
dependency-blind `link:` is not valid independent-plugin acceptance evidence.

Exercise its core path at 120/80/40 columns, then remove it and restart. Every
command, status item, pane, and overlay must disappear. Residue usually means a
registration bypassed the Fiber-owned API returned by `open()`, or mutable
state escaped into a module singleton.

Before release, close `catalog --json`, `validate`, supported-Harness
`conformance`, unload, headless smoke, and live-terminal acceptance. The user
must still choose the distribution destination; green validation never
authorizes creating a GitHub repository or publishing to npm. The marketplace
remains paused; see [Publishing](/en/plugins/publishing).
