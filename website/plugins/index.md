# 开发手册概览

Blue 插件是一个普通的 Cordis 插件：它声明一份 manifest，向 `bluePluginHost` 申请能力，然后注册 renderer-neutral 的贡献（view、命令、通知）。渲染统一由 Blue 的 TUI kernel 完成——你的代码永远不接触 pi-tui、ANSI 转义或终端宽度。

一个最小插件长这样：

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

把它插进 profile 的 `cordis.patch.yml`，状态栏就多了一行时钟。从零跑通这个插件见[快速开始](/plugins/quickstart)。

::: warning 预览阶段提醒
缝的签名计划在 Phase 3 冻结；当前接入的插件随版本升级可能需要适配。本站会随每次发布同步更新。
:::

## 对接模型一图

Blue 不是独立应用，而是 dsh 进程里一棵 Cordis 插件树上的一组插件行。你的插件与 Blue、Harness domain 运行在同一棵树里，通过 Cordis 服务注入对接，不需要 SDK 进程、IPC 或配置文件：

```text
dsh process 进程（one Cordis tree 一棵 Cordis 树）
├── dsh-base rows 行    — Harness domain: agents · sessions · tools · approval
├── Blue rows 行        — TUI: bluePluginHost serves here 在这里提供服务
└── your plugin row 你的插件行 — inserted via 经 cordis.patch.yml, inject bluePluginHost
```

对接动作只有一个：**声明 manifest → `open()` 拿到按能力裁剪的 API → 注册贡献**。贡献是 renderer-neutral 的 `BlueUiNode`/`BlueView` 和结构化 action，不是 renderer 组件。每次注册都绑定调用方 Fiber，插件卸载时贡献自动回滚。

## 当前开放的能力

| 能力 | 贡献内容 | 效果 |
| --- | --- | --- |
| [`commands`](/plugins/commands) | slash 命令 + 异步 handler | 出现在斜杠补全与 `/help` |
| [`status`](/plugins/status) | 返回 `BlueStatusNode` 的 render 函数 | 底部 footer 状态条目 |
| [`status.provider`](/plugins/status#独占-status-provider) | 接收 readonly status snapshot 的 render 函数 | 替换整个 footer 的候选 provider |
| [`editor.extensions`](/plugins/editor-extensions) | passive shell、补全、action、submit transform | 增强 Blue 自有编辑器而不读取其状态 |
| [`editor.provider`](/plugins/editor-providers) | 接收 readonly editor snapshot 的 shell render 函数 | 用户选择的独占 editor shell 候选 |
| [`panes`](/plugins/dock) | 布局位置、canonical node 与结构化 event | header/left/right/bottom 插件面 |
| [`overlays`](/plugins/dock#overlay-契约) | canonical overlay request 与结构化 event | 受 Blue focus/lifecycle 托管的浮层 |
| [`notifications`](/plugins/notifications) | 发布/订阅 `BlueNotification` | 编辑器通知条 |

manifest schema 还声明了 `session.read` 与 `session.act`，但当前阶段申请会被 `open()` 拒绝（`BLUE_CAPABILITY_DENIED`）。旧名 `dock`、`panels`、`editor` 与 `tools` 已从公开 manifest 删除；校验器会返回具体迁移提示。

## 文档地图

**开始**

- [快速开始](/plugins/quickstart) —— 十分钟从零跑通一个插件：包骨架、manifest、安装、验证、卸载；
- [核心概念](/plugins/concepts) —— Cordis 树与 Fiber 生命周期、capability 裁剪、canonical node 词汇表、`BlueResult` 错误码、domain/adapter 拆分；
- [公共 UI Kit](/plugins/ui-kit)与[示例目录](/plugins/examples) —— 纯 builder、共享组件和六个打包示例。

**贡献能力** —— 每个能力一页：契约表、完整示例、行为细节与常见错误。

- [命令](/plugins/commands) · [状态栏与独占 provider](/plugins/status) · [编辑器扩展](/plugins/editor-extensions) · [编辑器 Provider](/plugins/editor-providers) · [Pane 与 Overlay](/plugins/dock) · [通知](/plugins/notifications)

**验证与发布**

- [调试与验证](/plugins/testing) —— profile 安装、迭代回路、validate/fixture 脚本、卸载语义检查；
- [旧 UI API 迁移](/plugins/ui-migration) —— 从 dock/panel/renderer facade 迁到 canonical pane、overlay 和 provider；
- [发布插件](/plugins/publishing) —— npm 发布与用户安装路径。

**参考**

- [Seam 参考](/plugins/seams) —— 稳定 plugin host 与 Blue 内部边界的完整清单；
- [内置插件](/plugins/builtins) —— bundle 的 30 条 Blue 自有行，是最完整的插件范例集；
- [贡献本仓库](/plugins/contributing) —— 给 Blue 本体贡献代码的本地开发流程。
