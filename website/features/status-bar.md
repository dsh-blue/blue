# 状态栏

状态栏（footer）是终端最底两行的**注册表驱动**表面：不是写死的组件，任何插件都能经 `blueStatus` 注册条目。壳组件把条目排进至多两条带（band）——第一行左簇 + 右簇，第二行右簇。

## 布局与灰阶

两空格 slot 连接、没有分隔符字形；三档灰阶构成层级（对齐 kimi 视觉身份）：

| 档位 | 颜色 | 承载 |
| --- | --- | --- |
| 最亮 | `text` | model、context——你每轮都在读的信息 |
| 中 | `muted` | cwd、git 徽章 |
| 最暗 | `textMuted` | 轮换 tips |

## 内置条目

| 条目 | 优先级 | 位置 | 内容 |
| --- | --- | --- | --- |
| `blue-status-basic` | 0 | 行 1 左簇 | model 名（取持久化 request 头，回退 agent 选项；`text` 色） |
| `blue-status-cwd` | 5 | 行 1 左簇 | 会话工作目录（home 缩写为 `~`，深路径缩到末三段；`muted` 色） |
| `blue-status-git` | 10 | 行 1 左簇 | 完整徽章 `branch [+a -d ↑e↓f]`（TTL 缓存探测：branch 5s / status 15s；非 git 仓库不显示） |
| `blue-status-context` | 20 | 行 2 右簇 | 最新一步的 context 占用：有窗口时 `context: N% (K/M)`，无窗口降级 `ctx N`（`text` 色） |
| `blue-status-tips` | 30 | 行 1 右簇 | 轮换教学提示，10 秒推进，宽度允许时 ` | ` 并列两条（`textMuted` 色，SWRR 加权轮换） |

运行中 agent 的状态**不在** footer——那是 activity 面板的职责（见[底部面板](/features/panes)）。

## 排序与让位规则

- 同带同簇内按 priority 升序（同优先级保持注册顺序）；
- 右侧簇右对齐，宽度压力下先于左侧簇让位；
- 每个条目在簇内预算中自行截断；两行都放不下的条目按最低优先级丢弃。

## 下游贡献

注册一个条目就是实现 `BlueStatusEntry`：

```ts
ctx.blueStatus.register({
  id: 'my-plugin.build',        // 稳定的点分插件自有字符串，重复注册会被拒绝
  priority: 15,                 // 内置条目占 0/5/10/20/30，空档任你使用
  row: 1,                       // 选带：1（默认）或 2
  align: 'left',                // 选边：'left'（默认）或 'right'
  render: (width) => myLine,    // 一行带样式文本，宽度不超预算；返回 '' 本帧不占位
})
```

注册应包在 `ctx.effect` 里——插件 fiber 卸载时条目随之注销。
