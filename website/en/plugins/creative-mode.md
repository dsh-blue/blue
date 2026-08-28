# Creative mode walkthrough: from session prototype to a distributable plugin

Creative mode (the `cordis` agent preset) is for turning an idea into a visible, in-session prototype before deciding how to keep it. A dynamic plugin lives only in the current dsh process and disappears on restart; a durable feature must eventually become an ordinary npm plugin package.

## Choose the lifetime first

The recommended flow is:

```text
clarify → inspect available APIs → cordis_define → cordis_run (hot mount)
        → iterate and accept in the session → choose persistence → package, verify, publish
```

The `cordis-plugin-development` skill governs the prototype phase. It requires `cordis_inspect_list` and `cordis_inspect_query` before writing `code.host`, so Service, Event, Tool, and Provider shapes come from the running host. `cordis_define` stores an immutable Package; `cordis_run` activates it. Later changes append a Package and use `update`; `inspect_self` provides diagnostics when activation fails.

After the user accepts the prototype, load `blue-plugin-development` and choose the durable outcome: a local package, a GitHub repository, an npm release, or an intentionally ephemeral prototype. The skill does not create files, commits, tags, or releases before that choice.

## The stable Blue boundary

A durable plugin is an ordinary ESM package:

```text
blue-feature/
  package.json          # type: module, main, dsh.bundle.patch
  index.js              # Cordis plugin entry
  cordis.patch.yml      # inserts the entry into a profile
```

The entry exports a stable `name`, `inject`, and `apply(ctx)`. It requests the public capabilities `commands`, `status`, `status.provider`, `dock`, and `notifications` with `ctx.bluePluginHost.open(ctx, manifest)`. `open()`, `register()`, and `publish()` return structured `BlueResult` values and must be checked. Registrations belong to the caller's Fiber and are removed on unload, update, or profile reload.

Plugin code returns renderer-neutral `BlueView` data and structured actions:

- never import `pi-tui`, assemble ANSI rows, or calculate terminal width;
- never reach into owner-only services such as `blueScreen`, `blueComponents`, or private status/bottom-pane registries;
- never retain Agent/Session objects or put product state in a module singleton;
- let Blue's core adapter own width, theme, layout, and fallback behavior.

## Case study: blue-doudizhu

This case study is based on session `session-aad9fdb6-09ff-45b9-9aa0-0c7822efbcd5`. The goal was a character-card 斗地主 game in a Blue Dock pane, eventually distributed as an npm package.

### 1. Prototype in the session

The initial request called for character cards, clear turn prompts, a single-player mode with Bots, multiplayer/server options, and command-driven play. The session selected the `cordis` preset, loaded `cordis-plugin-development`, inspected the dynamic-plugin and local-LLM services, then used `cordis_define` to create `blue-doudizhu` and `cordis_run` to hot-mount it.

The prototype used only the public Blue facade:

```js
return {
  name: 'blue-doudizhu',
  inject: ['bluePluginHost'],
  apply(ctx) {
    const opened = ctx.bluePluginHost.open(ctx, {
      id: 'com.example.blue-doudizhu',
      api: '^1.0.0',
      capabilities: ['commands', 'dock', 'notifications'],
    })
    if (!opened.ok) throw new Error(opened.code + ': ' + opened.message)
    opened.value.commands.register({ id: 'poker', label: '斗地主牌局', execute })
    opened.value.dock.register({ id: 'doudizhu-board', priority: 30, view: () => renderBoard(state) })
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

Each change used `cordis_define` followed by `cordis_run update`, preserving diagnostics and rollback paths. Only after the user explicitly requested an upload to the `dsh-blue` organization and an npm package did the session load `blue-plugin-development`, create `package.json`, `index.js`, and `cordis.patch.yml`, and push the repository.

### 3. Check the package boundary

The package has the expected shape:

- stable `name`, `inject: ['bluePluginHost']`, and `apply(ctx)` exports;
- a manifest requesting only `commands`, `dock`, and `notifications`;
- command, Dock, and notification registrations obtained from the `open()` result;
- a patch containing only the `blue-doudizhu` insertion, with Fiber-owned cleanup;
- `@deepseek-ai/cordis` and `@dsh-blue/blue` as peer dependencies, and a `dsh.bundle.patch` entry for profile loading.

One compatibility issue must be fixed before release: the current `index.js` contains its own `charWidth`/`displayWidth`. Blue forbids hand-rolled width calculations because CJK and emoji can disagree with the real terminal. Return renderer-neutral content and let the Blue adapter measure and wrap it; then exercise narrow terminals, CJK, and emoji in a real profile.

## From prototype to npm

Use a scratch profile while iterating:

```sh
dsh plugin --profile blue-dev add /path/to/blue-doudizhu
dsh --profile blue-dev
```

Before publishing, run static boundary validation, the packed-install fixture, unload checks, and real-terminal dogfood. Install the `npm pack` tarball in a throwaway profile to verify that the entry and `cordis.patch.yml` are shipped. Publish only after those checks and human acceptance pass, and document Blue's prerequisite install, profile command, and restart in the README.

## Did this case actually use the creative-mode skills?

Yes. The session record contains real calls to `blue-plugin-development` (packaging) and `cordis-plugin-development` (dynamic prototyping, hot mounting, and repeated updates). The workflow, capability boundary, and immutable version rules in this chapter are taken from those skills and checked against the resulting repository.
