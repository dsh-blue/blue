# 编写第一个插件

Blue 的扩展表面由 Cordis plugin host 管理：你的插件声明 capability，贡献 renderer-neutral view/action，卸载时自动回滚。本篇用稳定的 `@dsh-blue/blue-api` 写出第一个插件；完整接合面见 [Seam 参考](/plugins/seams)。

::: warning 预览阶段提醒
缝的签名计划在 Phase 3 冻结；当前接入的插件随版本升级可能需要适配。本站会随每次发布同步更新。
:::

## 插件模型

一个 Blue 插件就是一个 Cordis 插件——导出 `name`（稳定字符串）、可选 `inject`（依赖的服务，等它们出现才激活）与 `apply(ctx)`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin.hello'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  // 通过 capability-scoped API 注册贡献
}
```

`bluePluginHost.open(ctx, manifest)` 把 API 和调用方 Fiber 绑定；所有 contribution registration 在插件卸载时一并回滚。

当前阶段 `open()` 只接受四个 capability：`commands`、`status`、`dock`、`notifications`。manifest 里还声明了 `tools`、`editor`、`panels`、`session.read`、`session.act` 五个能力，但申请它们会被拒绝并返回 `BLUE_CAPABILITY_DENIED`（见 [Seam 参考](/plugins/seams)）。

## 第一个插件：状态栏时钟

目标：状态栏里加一条当前时间，并注册一个 `/now` 命令。完整代码：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'

export const name = 'my-plugin.clock'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.clock',
    api: '^1.0.0',
    capabilities: ['status', 'commands'],
  })
  if (!opened.ok) throw new Error(opened.message)

  const status = opened.value.status!.register({
    id: 'clock.status',
    priority: 25,
    render: () => ({ kind: 'text', content: new Date().toLocaleTimeString() }),
  })
  if (!status.ok) throw new Error(status.message)

  const command = opened.value.commands!.register({
    id: 'now',
    label: 'Print the current time',
    execute: async () => ({ ok: true, value: undefined }),
  })
  if (!command.ok) throw new Error(command.message)
}
```

几个要点：

- `inject` 声明稳定 host 依赖——服务没就位前插件不激活；
- manifest 只开放声明过的 capability，注册失败返回结构化错误；
- 两个注册都绑定当前 Fiber，插件卸载即消失；
- `/now` 自动出现在编辑器的斜杠补全与 `/help` 里，不需要额外注册 UI。

## 打包与装配

1. **导出子路径**：在你的包 `package.json` 里导出插件入口（如 `"./clock": "./lib/clock.js"`）；插件形态与 Blue 内置插件完全一致（见[内置插件](/plugins/builtins)）。
2. **加 patch 行**：在 profile 的 `cordis.patch.yml` 加一行：

```yaml
- id: my-plugin-clock
  name: 'my-scope/my-pkg/clock'
```

3. **装入**：`dsh plugin --profile blue add link:/path/to/your/pkg`（开发期）或未来的市场一键安装。

行可增、可删、可重排——零代码定制：不想要哪个表面，删那行即可。

## 下一步

- [Seam 参考](/plugins/seams) —— stable plugin host 与 Blue 内部 projection/action/model 边界；
- [内置插件](/plugins/builtins) —— bundle 的 28 条 Blue 自有行与 validation-only 包。

## 设计纪律

1. 只依赖 `@dsh-blue/blue-api` 等公开 contract，不 import package internals；
2. 只申请实际需要的 capability，并处理 `BlueResult`；
3. contribution 必须是 renderer-neutral data/action；
4. 不持有 Agent、Session、renderer object 或跨 Fiber mutable singleton。
