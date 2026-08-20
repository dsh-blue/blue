# 编写第一个插件

Blue 的一切表面都是 Cordis 插件——你自己的增强与 Blue 内置功能**同权**：走同样的缝注册、同样可被 `/theme` 热切换 reload、卸载时同样自动回滚全部贡献。本篇带你从零写出第一个可用的插件；Blue 开放了哪些接合面，见 [Seam 参考](/plugins/seams)。

::: warning 预览阶段提醒
缝的签名计划在 Phase 3 冻结；当前接入的插件随版本升级可能需要适配。本站会随每次发布同步更新。
:::

## 插件模型

一个 Blue 插件就是一个 Cordis 插件——导出 `name`（稳定字符串）、可选 `inject`（依赖的服务，等它们出现才激活）与 `apply(ctx)`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin.hello'
export const inject = ['blueComponents']

export function apply(ctx: Context): void {
  // …注册你的贡献
}
```

**注册即 effect**：所有注册（组件挂载、命令、键位、状态条目）都包在 `ctx.effect(() => ...)` 里——插件 fiber 卸载时贡献自动回滚，`/theme` 热切换 reload 依赖方时不留残迹。

## 第一个插件：状态栏时钟

目标：状态栏里加一条当前时间，并注册一个 `/now` 命令。完整代码：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin.clock'
export const inject = ['blueStatus', 'commands']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.blueStatus.register({
    id: 'my-plugin.clock',
    priority: 25,                     // 内置条目占 0/5/10/20/30，空档任用
    render: (width) => new Date().toLocaleTimeString(),
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'now',
    description: 'Print the current time',
    handler: () => ({ kind: 'success', text: new Date().toLocaleString() }),
  }))
}
```

几个要点：

- `inject` 声明依赖——服务没就位前插件不激活，不用自己写等待逻辑；
- 两个注册都返回 disposer、都由 effect 托管——插件卸载即消失；
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

- [Seam 参考](/plugins/seams) —— Blue 开放的接合面全目录：屏幕、键位、组件工厂、主题、状态栏、渲染意图、共享编辑器……以及各缝能做什么；
- [内置插件](/plugins/builtins) —— 21 个内置插件就是"插件能做什么"的活例子，逐个可拆。

## 设计纪律

1. 只依赖文档化缝与契约包（`@dsh-blue/blue-core` 等的类型导出），不得 import Blue 包内部模块；
2. 注册一律返回 disposer 并包进 `ctx.effect`；
3. plain-first：你的插件与 Blue 内置增强同权，不存在"内部通道"；
4. 新缝只在首个真实消费者出现时开，签名冻结前可能调整。
