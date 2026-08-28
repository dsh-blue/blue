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

Integration is a single move: **declare a manifest → `open()` to receive a capability-scoped API → register contributions**. Contributions are data (`BlueView`) and structured actions, not UI components. Every registration binds to the caller's Fiber, so contributions roll back automatically when the plugin unloads.

## Capabilities open today

| Capability | Contribution | Effect |
| --- | --- | --- |
| [`commands`](/en/plugins/commands) | slash command + async handler | appears in slash completion and `/help` |
| [`status`](/en/plugins/status) | a render function returning `BlueView` | status bar entry in the bottom footer |
| [`status.provider`](/en/plugins/status#exclusive-status-provider) | a render function receiving a readonly status snapshot | candidate replacing the entire footer |
| [`editor.extensions`](/en/plugins/editor-extensions) | passive shell, completion, actions, submit transforms | enhances Blue's owned editor without reading its state |
| [`dock`](/en/plugins/dock) | static or functional `BlueView` | bottom pane above the editor |
| [`notifications`](/en/plugins/notifications) | publish/subscribe `BlueNotification` | editor notice bar |

The manifest schema also declares five more capabilities — `tools`, `editor`, `panels`, `session.read`, `session.act` — but in the current phase requesting any of them is rejected by `open()` (`BLUE_CAPABILITY_DENIED`): they are reserved for later phases and their signatures are not settled.

## Documentation map

**Getting started**

- [Quickstart](/en/plugins/quickstart) — run a plugin end to end in ten minutes: package skeleton, manifest, install, verification, unload;
- [Core concepts](/en/plugins/concepts) — the Cordis tree and Fiber lifecycle, capability scoping, the `BlueView` vocabulary, `BlueResult` error codes, the domain/adapter split.

**Contributing capabilities** — one page per capability: contract table, full example, behavior details, and common pitfalls.

- [Commands](/en/plugins/commands) · [Status bar and exclusive provider](/en/plugins/status) · [Editor extensions](/en/plugins/editor-extensions) · [Dock panes](/en/plugins/dock) · [Notifications](/en/plugins/notifications)

**Validation and publishing**

- [Debugging & validation](/en/plugins/testing) — profile install, the iteration loop, the validate/fixture scripts, unload-semantics checks;
- [Publishing](/en/plugins/publishing) — npm publishing and the user install path.

**Reference**

- [Seam reference](/en/plugins/seams) — the complete list of the stable plugin host and Blue's internal boundaries;
- [Built-in plugins](/en/plugins/builtins) — the bundle's 29 Blue-owned rows, the most complete set of plugin examples;
- [Contributing to Blue](/en/plugins/contributing) — the local development flow for contributing code to Blue itself.
