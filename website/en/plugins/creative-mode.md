# Creative mode walkthrough: from session prototype to a distributable plugin

Creative mode (the `cordis` agent preset) is for turning an idea into a visible, in-session prototype before deciding how to keep it. A dynamic plugin lives only in the current dsh process and disappears on restart; a durable feature must eventually become an ordinary npm plugin package.

::: info P5 is delivered; the historical case is still not a new template
`0.1.1-rc.3` ships the formal `blue-plugin-development` skill, published
no-checkout author commands, and the local persistent-package loop. The
Doudizhu case predates the canonical contract and explains prototype iteration
only. New packages follow the machine catalog, generator, and conformance
results.
:::

## Choose the lifetime first

The recommended flow is:

```text
clarify -> inspect available APIs -> cordis_define -> cordis_run (hot mount)
        -> iterate and accept -> choose ephemeral/local/GitHub/npm
        -> catalog -> create/edit -> validate -> dual conformance -> live acceptance
```

The `cordis-plugin-development` skill governs the prototype phase. It requires `cordis_inspect_list` and `cordis_inspect_query` before writing `code.host`, so Service, Event, Tool, and Provider shapes come from the running host. `cordis_define` stores an immutable Package; `cordis_run` activates it. Later changes append a Package and use `update`; `inspect_self` provides diagnostics when activation fails.

After prototype acceptance, load the formal `blue-plugin-development` skill.
It first requires an explicit ephemeral, local, GitHub, or npm outcome; “make
it permanent” grants no external publication authority. For a local package,
the skill uses only published machine interfaces:

```sh
blue-plugin catalog --json
blue-plugin create ./my-plugin --name @acme/my-plugin
blue-plugin validate ./my-plugin
blue-plugin conformance ./my-plugin
blue-plugin conformance ./my-plugin --harness-line 0.1.1-rc.1
```

If the catalog cannot express the request, the skill stops before writing
files and returns a renderer-neutral capability proposal. It does not fall
back to Experimental surfaces, Blue private services, or raw terminal access.
GitHub and npm remain separate authorizations after the local package is green;
neither follows from prototype acceptance.

## The Blue Beta boundary

A durable plugin is an ordinary ESM package:

```text
blue-feature/
  package.json          # type: module, exports, blue.manifest, dsh.bundle.patch
  blue.plugin.json      # P1 canonical manifest
  index.js              # Cordis plugin entry
  cordis.patch.yml      # inserts the entry into a profile
```

The entry exports fixed `name`, `inject`, and `apply(ctx)` values, parses the
canonical package-root manifest, and passes it to
`ctx.bluePluginHost.open(ctx, manifest)`. The current `1.0.0-beta.1` protocol
opens `commands`, `status`, `panes`, `overlays`, `notifications.publish`, and
read-only `session.read` plus `session.projections.read`; the read capabilities
declare exact field/key resources. Generic `session.act` is gone. `open()`
returns `api`, exact `grants`, and `unavailableOptional`; every subsequent
`BlueResult` from registration, publication, or reads must be checked.
Editor/status providers and editor extensions exist only in the legacy inline
Experimental/reference lane and cannot appear in a canonical manifest.

Plugin code returns renderer-neutral `BlueUiNode`/`BlueView` data and structured actions:

- never import `pi-tui`, assemble ANSI rows, or calculate terminal width;
- never reach into owner-only services such as `blueScreen`, `blueComponents`, or private status/bottom-pane registries;
- never retain Agent/Session objects or put product state in a module singleton;
- let Blue's core adapter own width, theme, layout, and fallback behavior.

## Case study: blue-doudizhu

This case study is based on session `session-aad9fdb6-09ff-45b9-9aa0-0c7822efbcd5`. The goal was a character-card 斗地主 game in a Blue bottom pane, eventually distributed as an npm package.

### 1. Prototype in the session

