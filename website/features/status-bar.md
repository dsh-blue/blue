# 状态栏

状态栏（footer）是终端最底两行的 canonical status 表面。内置 producer 发布 readonly `BlueStatusNode`，由 package-private `BlueStatusEntryService` 和 core status compiler 渲染；第三方插件经当前 Beta `bluePluginHost` `status` capability 贡献同一种 renderer-neutral node。

## 布局与灰阶

两空格 slot 连接、没有分隔符字形；灰阶构成层级（对齐 kimi 视觉身份）：

| 档位 | 颜色 | 承载 |
| --- | --- | --- |
| 最亮 | `text` | model、context——你每轮都在读的信息 |
| 中 | `muted` | cwd、git 徽章、会话标题 |

（最暗的 `textMuted` tips 档已随 S30 footer 换位退役——教学提示只随 activity 面板的 spinner 行轮换。）

## 内置条目

| 条目 | 优先级 | 位置 | 内容 |
| --- | --- | --- | --- |
| `blue-status-basic` | 0 | 行 1 左簇 | model 名（取持久化 request 头，回退 agent 选项；`text` 色） |
| `blue-status-mode` | 2 | 行 1 左簇 | 会话模式徽标：`plan`（accent 色，有排队消息时带省略号）或 `yolo`（warning 色）；normal 态不渲染（见[会话模式](/features/modes)） |
| `blue-status-cwd` | 5 | 行 1 左簇 | 会话工作目录（home 缩写为 `~`，深路径缩到末三段；`muted` 色） |
| `blue-status-git` | 10 | 行 1 左簇 | 完整徽章 `branch [+a -d ↑e↓f]`（TTL 缓存探测：branch 5s / status 15s；非 git 仓库不显示） |
| `blue-status-context` | 20 | 行 2 右簇 | 最新一步的 context 占用：有窗口时 `context: N% (K/M)`，无窗口降级 `ctx N`（`text` 色） |
| `blue-status-title` | 30 | 行 1 右簇 | 会话标题（折叠自 harness `sessionTitle` 服务，muted 色；S30 换位前是轮换教学提示的槽位；无标题时不占位） |

运行中 agent 的状态**不在** footer——那是 activity 面板的职责（见[底部面板](/features/panes)）。

## 排序与让位规则

- 同带同簇内按 priority、稳定 id 升序；
- 右侧簇右对齐，宽度压力下先于左侧簇让位；
- 每个条目在簇内预算中自行截断；两行都放不下的条目按最低优先级丢弃。

## 下游贡献

第三方插件先用已校验的 canonical `manifest` 打开 `status` capability（required
请求包含 `{ "name": "status", "version": "^1.0.0" }`），再注册
`BlueStatusEntryContribution`：

```ts
const opened = ctx.bluePluginHost.open(ctx, manifest)
if (!opened.ok) throw new Error(opened.message)

const registered = opened.value.api.status!.register({
  id: 'build.status',
  priority: 15,
  render: () => ({ kind: 'text', content: myLine, tone: 'muted' }),
})
if (!registered.ok) throw new Error(registered.message)
```

Host 将 registration 绑定到调用方 Fiber；卸载时条目随之注销。Public status contribution 当前进入默认 footer lane；row/alignment 是 Blue 内部固定 footer 布局策略，不是第三方 renderer contract。
