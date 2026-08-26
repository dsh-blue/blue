# Quickstart

This page runs a downstream plugin end to end from scratch: in ten minutes you will have a clock plugin hanging on Blue's status bar, and you will have verified its unload semantics. Concept explanations are kept minimal — design rationale and full contracts live in [Core concepts](/en/plugins/concepts).

## Prerequisites

| Dependency | Version |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| dsh CLI | `npm i -g @deepseek-ai/dsh` |
| A profile with Blue installed | `dsh plugin --profile blue-dev add @dsh-blue/blue@rc` (see the [Quickstart guide](/en/guide/)) |

Develop your own plugin against a dedicated profile (such as `blue-dev`) — do not touch the `blue` profile you use day to day.

## 1. Package skeleton

```text
blue-clock/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts        # 插件入口
```

The key `package.json` fields:

```json
{
  "name": "my-scope/blue-clock",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "dependencies": { "@dsh-blue/blue-api": "^0.1.0-rc.9-test.6" },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

- The package name should contain `blue`, `frontend`, or `adapter` so Blue's validate script recognizes it as a Blue frontend package (see [Debugging & validation](/en/plugins/testing));
- `@dsh-blue/blue-api` is the only Blue package you depend on — it is pure contracts (manifest validation + types), with no renderer or terminal code;
- Cordis is provided by the host dsh installation and declared as a peer. **Do not** bundle dsh/cordis into your own `dependencies`, or a second service instance appears in the tree;
- The entry is exactly that of a plain Cordis plugin: export `name` (a stable string), optional `inject` (activation waits until the declared services are in place), and `apply(ctx)`. The npm package name and the Cordis plugin name are two independent namespaces and need not match.

Any TS toolchain works for the build (tsc, tsdown, tsup…), as long as `exports` points at the build output. Plugins are ESM-only.

## 2. Plugin entry

`src/index.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入：拉入 Context.bluePluginHost 的声明合并
import type {} from '@dsh-blue/blue-api'

export const name = 'my-plugin.clock'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.clock',        // 小写命名空间 id，可带 @scope/ 前缀
    api: '^1.0.0',                // 对宿主 BLUE_API_VERSION（1.x 线）的 semver 范围
    capabilities: ['status', 'commands'],
  })
  if (!opened.ok) {
    // 结构性失败（版本不兼容 / 能力未开放）：放弃挂载，不要把异常抛进宿主
    return
  }
  const api = opened.value // BluePluginApi：只暴露声明过的 capability

  api.status?.register({
    id: 'clock.status',
    render: () => ({ kind: 'text', content: new Date().toLocaleTimeString(), tone: 'muted' }),
  })

  api.commands?.register({
    id: 'now',                    // 即 /now
    label: 'Print the current time',
    execute: async () => {
      console.log(new Date().toISOString())
      return { ok: true, value: undefined }
    },
  })
}
```

Three key points:

- `open(ctx, manifest)` first validates the manifest statically (without executing plugin code), then returns a **capability-scoped** `BluePluginApi` — capabilities you did not declare are `undefined` on the returned object;
- Every failure is a structured `BlueResult` (`{ ok: false, code, message }`); plugin errors never cross the public boundary as exceptions — and your code should not throw upward either;
- Every registration returns a `BlueRegistration` bound to the caller's Fiber: **contributions roll back automatically when the plugin unloads** — no cleanup logic of your own.

## 3. Install into a profile

Insert a row into the profile's `cordis.patch.yml` (rows can be added, removed, and reordered — zero-code customization):

```yaml
- id: my-plugin-clock
  name: 'my-scope/blue-clock'
```

During development, install it as a link:

```sh
dsh plugin --profile blue-dev add link:/path/to/blue-clock
dsh --profile blue-dev
```

After startup you should see: an extra clock entry in the bottom footer; typing `/now` offers slash completion, and pressing enter prints the time to the terminal.

## 4. Verify unload semantics

Remove your plugin row from the patch (or `dsh plugin --profile blue-dev remove my-scope/blue-clock`) and restart the profile: the clock entry and `/now` should all disappear, leaving no residue. This is the expected behavior of Fiber-bound registration — if residue remains, your plugin registered something by bypassing `open()`; troubleshoot against [Core concepts](/en/plugins/concepts#design-discipline).

## 5. Iteration loop

Edit code → rebuild your package → restart the profile. The link points at the package directory, so rebuilt output takes effect directly with no reinstall; only a dependency-graph change (adding a dependency) needs another `add`.

Once validated, run the Blue repository's static checks and packed-install fixture as pre-publish verification, and then you can [publish](/en/plugins/publishing) — see [Debugging & validation](/en/plugins/testing) for details.

## Next steps

- [Core concepts](/en/plugins/concepts) — understand capability scoping, the `BlueView` vocabulary, and the domain/adapter split;
- [Commands](/en/plugins/commands), [Status bar](/en/plugins/status), [Dock panes](/en/plugins/dock), [Notifications](/en/plugins/notifications) — the full contracts of the four capabilities;
- [Built-in plugins](/en/plugins/builtins) — Blue's own 28 rows are the most complete set of examples.
