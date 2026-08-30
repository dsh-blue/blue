# Debugging & validation

This page covers a plugin's local iteration loop and the two mechanical pre-publish verifications: the static boundary check (validate) and the packed-install fixture.

::: warning Tooling boundary in `0.1.1-rc.2`
Both commands below can validate a plugin directory outside the workspace, but the runners still live in the Blue repository, so they require a Blue clone/checkout. P5 will provide installable no-clone author commands. This page does not present the current scripts as a published CLI.
:::

## Iteration loop

```text
改代码 → 重新构建你的包 → 重启 profile
```

A link install points at the package directory, so rebuilt output takes effect directly with no reinstall; only a dependency-graph change (adding a dependency) needs another `dsh plugin --profile <name> add`.

Headless smoke check (pseudo-TTY via `script(1)`, no manual keystrokes needed):

```sh
(sleep 10; printf '/now\r'; sleep 2; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue-dev" /tmp/my-plugin-smoke.typescript
```

You can grep your command's output in the recording file `/tmp/my-plugin-smoke.typescript` and assert the plugin actually ran.

## Unload-semantics check

Fiber-bound registration is the core promise of the plugin model and deserves one verification after every major change:

1. remove your plugin row from the profile's `cordis.patch.yml`;
2. restart the profile;
3. your commands, status entries, panes, and overlays should all disappear, leaving no residue.

If residue remains, some registration bypassed the API returned by `open()` (registering straight onto a Harness service, a module-level singleton, etc.) — troubleshoot against [Core concepts](/en/plugins/concepts#design-discipline).

## validate: static boundary checks

The Blue repository ships a static validation script (run it from a clone of the Blue repo):

```sh
node script/blue-plugin-validate.mjs /path/to/my-plugin
```

It prints a JSON report in three groups:

| Group | Checks |
| --- | --- |
| `package` | canonical manifest schema/semantics, `id === package.json.name`, public entry export, the `files` plus real `npm pack` closure, a literal entry `name` and callable `apply`, and direct peer/dependency closure |
| `architecture` | renderer/raw-terminal dependencies must not appear outside core; renderer-neutral packages must not depend on renderer-specific APIs; no cross-boundary imports of Agent/Session packages; the frontend does not fold Harness session events |
| `lifecycle` | the plugin entry has observable Fiber-lifecycle or registration-ownership markers (`ctx.effect` / `.dispose` / `.register` / `.subscribe`) |

## fixture: the packed-install contract

validate is static; the fixture actually packs and loads your plugin in a **throwaway npm project**, verifying the independent-install scenario:

```sh
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install
# Pin the previous Harness line for compatibility evidence:
node script/blue-plugin-fixture.mjs /path/to/my-plugin --install --harness-line 0.1.1-rc.1
```

- `--install` is the switch for the independent scenario — without it the fixture only does shallow checks;
- the `--harness-line` version override applies only inside the throwaway project and never pollutes your checkout; the report's `harnessPackages` field lists the actually resolved version of every Harness package, and all of them should equal the line you specified.
- a passing report requires `declared` to equal `executed`, empty `skipped`/`failures`, and cleanup of the throwaway project.

The problems the fixture finds are almost always of the kind "fine inside the monorepo, broken on an independent install": undeclared peers, build output missing from `files`, versions depending on the workspace protocol.

## Pre-publish checklist

1. all three `validate` groups green;
2. `fixture --install` passes, and (if you want compatibility with multiple Harness lines) run it once per line;
3. the unload-semantics check passes;
4. core paths clicked through by hand in a real profile (dogfood).

Then you are ready to [publish](/en/plugins/publishing).