The initial request called for character cards, clear turn prompts, a single-player mode with Bots, multiplayer/server options, and command-driven play. The session selected the `cordis` preset, loaded `cordis-plugin-development`, inspected the dynamic-plugin and local-LLM services, then used `cordis_define` to create `blue-doudizhu` and `cordis_run` to hot-mount it.

The historical prototype used only the public Blue facade, but it used the old
inline transition manifest. The following code explains that session and is
not a template for new plugins; use the [quickstart](/en/plugins/quickstart) for
the canonical form:

```js
return {
  name: 'blue-doudizhu',
  inject: ['bluePluginHost'],
  apply(ctx) {
    const opened = ctx.bluePluginHost.open(ctx, {
      id: 'com.example.blue-doudizhu',
      api: '^1.0.0-beta.1',
      capabilities: ['commands', 'panes', 'notifications.publish'],
    })
    if (!opened.ok) throw new Error(opened.code + ': ' + opened.message)
    opened.value.commands.register({ id: 'poker', label: '斗地主牌局', execute })
    opened.value.panes.register({ id: 'doudizhu-board', priority: 30, placement: 'bottom', render: () => renderBoard(state) })
  },
}
```

Bots reuse the host's selected model: `ctx.get('agentDefaultModel')` supplies the selection and `ctx.get('llm')` performs a streaming request. If the model is unavailable or times out, the plugin falls back to a rule-based move. No Agent session object is copied into plugin state.

### 2. Iterate from real feedback

The user first asked how to play, then reported that Bots did not move and made poor decisions. Successive immutable Packages addressed those reports and added:

1. highlighted turn and win/loss states;
2. landlord/farmer scoring and a final leaderboard;
3. visible thinking output with a 30-second countdown;
4. a toggleable card counter;
5. `/poker pause` to collapse the pane without ending the match and `/poker resume` to restore it.

Each change used `cordis_define` followed by `cordis_run update`, preserving
diagnostics and rollback paths. Only after the user explicitly requested an
upload to the `dsh-blue` organization and an npm package did that historical
session load the then-current early `blue-plugin-development`, create the
legacy package, and push it to GitHub. That was not the current canonical
generator and does not replace the rc.3 gates.

### 3. Migration gaps in the historical marketplace entry

The marketplace artifact `blue-doudizhu@0.1.0` still declares the old API
range and flat capabilities, calls the removed `dock` facade, and contains
hand-rolled `charWidth`/`displayWidth` logic. It therefore cannot pass the P1
canonical validator and is not an rc.3 install example. Before its marketplace
listing returns, it must at least:

- add the package discovery pointer and a complete canonical `blue.plugin.json`;
- migrate `dock` to exact-placement `panes` and use granted facets from `opened.value.api`;
- remove custom width math and pass packed, narrow-width, real-profile, and human acceptance gates.

## From prototype to a local package, then a publication decision

Use a scratch profile while iterating:

```sh
dsh plugin --profile blue-dev add /path/to/blue-doudizhu
dsh --profile blue-dev
```

Before entering the scratch profile, run `blue-plugin validate` and
`blue-plugin conformance` on both the current and previous Harness lines. Then
install the local directory and cover unload, restart, 120/80/40 columns, and
real-terminal dogfood. Conformance script-disables and packs the package, so it
already verifies the public entry, canonical manifest, `cordis.patch.yml`, and
dependency closure in the tarball.

Only after local acceptance may an agent create a repository, commit/tag, or
published artifact, and only when the user explicitly selected GitHub or npm.
The marketplace remains paused. Local persistence and direct pinned-source
installation do not depend on the marketplace or imply automatic listing.

## Did this case actually use the creative-mode skills?

The historical session did call earlier skills with the names
`blue-plugin-development` and `cordis-plugin-development`, but that record
predates the canonical contract. Current P5 delivery is established by the
formal skill's four eval classes, the published CLI's no-checkout pack gate,
the tutorial's dual-Harness conformance, and live profile acceptance. The
Doudizhu history itself remains none of that evidence.
