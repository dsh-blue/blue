---
name: blue-plugin-development
description: Use when packaging an accepted Blue feature as a distributable plugin package — the terminal UI on the DeepSeek Harness. A real Blue feature is a distributable plugin package (an npm package of Cordis plugins plus a cordis.patch.yml, installed with `dsh plugin --profile blue add`), NOT an edit to Blue's own source tree. Covers the package shape, the L1 service surface, the row-width and effect-bound contracts, and the install-restart iteration loop. For fast in-session prototyping before packaging, use the cordis-plugin-development skill (dynamic plugins hot-mount without a restart); come here once the user accepts the prototype. Not for editing compositions — use editing-cordis-compositions for those.
---

# Develop Blue plugins

Blue is a renderer over the harness's Cordis plugin architecture — and Blue itself is just an npm package (`@dsh-blue/blue`) carrying Cordis plugins plus a `cordis.patch.yml`, installed into a dsh profile with `dsh plugin add`. A profile composes MULTIPLE bundles in order, so a third-party Blue feature is a package of the same shape layered after Blue. Verified end to end: a plain hand-written ESM package with no build step mounts and renders. Dynamic prototypes use the capability-scoped `bluePluginHost`; they do not reach into Blue's root services or composition.

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
export const inject = ['bluePluginHost']

export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'com.example.my-blue-feature',
    api: '^1.0.0',
    capabilities: ['status'],
  })
  if (!opened.ok) throw new Error(opened.code + ': ' + opened.message)
  const registered = opened.value.status.register({
    id: 'my-feature-badge',
    priority: 40,
    render: () => ({ kind: 'text', content: 'my badge', tone: 'muted' }),
  })
  if (!registered.ok) throw new Error(registered.code + ': ' + registered.message)
}
```

A minimal footer entry, complete. The owner bridge orders it by `priority`, applies the active theme, budgets its width, and removes it with the plugin Fiber.

## The L1 service surface

Consume Blue through the public capability host and renderer-neutral contracts — never by importing Blue internals:

- `panes` — renderer-neutral `BlueUiNode` contributions placed in header, left, right, or bottom lanes.
- `status` — renderer-neutral footer contributions.
- `commands` — additive slash commands with structured `BlueResult` outcomes.
- `notifications` — renderer-neutral messages and subscriptions.
- `session.read` — `api.session` with frozen revisioned `current()` / `subscribe()` only.
- `session.act` — `api.sessionActions` with FIFO, abort/stale-fenced `request()` only.

The raw `blueScreen`, `blueTheme`, `blueComponents`, `blueKeymap`, transcript registries, and root loader are owner-only implementation services. Existing feature IDs cannot be replaced by registering the same ID.

Every `open()`, `register()`, and `publish()` call returns a `BlueResult` and must be checked. `BLUE_CAPABILITY_ABSENT` means the owner bridge for that surface is not active, including after a previously opened API loses its bridge. `session.read` and `session.act` are separate permissions: never request write access for a read-only plugin, and never assume either facade contains the other's methods. Preserve a plain/read-only fallback when possible or report that the Blue profile must be upgraded/restarted; never reach into private status/bottom-pane registries, command/editor hosts, session services, or another owner service as a fallback.

At dev time, types come from the published contracts: `@dsh-blue/blue-api` is the stable renderer-independent surface (program against it first); `blue-core`'s contract exports cover the L1 services. Runtime code never needs a pi-tui import — see the width rule below.

## The row-width hard contract

Every renderer-owned view must fit its target surface. Plugin code returns renderer-neutral `BlueUiNode` data; the TUI adapter performs width measurement and fallback. Do not import pi-tui or assemble ANSI rows in a plugin. Two forbidden shortcuts:

- **A direct pi-tui dependency** — Blue pins its pi-tui version; a second copy in the tree breaks width truth (and the version-uniqueness rule).
- **Hand-rolled character counts** — codepoint counters are exact only for ASCII; CJK and emoji mis-budget and trip the render-exit clamp (a clamped row is a bug — it lands in `blue-overflow.log`).

Fixed furniture (bullets, indents) plus wrapped text must be measured assembled. When the viewport is narrower than your furniture, cut content, not the frame.

## The iteration loop

0. **Fastest iteration is upstream of the package**: while the feature's shape is still moving, prototype it as an additive dynamic plugin hot-mounted in the session (cordis-plugin-development skill) — the user sees every change immediately, with no reinstall and no restart. Reach for the package form when the user has accepted the prototype.
1. **Confirm the user's durable outcome before creating anything**: keep a local plugin package, upload its repository to GitHub, or publish it to npm. If this choice was not made before loading the skill, ask now. Do not create package files, repositories, commits, tags, or releases before explicit consent.
2. Develop the chosen package against a **scratch profile**, never the production `blue` one: `dsh plugin --profile blue-dev add /path/to/my-blue-feature` records a `link:` spec, so edits to your package are live on the next restart — no reinstall needed while the dependency graph is unchanged.
3. Restart `dsh --profile blue-dev` and look at the result. Repeat.
4. For a release check, `npm pack` and install the tarball into a throwaway profile (or a throwaway `DSH_HOME`) — that exercises the exact artifact users will get.
5. Stop after a verified local package when that was the chosen outcome. For GitHub or npm, perform only the agreed distribution operation and report authentication, repository creation, npm login/2FA, organization-policy, or token steps the user must complete themselves. Remove a local install with `dsh plugin --profile blue remove my-blue-feature`.

The `blue` launcher calibrates only the `@dsh-blue/blue` bundle version and leaves additional bundles alone; a plain `blue` boot does not disturb an installed third-party feature.

## What a plugin package is NOT for

- **Changing Blue's own packages** (api/core/transcript/interaction/app/bundle) — that is dsh-blue repository work with its own gates (per-file full coverage, the subpath export triangle, the worktree + dogfood flow). Clone the repo and follow its AGENTS.md; this skill's loop does not apply.
- **Session capabilities** (a tool, a prompt section) — that is an agent preset; see the editing-cordis-compositions skill.
- **Quick behavior experiments and in-session UI prototypes** — a dynamic plugin via the cordis_* tools (cordis-plugin-development skill) hot-mounts without a restart through `bluePluginHost`. Prototype there; package here once the user accepts.

## Style

TypeScript or plain ESM JavaScript, no semicolons, single quotes, 2-space indent. Effect-bound everything. Render through the theme palette. Keep the plugin fiber's work synchronous at apply time; subscribe for later data.
