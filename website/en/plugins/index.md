# Developer manual overview

A Blue plugin is an ordinary Cordis plugin: it declares a manifest, requests capabilities from `bluePluginHost`, then registers renderer-neutral contributions (views, commands, notifications). All rendering is done by Blue's TUI kernel — your code never touches pi-tui, ANSI escapes, or terminal width.

A minimal new plugin starts with a canonical `blue.plugin.json`:

```json
{
  "$schema": "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json",
  "schemaVersion": 1,
  "id": "my-plugin-clock",
  "entry": ".",
  "api": "^1.0.0-beta.1",
  "compatibility": {
    "blue": ">=0.1.1-rc.2 <0.1.2",
    "harness": ">=0.1.1-rc.1 <0.1.2",
    "node": "^22.19.0 || >=24.0.0"
  },
  "capabilities": {
    "required": [{ "name": "status", "version": "^1.0.0" }],
    "optional": []
  }
}
```

The entry passes this validated manifest to `open()`, then registers through the granted `status` facade. To run a complete package end to end from scratch, see the [quickstart](/en/plugins/quickstart).

::: warning Preview-stage caveat
The executable protocol is `1.0.0-beta.1`, not Stable v1. `0.1.1-rc.2` delivers the P1–P4 machine contract, catalog/Host negotiation, five UI capabilities, and two read-only session capabilities. P5's no-clone author commands, skill, and tutorial fixture remain later roadmap work.
:::

## The `0.1.1-rc.2` Public Beta boundary

| Phase | Delivered |
| --- | --- |
| P1 | Draft 2020-12 manifest schema, generated TypeScript, shared positive/negative corpus, product/protocol mapping, and packed validator |
| P2 | atomic required/optional admission, exact resource grants, structured denials, protected owner generations, and owner-gap restore |
| P3 | quotas, refresh, unload/reload, and stale-result fences for `commands`, `status`, `panes`, `overlays`, and `notifications.publish` |
| P4 | exact-field `session.read` and exact-key `session.projections.read` with epoch/revision/seq, consistent cuts, JSON/size bounds, and late-result rejection |

These capabilities are ready for plugin adaptation but remain Public Beta until ecosystem consumers, author tooling, and the P7 evidence gates close. The machine entry points are `@dsh-blue/blue-api/protocol/v1` and the public [schema](/schema/blue.plugin.v1.schema.json). New plugins use canonical `blue.plugin.json`; do not start from the flat transition manifest.

## The integration model at a glance

Blue is not a standalone application — it is a set of plugin rows on the Cordis plugin tree inside the dsh process. Your plugin runs in the same tree as Blue and the Harness domain, integrating through Cordis service injection — no SDK process, IPC, or config file:

```text
dsh process 进程（one Cordis tree 一棵 Cordis 树）
├── dsh-base rows 行    — Harness domain: agents · sessions · tools · approval
├── Blue rows 行        — TUI: bluePluginHost serves here 在这里提供服务
└── your plugin row 你的插件行 — inserted via 经 cordis.patch.yml, inject bluePluginHost
```

Integration is a single move: **declare a manifest → `open()` to receive a capability-scoped API → register contributions**. Contributions are renderer-neutral `BlueUiNode`/`BlueView` data and structured actions, not renderer components. Every registration binds to the caller's Fiber, so contributions roll back automatically when the plugin unloads.

## Capabilities open today

| Capability | Contribution | Effect |
| --- | --- | --- |
| [`commands`](/en/plugins/commands) | slash command + async handler | appears in slash completion and `/help` |
| [`status`](/en/plugins/status) | a render function returning `BlueStatusNode` | status bar entry in the bottom footer |
| [`status.provider`](/en/plugins/status#exclusive-status-provider) (Experimental) | a render function receiving a readonly status snapshot | reference runtime: candidate replacing the entire footer |
| [`editor.extensions`](/en/plugins/editor-extensions) (Experimental) | passive shell, completion, actions, submit transforms | reference runtime: enhances Blue's owned editor without reading its state |
| [`editor.provider`](/en/plugins/editor-providers) (Experimental) | a shell render function receiving a readonly editor snapshot | reference runtime: user-selected exclusive editor-shell candidate |
| [`panes`](/en/plugins/dock) | placement, canonical node, and structured events | plugin surfaces in header/left/right/bottom lanes |
| [`overlays`](/en/plugins/dock#overlay-contract) | canonical overlay request and structured events | overlays managed by Blue focus and lifecycle |
| [`notifications.publish`](/en/plugins/notifications) | publish-only `BlueNotification` | editor notice bar; no global observation |
| [`session.read`](/en/plugins/session) | exact-field, epoch/revision-fenced, deeply frozen current-session snapshot | result-bearing `current()` and effect-bound `subscribe()` |
| [`session.projections.read`](/en/plugins/session#projection-cuts) | exact-key projection JSON cuts with epoch/seq fences | `current()`, consistent `currentMany()`, and key-set `subscribe()` |

Generic `session.act` has been removed; writes use the owning Harness service or a feature-owned action. `null` means the read owner is online with no current session; a missing read owner returns `BLUE_CAPABILITY_ABSENT` and never falls back to an unscoped app service. The old `dock`, `panels`, `editor`, and `tools` names have been removed from the public manifest; validation returns a concrete migration message.

## Documentation map

**Getting started**

- [Quickstart](/en/plugins/quickstart) — run a plugin end to end in ten minutes: package skeleton, manifest, install, verification, unload;
- [Core concepts](/en/plugins/concepts) — the Cordis tree and Fiber lifecycle, capability scoping, canonical nodes, `BlueResult` error codes, and the domain/adapter split;
- [Public UI kit](/en/plugins/ui-kit) and [example catalog](/en/plugins/examples) — pure builders, shared components, and six packed examples.

**Contributing capabilities** — one page per capability: contract table, full example, behavior details, and common pitfalls.

- [Commands](/en/plugins/commands) · [Status bar and exclusive provider](/en/plugins/status) · [Editor extensions](/en/plugins/editor-extensions) · [Editor providers](/en/plugins/editor-providers) · [Panes and overlays](/en/plugins/dock) · [Notifications](/en/plugins/notifications) · [Read-only session data](/en/plugins/session)

**Validation and publishing**

- [Debugging & validation](/en/plugins/testing) — profile install, the iteration loop, the validate/fixture scripts, unload-semantics checks;
- [Legacy UI API migration](/en/plugins/ui-migration) — move from dock/panel/renderer facades to canonical panes, overlays, and providers;
- [Publishing](/en/plugins/publishing) — npm publishing and the user install path.

**Reference**

- [Seam reference](/en/plugins/seams) — the complete list of the Beta plugin host and Blue's internal boundaries;
- [Built-in plugins](/en/plugins/builtins) — the bundle's 33 Blue-owned rows, the most complete set of plugin examples;
- [Contributing to Blue](/en/plugins/contributing) — the local development flow for contributing code to Blue itself.
