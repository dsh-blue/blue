# Dock 面板

`dock` 能力在编辑器上方的底部区域注册一个面板。底部区域是 Blue 的"仪表盘"位——内置的 activity、queue、todo、btw、agents 面板都排在这里，你的面板与它们并列。

## 契约

```ts
api.dock?.register(contribution: BlueDockContribution): BlueResult<BlueRegistration>
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 1–128 字符的小写命名空间 id |
| `view` | `BlueView \| (() => BlueView \| null)` | 静态视图，或返回当前视图的函数（返回 `null` 本帧不显示） |
| `priority` | `number?` | 可选整数，默认 50。**dock 面板按 priority 排序**（小在前，同值按注册先后） |
| `preferredRows` | `number?` | 期望行数，0–20 的整数；缺省或越界时钳制到上限 20 |
| `minRows` | `number?` | 最小行数，0–20 的整数。**预留字段**：当前渲染器尚未消费 |
| `collapsible` | `boolean?` | 是否可被用户折叠。**预留字段**：当前渲染器尚未消费 |

`preferredRows` / `minRows` 越界（非整数或不在 0–20）会在 `register()` 时返回 `BLUE_LIMIT_EXCEEDED`。

## 完整示例

一个显示待办数量的面板（数据来自 Harness 服务注入）：

```ts
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'my-plugin.metrics',
  api: '^1.0.0',
  capabilities: ['dock'],
})
if (!opened.ok) return

opened.value.dock?.register({
  id: 'metrics.pane',
  priority: 40,
  preferredRows: 3,
  view: () => ({
    kind: 'fields',
    rows: [
      { label: 'requests', value: [{ text: String(stats.requests) }] },
      { label: 'errors', value: [{ text: String(stats.errors), tone: stats.errors > 0 ? 'danger' : 'muted' }] },
      { label: 'uptime', value: [{ text: formatUptime(stats.startedAt), tone: 'muted' }] },
    ],
  }),
})
```

多段内容用 `sections` 组合，`body` 递归为任意 `BlueView`：

```ts
view: {
  kind: 'sections',
  sections: [
    { title: 'summary', body: { kind: 'text', content: '...' } },
    { title: 'last diff', collapsed: true, body: { kind: 'diff', before: oldCode, after: newCode } },
  ],
}
```

## 行为细节

- **面板集合变化会整体重排**：任何一个 dock 贡献注册/注销，底部区域按当前快照的 priority 顺序重建全部插件面板。`view` 函数在新一帧重新求值，不需要手动刷新；
- **行数是预算不是承诺**：`preferredRows` 会被钳制到渲染器的插件视图行上限（20）；终端太窄时超宽行会被截断——宽度预算是渲染器的事，见[核心概念](/plugins/concepts#blueview-词汇表)；
- **gutter 是渲染器加的**：面板左侧的分隔竖线由渲染器统一绘制，你的 view 里不要自己画边框；
- **静态 view 与函数 view 的选择**：内容不变的铭牌用静态 `BlueView`；随状态变化的用函数——它每帧重新求值，同样要保持廉价。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| `BLUE_LIMIT_EXCEEDED` | `preferredRows` / `minRows` 非整数或超出 0–20 |
| `BLUE_INVALID_CONTRIBUTION` | `view` 既不是对象也不是函数 |
| 面板不出现 | 函数 view 返回了 `null`；`register()` 失败未检查；面板被后续高 priority 面板挤到可视区外 |
| 面板顺序不符合预期 | 检查各面板的 `priority`（默认 50），同值按注册先后 |

## 参考

- 内置面板分处两个包：activity、todo、btw、agents 在 `blue-transcript`，queue 在 `blue-interaction`（[内置插件](/plugins/builtins)）；
- dock 贡献在 Blue 内部的流转：public contribution → view bridge → `DockModel` lane，见 [Seam 参考](/plugins/seams)。
