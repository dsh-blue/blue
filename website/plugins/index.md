# 开发手册概览

Blue 插件是一个普通的 Cordis 插件：它声明一份 manifest，向 `bluePluginHost` 申请能力，然后注册 renderer-neutral 的贡献（view、命令、通知）。渲染统一由 Blue 的 TUI kernel 完成——你的代码永远不接触 pi-tui、ANSI 转义或终端宽度。

一个最小新插件从 canonical `blue.plugin.json` 开始：

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

入口将这份已校验 manifest 传给 `open()`，再通过获准的 `status` facade 注册贡献。从零跑通完整包见[快速开始](/plugins/quickstart)。

::: warning 预览阶段提醒
当前可执行协议是 `1.0.0-beta.1`，不是 Stable v1。`0.1.1-rc.2` 已交付 P1–P4 的机器契约、catalog/Host 协商、五项 UI capability 与两项会话只读 capability；P5 的免克隆作者命令、skill 和教程 fixture 仍在后续路线中。
:::

## `0.1.1-rc.2` 的 Public Beta 边界

| 阶段 | 已交付 |
| --- | --- |
| P1 | Draft 2020-12 manifest schema、generated TypeScript、共享正反例 corpus、产品/协议映射与 packed validator |
| P2 | required/optional 原子准入、exact resource grant、结构化 denial、受保护 owner generation 与 owner-gap restore |
| P3 | `commands`、`status`、`panes`、`overlays`、`notifications.publish` 的配额、刷新、unload/reload 与 stale-result 门禁 |
| P4 | exact-field `session.read` 与 exact-key `session.projections.read`，带 epoch/revision/seq、consistent cut、JSON/size bound 与 late-result 拒绝 |

这些能力可用于插件适配，但在生态 consumer、作者工具和 P7 证据关闭前仍为 Public Beta。机器入口是 `@dsh-blue/blue-api/protocol/v1` 与公开 [schema](/schema/blue.plugin.v1.schema.json)；新插件使用 canonical `blue.plugin.json`，不要从过渡期 flat manifest 起步。

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
| [`status.provider`](/plugins/status#独占-status-provider) (Experimental) | 接收 readonly status snapshot 的 render 函数 | reference runtime：替换整个 footer 的候选 provider |
| [`editor.extensions`](/plugins/editor-extensions) (Experimental) | passive shell、补全、action、submit transform | reference runtime：增强 Blue 自有编辑器而不读取其状态 |
| [`editor.provider`](/plugins/editor-providers) (Experimental) | 接收 readonly editor snapshot 的 shell render 函数 | reference runtime：用户选择的独占 editor shell 候选 |
| [`panes`](/plugins/dock) | 布局位置、canonical node 与结构化 event | header/left/right/bottom 插件面 |
| [`overlays`](/plugins/dock#overlay-契约) | canonical overlay request 与结构化 event | 受 Blue focus/lifecycle 托管的浮层 |
| [`notifications.publish`](/plugins/notifications) | 只发布 `BlueNotification` | 编辑器通知条；没有全局 observe |
| [`session.read`](/plugins/session) | exact-field、带 epoch/revision 且深度冻结的当前会话 snapshot | result-bearing `current()` 与 effect-bound `subscribe()` |
| [`session.projections.read`](/plugins/session#projection-cut) | exact-key、带 epoch/seq 的 projection JSON cut | `current()`、consistent `currentMany()` 与 key-set `subscribe()` |

generic `session.act` 已移除；写操作使用所属 Harness service 或 feature-owned action。`null` 只表示 read owner 在线但当前无 session；read owner 缺失时返回 `BLUE_CAPABILITY_ABSENT`，不会回退到未收窄的 app service。旧名 `dock`、`panels`、`editor` 与 `tools` 已从公开 manifest 删除；校验器会返回具体迁移提示。

## 文档地图

**开始**

- [快速开始](/plugins/quickstart) —— 十分钟从零跑通一个插件：包骨架、manifest、安装、验证、卸载；
- [核心概念](/plugins/concepts) —— Cordis 树与 Fiber 生命周期、capability 裁剪、canonical node 词汇表、`BlueResult` 错误码、domain/adapter 拆分；
- [公共 UI Kit](/plugins/ui-kit)、[UI 节点参考](/plugins/ui-reference)与[示例目录](/plugins/examples) —— 纯 builder、逐字段契约、共享组件和六个打包示例。

**贡献能力** —— 每个能力一页：契约表、完整示例、行为细节与常见错误。

- [命令](/plugins/commands) · [状态栏与独占 provider](/plugins/status) · [编辑器扩展](/plugins/editor-extensions) · [编辑器 Provider](/plugins/editor-providers) · [Pane 与 Overlay](/plugins/dock) · [通知](/plugins/notifications) · [会话只读数据](/plugins/session)

**验证与发布**

- [调试与验证](/plugins/testing) —— profile 安装、迭代回路、validate/fixture 脚本、卸载语义检查；
- [旧 UI API 迁移](/plugins/ui-migration) —— 从 dock/panel/renderer facade 迁到 canonical pane、overlay 和 provider；
- [发布插件](/plugins/publishing) —— npm 发布与用户安装路径。

**参考**

- [Seam 参考](/plugins/seams) —— Beta plugin host 与 Blue 内部边界的完整清单；
- [内置插件](/plugins/builtins) —— bundle 的 33 条 Blue 自有行，是最完整的插件范例集；
- [贡献本仓库](/plugins/contributing) —— 给 Blue 本体贡献代码的本地开发流程。
