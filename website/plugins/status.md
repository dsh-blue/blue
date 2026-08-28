# 状态栏

`status` 能力向底部 footer 注册一个状态条目。条目是 renderer-neutral 的：你的 `render()` 返回 canonical `BlueStatusNode`，core status compiler 负责校验、排版、配色与截断。

## 契约

```ts
api.status?.register(contribution: BlueStatusEntryContribution): BlueResult<BlueRefreshRegistration>
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 1–128 字符的小写命名空间 id（`^[a-z0-9][a-z0-9._/-]*$`，允许点号） |
| `render` | `() => BlueStatusNode \| null` | 返回当前帧要显示的 canonical 非交互 status tree；返回 `null` 即本帧隐藏该条目 |
| `priority` | `number?` | 可选整数元数据，默认 50。Footer 按 priority、稳定 id 排序；row/alignment 仍是 Blue 内部策略 |

## 完整示例

一个显示 git 分支的状态条目（数据来自 Harness 服务注入，不是 Blue API）：

```ts
export const name = 'my-plugin.branch'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.branch',
    api: '^1.0.0',
    capabilities: ['status'],
  })
  if (!opened.ok) return

  let branch: string | null = null
  // ... 从 Harness 服务订阅分支变化，更新 branch ...

  opened.value.status?.register({
    id: 'branch.status',
    render: () => branch === null
      ? null // 没有仓库时整条隐藏
      : { kind: 'text', content: ` ${branch}`, tone: 'accent' },
  })
}
```

## 行为细节

- **`render()` 每帧都会被调用**——footer 每次重绘都会重新求值所有状态条目。把它当成纯函数：保持廉价，不做 I/O、不分配大对象。数据在别处（订阅、定时器）更新，`render()` 只读最新值；
- **返回 `null` 是隐藏，不是删除**：条目仍注册着，下一帧可能再出现。适合"只在某个状态下可见"的徽章；
- **超宽被截断**：footer 的宽度预算紧张，条目按 `truncate` 策略处理。内容保持短小——状态栏不是面板，长内容放进 [pane](/plugins/dock)；
- **只接受 status 子集**：`text`、`rich-text`、`fields`、`progress` 和递归 `stack` 可用；交互节点会被安全拒绝。Tone/emphasis 由 canonical compiler 保留。

## 独占 status provider

`status.provider` 注册的是替换整个 footer 的候选，而不是追加条目：

```ts
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'my-plugin.compact-status',
  api: '^1.0.0',
  capabilities: ['status.provider'],
})
if (!opened.ok) return

opened.value.statusProviders?.register({
  id: 'my-plugin.compact',
  render: snapshot => ({
    kind: 'text',
    content: `${snapshot.busy ? 'Working' : 'Ready'} · ${snapshot.session?.model?.id ?? 'No model'}`,
  }),
})
```

Candidate 注册后保持 inert，只有 `blue.statusProvider` 选中它时才调用 `render()`。Snapshot 是冻结的 readonly 副本，只含当前公开 session、经过校验的可见 additive entries 与 `busy` 标志。Blue 在 footer 的实际宽度下先编译并 dry-render，非法、零行、超过三行或运行失败的候选不会替换正常工作的同会话 provider。

选择写在 `settings.yaml`；`blue.default` 恢复内置 additive footer：

```yaml
blue:
  statusProvider: my-plugin.compact
```

缺失或失败的 desired id 会原样保留，renderer 不会偷偷改写设置。首次激活失败或 session 切换时使用 `blue.default`；同一 provider 在滚动 60 秒内失败三次会打开无定时器 breaker。切走后重新选择，或同 id 注册新 generation，才会重试。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| 条目从不出现 | `render()` 一直返回 `null`；或 `register()` 失败未检查返回值 |
| 条目内容不更新 | 数据变了但没触发重绘——状态条目随每次屏幕重绘重新求值，确认你的数据源真的更新了；频繁刷新场景可考虑配一个轻量定时器驱动 invalidation |
| 文本里嵌了 ANSI 导致错位 | 违反词汇表约定——只用 `tone`，见[核心概念](/plugins/concepts#blueview-词汇表) |

## 参考

- 内置状态条目分处两个包：model、cwd、git、title、context 在 `blue-transcript`，mode 在 `blue-interaction`（[内置插件](/plugins/builtins)）；
- 状态条目在 Blue 内部的流转：public contribution → view bridge → private footer entry registry → core status compiler，见 [Seam 参考](/plugins/seams)。
