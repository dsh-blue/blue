# Developer manual overview

A Blue plugin is an ordinary Cordis plugin: it declares a manifest, requests capabilities from `bluePluginHost`, then registers renderer-neutral contributions (views, commands, notifications). All rendering is done by Blue's TUI kernel — your code never touches pi-tui, ANSI escapes, or terminal width.

A minimal plugin looks like this:

```ts
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：拉入 Context.bluePluginHost 的声明合并
import type {} from '@dsh-blue/blue-api'

export const name = 'my-plugin.clock'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.clock',
    api: '^1.0.0',
    capabilities: ['status'],
  })
  if (!opened.ok) return // 结构性失败：放弃挂载，不向宿主抛异常
  opened.value.status?.register({
    id: 'clock.status',
    render: () => ({ kind: 'text', content: new Date().toLocaleTimeString(), tone: 'muted' }),
  })
}
```

Insert it into the profile's `cordis.patch.yml` and the status bar gains a clock entry. To run this plugin end to end from scratch, see the [quickstart](/en/plugins/quickstart).

::: warning Preview-stage caveat
Seam signatures are planned to freeze in Phase 3; plugins integrating today may need adaptation across upgrades. This site is kept in sync with every release.
:::

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
| [`status.provider`](/en/plugins/status#exclusive-status-provider) | a render function receiving a readonly status snapshot | candidate replacing the entire footer |
| [`editor.extensions`](/en/plugins/editor-extensions) | passive shell, completion, actions, submit transforms | enhances Blue's owned editor without reading its state |
| [`editor.provider`](/en/plugins/editor-providers) | a shell render function receiving a readonly editor snapshot | user-selected exclusive editor-shell candidate |
| [`panes`](/en/plugins/dock) | placement, canonical node, and structured events | plugin surfaces in header/left/right/bottom lanes |
| [`overlays`](/en/plugins/dock#overlay-contract) | canonical overlay request and structured events | overlays managed by Blue focus and lifecycle |
| [`notifications`](/en/plugins/notifications) | publish/subscribe `BlueNotification` | editor notice bar |
| [`session.read`](/en/plugins/session) | revisioned, deeply frozen current-session snapshot | `current()` and effect-bound `subscribe()` |
| [`session.act`](/en/plugins/session#structured-actions) | followup, steer, and interrupt | global FIFO with abort and stale/late fencing |

`session.read` and `session.act` are strictly isolated facades; `open()` returns `BLUE_CAPABILITY_ABSENT` when their owner row is missing. The old `dock`, `panels`, `editor`, and `tools` names have been removed from the public manifest; validation returns a concrete migration message.

## Documentation map

**Getting started**

- [Quickstart](/en/plugins/quickstart) — run a plugin end to end in ten minutes: package skeleton, manifest, install, verification, unload;
- [Core concepts](/en/plugins/concepts) — the Cordis tree and Fiber lifecycle, capability scoping, canonical nodes, `BlueResult` error codes, and the domain/adapter split;
- [Public UI kit](/en/plugins/ui-kit) and [example catalog](/en/plugins/examples) — pure builders, shared components, and six packed examples.

**Contributing capabilities** — one page per capability: contract table, full example, behavior details, and common pitfalls.

- [Commands](/en/plugins/commands) · [Status bar and exclusive provider](/en/plugins/status) · [Editor extensions](/en/plugins/editor-extensions) · [Editor providers](/en/plugins/editor-providers) · [Panes and overlays](/en/plugins/dock) · [Notifications](/en/plugins/notifications)

**Validation and publishing**

- [Debugging & validation](/en/plugins/testing) — profile install, the iteration loop, the validate/fixture scripts, unload-semantics checks;
- [Legacy UI API migration](/en/plugins/ui-migration) — move from dock/panel/renderer facades to canonical panes, overlays, and providers;
- [Publishing](/en/plugins/publishing) — npm publishing and the user install path.

**Reference**

- [Seam reference](/en/plugins/seams) — the complete list of the stable plugin host and Blue's internal boundaries;
- [Built-in plugins](/en/plugins/builtins) — the bundle's 31 Blue-owned rows, the most complete set of plugin examples;
- [Contributing to Blue](/en/plugins/contributing) — the local development flow for contributing code to Blue itself.
