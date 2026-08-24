---
name: blue-plugin-development
description: Use when creating, changing, or debugging a Blue feature — the terminal UI on the DeepSeek Harness. A real Blue feature is a distributable plugin package (an npm package of Cordis plugins plus a cordis.patch.yml, installed with `dsh plugin --profile blue add`), NOT an edit to Blue's own source tree. Covers the package shape, the L1 service surface, the row-width and effect-bound contracts, and the install-restart iteration loop. Not for editing compositions — use editing-cordis-compositions for those.
---

# Develop Blue plugins

Blue is a renderer over the harness's Cordis plugin architecture — and Blue itself is just an npm package (`@dsh-blue/blue`) carrying Cordis plugins plus a `cordis.patch.yml`, installed into a dsh profile with `dsh plugin add`. A profile composes MULTIPLE bundles in order, so a third-party Blue feature is a package of the same shape layered after Blue. Verified end to end: a plain hand-written ESM package with no build step mounts and renders.

## The package shape

```
my-blue-feature/
  package.json       # type: module, main: index.js, dsh.bundle.patch: ./cordis.patch.yml
  cordis.patch.yml   # inserts your plugin rows
  index.js           # plain ESM Cordis plugins — no build step required for simple features
```

```json
{
  "name": "my-blue-feature",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
- insert:
    - id: my-blue-feature
      name: 'my-blue-feature'
```

Row package names resolve from the profile's `node_modules`, which is where `dsh plugin add` installs the package.

## The plugin shape

Every entry is a Cordis plugin: a stable `name`, an `inject` list of hard dependencies, and `apply(ctx)`. **Every registration must be effect-bound** so unloading reverts it:

```js
export const name = 'my-blue-feature'
export const inject = ['blueStatus', 'blueTheme', 'blueComponents']

export function apply(ctx) {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  ctx.effect(() => ctx.blueStatus.register({
    id: 'my-blue-feature.badge',
    priority: 40,
    render(width) {
      return colors.muted(components.truncateToWidth('my badge', width))
    },
  }))
}
```

A minimal footer entry, complete. The `blueStatus` registry owns the footer; `priority` orders entries; `render(width)` returns one styled row.

## The L1 service surface

Consume Blue through its Cordis services and events — never by importing Blue internals:

- `blueScreen` — the terminal root; `addBottomChild` mounts a docked pane, `requestRender()` repaints.
- `blueTheme` — the active palette (`ctx.blueTheme.colors`); themes are plugins too, so render through the palette, not literals.
- `blueComponents` — the component factory AND the width helpers (`truncateToWidth`, `visibleWidth`).
- `blueStatus` — the footer registry (above).
- `blueIntents` — transcript render intents (e.g. how a tool card renders).
- `blueSession` — the live agent; the `'blue/session-changed'` event fires on switches.
- `commands` — the slash-command registry, for `/your-command`.
- `blueKeymap` — keybinding registration.

At dev time, types come from the published contracts: `@dsh-blue/blue-api` is the stable renderer-independent surface (program against it first); `blue-core`'s contract exports cover the L1 services. Runtime code never needs a pi-tui import — see the width rule below.

## The row-width hard contract

Every rendered row must fit the width `render(width)` was given. Measure with the width helpers on the `blueComponents` service (`truncateToWidth`, `visibleWidth`). Two forbidden shortcuts:

- **A direct pi-tui dependency** — Blue pins its pi-tui version; a second copy in the tree breaks width truth (and the version-uniqueness rule).
- **Hand-rolled character counts** — codepoint counters are exact only for ASCII; CJK and emoji mis-budget and trip the render-exit clamp (a clamped row is a bug — it lands in `blue-overflow.log`).

Fixed furniture (bullets, indents) plus wrapped text must be measured assembled. When the viewport is narrower than your furniture, cut content, not the frame.

## The iteration loop

1. Develop against a **scratch profile**, never the production `blue` one: `dsh plugin --profile blue-dev add /path/to/my-blue-feature` records a `link:` spec, so edits to your package are live on the next restart — no reinstall needed while the dependency graph is unchanged.
2. Restart `dsh --profile blue-dev` and look at the result. Repeat.
3. For a release check, `npm pack` and install the tarball into a throwaway profile (or a throwaway `DSH_HOME`) — that exercises the exact artifact users will get.
4. Ship: publish to npm; users install with `dsh plugin --profile blue add my-blue-feature`. Remove with `dsh plugin --profile blue remove my-blue-feature`.

The `blue` launcher calibrates only the `@dsh-blue/blue` bundle version and leaves additional bundles alone; a plain `blue` boot does not disturb an installed third-party feature.

## What a plugin package is NOT for

- **Changing Blue's own packages** (api/core/transcript/interaction/app/bundle) — that is dsh-blue repository work with its own gates (per-file full coverage, the subpath export triangle, the worktree + dogfood flow). Clone the repo and follow its AGENTS.md; this skill's loop does not apply.
- **Session capabilities** (a tool, a prompt section) — that is an agent preset; see the editing-cordis-compositions skill.
- **Quick behavior experiments** — a host-half-only dynamic plugin via the cordis_* tools; see the cordis-plugin-development skill. Dynamic packages cannot keep the width contract (no pi-tui in the vm sandbox), so they never ship UI.

## Style

TypeScript or plain ESM JavaScript, no semicolons, single quotes, 2-space indent. Effect-bound everything. Render through the theme palette. Keep the plugin fiber's work synchronous at apply time; subscribe for later data.
