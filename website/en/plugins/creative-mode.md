# Creative mode walkthrough: from session prototype to a distributable plugin

Creative mode (the `cordis` agent preset) is for turning an idea into a visible, in-session prototype before deciding how to keep it. A dynamic plugin lives only in the current dsh process and disappears on restart; a durable feature must eventually become an ordinary npm plugin package.

::: warning This page does not claim P5 is shipped
The Doudizhu case below records an earlier transition-lane workflow.
`0.1.1-rc.2` completes P1–P4, but P5's formal `blue-plugin-development` skill,
no-clone author command, and persistent-package loop are not delivered yet.
This case is not canonical rc.2 conformance evidence.
:::

## Choose the lifetime first

The recommended flow is:

```text
clarify → inspect available APIs → cordis_define → cordis_run (hot mount)
        → iterate and accept in the session → choose persistence → package, verify, publish
```

The `cordis-plugin-development` skill governs the prototype phase. It requires `cordis_inspect_list` and `cordis_inspect_query` before writing `code.host`, so Service, Event, Tool, and Provider shapes come from the running host. `cordis_define` stores an immutable Package; `cordis_run` activates it. Later changes append a Package and use `update`; `inspect_self` provides diagnostics when activation fails.

After the user accepts a prototype, this RC requires manually creating the
canonical package from the [quickstart](/en/plugins/quickstart), then running the
validator and packed fixture from a Blue checkout. The user still chooses a
local package, GitHub repository, npm release, or intentionally ephemeral
prototype. P5 will consolidate this phase into the formal
`blue-plugin-development` skill; the current prototype writes no repository
automatically and does not survive a restart.

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
legacy package, and push it to GitHub. That was not the P5 canonical generator.

### 3. Current rc.2 migration gaps

The marketplace artifact `blue-doudizhu@0.1.0` still declares the old API
range and flat capabilities, calls the removed `dock` facade, and contains
hand-rolled `charWidth`/`displayWidth` logic. It therefore cannot pass the P1
canonical validator and is not an rc.2 install example. Before its marketplace
listing returns, it must at least:

- add the package discovery pointer and a complete canonical `blue.plugin.json`;
- migrate `dock` to exact-placement `panes` and use granted facets from `opened.value.api`;
- remove custom width math and pass packed, narrow-width, real-profile, and human acceptance gates.

## From prototype to npm

Use a scratch profile while iterating:

```sh
dsh plugin --profile blue-dev add /path/to/blue-doudizhu
dsh --profile blue-dev
```

Before publishing, run static boundary validation, the packed-install fixture,
unload checks, and real-terminal dogfood from a Blue checkout. Install the
`npm pack` tarball in a throwaway profile and verify that the entry, canonical
manifest, and `cordis.patch.yml` ship. The no-clone command belongs to P5; until
then, these remain explicit checkout-based gates.

## Did this case actually use the creative-mode skills?

The historical session did call earlier skills with the names
`blue-plugin-development` and `cordis-plugin-development`, but that record
predates the P1 canonical contract. It proves that the dynamic prototype flow
was exercised; it does not establish delivery of P5's formal author skill,
generator, or conformance loop.
