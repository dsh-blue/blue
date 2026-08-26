# 状态栏

`status` 能力向底部 footer 注册一个状态条目。条目是 renderer-neutral 的：你的 `render()` 返回 `BlueView`，渲染器负责排版、配色与截断。

## 契约

```ts
api.status?.register(contribution: BlueStatusContribution): BlueResult<BlueRegistration>
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 1–128 字符的小写命名空间 id（`^[a-z0-9][a-z0-9._/-]*$`，允许点号） |
| `render` | `() => BlueView \| null` | 返回当前帧要显示的视图；返回 `null` 即本帧隐藏该条目 |
| `priority` | `number?` | 可选整数元数据，默认 50。**当前 footer 按注册顺序排布**，priority 只影响同一快照批内的相对顺序——不要依赖它做布局 |

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
- **超宽被截断**：footer 的宽度预算紧张，条目按 `truncate` 策略处理。内容保持短小——状态栏不是面板，长内容去 [dock](/plugins/dock)；
- **`fields` 视图会被压平**：状态条目的 `fields` 行的 value 片段会拼接为纯文本（tone/emphasis 在 status 位丢失），需要结构感就自己在 `text` 里留白。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| 条目从不出现 | `render()` 一直返回 `null`；或 `register()` 失败未检查返回值 |
| 条目内容不更新 | 数据变了但没触发重绘——状态条目随每次屏幕重绘重新求值，确认你的数据源真的更新了；频繁刷新场景可考虑配一个轻量定时器驱动 invalidation |
| 文本里嵌了 ANSI 导致错位 | 违反词汇表约定——只用 `tone`，见[核心概念](/plugins/concepts#blueview-词汇表) |

## 参考

- 内置状态条目（model、cwd、git、mode、title、context）的实现见 `blue-transcript`（[内置插件](/plugins/builtins)）；
- 状态条目在 Blue 内部的流转：public contribution → view bridge → footer `StatusModel`，见 [Seam 参考](/plugins/seams)。
