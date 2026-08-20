# 编写 Blue 插件

Blue 的一切表面都是 Cordis 插件——你自己的增强与 Blue 内置功能**同权**：走同样的缝注册、同样可被 `/theme` 热切换 reload、卸载时同样自动回滚全部贡献。本页是从零接入所需的最小知识。

::: warning 预览阶段提醒
缝的签名计划在 Phase 3 冻结；当前接入的插件随版本升级可能需要适配。本站会随每次发布同步更新本文。
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

## Blue 开放的缝

下游插件只允许 import 文档化契约与子路径，不得 import Blue 包内部模块：

| 缝 | 入口 | 你能做什么 |
| --- | --- | --- |
| 屏幕挂载 | `ctx.blueScreen` | 挂组件（`addChild` 返回 disposer）、弹 overlay、`setFocus`、请求重绘 |
| 键位注册 | `ctx.blueKeymap` | 注册语境/全局快捷键；冲突在注册期暴露，不运行时抢键 |
| 组件工厂 | `ctx.blueComponents` | 造 editor/markdown/select/image 组件 + 宽度/模糊纯函数，全程不碰 pi-tui |
| 终端事实 | `ctx.blueTerminalInfo` | 读 OSC 11 背景探测与键盘协议能力 |
| 主题 | `blueTheme` provider 替换 | 提供整套调色板（28 token），`/theme` 热切换 |
| 状态栏 | `ctx.blueStatus` | 注册 footer 条目（priority/row/align） |
| 渲染意图 | `ctx.blueIntents` | 为新工具类型提供定制卡片（diff、terminal 就是这么来的） |
| 会话事实 | `ctx.blueSession` + `blue/session-changed` 等事件 | 读当前 Agent、跟踪会话切换、发起 resume/new/fork |
| 共享编辑器 | 模块级 `editor-instance` + `blue/input-editor-changed` | 叠补全 provider、`onKey` 拦截、提交变换器 |
| chrome 辅助 | `@dsh-blue/blue-core/chrome` 子路径 | 主题无关的框/规则/提示绘制纯函数 |

继承自 harness 的缝同样对你开放：`ctx.commands.register`（斜杠命令，自动进补全菜单）、`ctx.userQuestions.registerProvider`（接管提问）、`'approval/request'` waterfall（审批应答）、`attachments`（附件存储）、`ctx.tools` / `ctx.agents` / `ctx.sessions`。

## 一个完整的例子

状态栏里加一条当前时间、并注册一个 `/now` 命令的插件：

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

两个注册都返回 disposer、都由 effect 托管——卸载即消失，`/now` 也会自动出现在编辑器的斜杠补全里。

## 装配进 profile

插件以**子路径导出 + patch 行**的形式进入组装层：在你的包 `package.json` 导出子路径，然后在 profile 的 `cordis.patch.yml` 加一行：

```yaml
- id: my-plugin-clock
  name: 'my-scope/my-pkg/clock'
```

行可增、可删、可重排——Blue 自己的 21 行就是这么装配的（见[功能总览](/features/)）。零代码定制：不想要哪个表面，删那行即可。

## 设计纪律

1. 只依赖文档化缝与契约包（`@dsh-blue/blue-core` 等的类型导出）；
2. 注册一律返回 disposer 并包进 `ctx.effect`；
3. plain-first：你的插件与 Blue 内置增强同权，不存在"内部通道"；
4. 新缝只在首个真实消费者出现时开，签名冻结前可能调整。
