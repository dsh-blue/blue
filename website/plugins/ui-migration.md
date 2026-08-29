# 旧 UI API 迁移

新的公开边界是 canonical node + capability-scoped registry。迁移目标不是把旧
renderer object 包一层，而是让 Blue 拥有 layout、focus、width 与生命周期。

| 旧用法 | 新用法 | 迁移动作 |
| --- | --- | --- |
| `dock` / `BlueDockContribution` | `panes` / `BluePaneContribution` | 设 `placement: 'bottom'`，把 `view` 改为 `render`，用 `size` 表达预算 |
| `panels` 或私有 panel registry | `panes` | 选择 header/left/right/bottom，声明 `narrow` 降级 |
| `BlueComponent`、core factory、pi-tui component | `BlueUiNode` + `@dsh-blue/blue-ui` | 返回 canonical node，删除 renderer/terminal import |
| 直接 `showOverlay()` | `overlays.open()` | 贡献 `BlueOverlayRequest`；capturing overlay 消费当前 `userGesture` |
| additive status 用来重写 footer | `status.provider` | 注册 inert candidate，由用户设置选择 |
| editor facade 或 raw input hook | `editor.extensions` / `editor.provider` | 简单增强用 extension；完整 shell 保留恰好一个 `editor-control` |
| module singleton / 手工 dispose | Cordis Fiber 注册 | 把注册放进 `apply(ctx)`，由 consumer Fiber 自动回滚 |

## Bottom dock 迁移示例

```ts
// 旧：capabilities: ['dock']; api.dock.register({ view, preferredRows })
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'acme.activity',
  api: '^1.0.0-beta.1',
  capabilities: ['panes'],
})
if (!opened.ok) return

opened.value.panes?.register({
  id: 'acme.activity.log',
  title: 'Activity',
  placement: 'bottom',
  size: { min: 2, preferred: 4, max: 8 },
  narrow: 'bottom',
  render: () => ui.sections([
    { body: ui.text('Ready', { tone: 'success' }) },
  ]),
})
```

`priority` 不再让插件覆盖用户布局；lane、顺序、active pane、显示状态与尺寸由
宿主和 profile 设置持有。side lane 空间不足时按 `narrow` 迁移或停放，不由
插件读取 `process.stdout.columns` 决定。

## 生命周期与事件

- 检查 `open()`、`register()`、`open overlay` 的每个 `BlueResult`；
- 不缓存 user gesture；它只在当前 Blue 用户 dispatch 内有效；
- 不保留并复用卸载后的 registry、command、registration 或 overlay handle；
- `render()` 同步、纯净、无 I/O；异步工作放在 domain service，结果通过
  registration `refresh()` 请求重绘；
- `onEvent` 使用 context 的 `signal` 与 `revision`，忽略 abort 后的迟到结果。

## Provider 迁移

安装 provider 只增加候选，不得写 `blue.statusProvider` 或
`blue.editorProvider`。选择、原子切换、失败回滚与 breaker 都归 owner。Editor
provider 只能重排 shell metadata，并且每个候选必须恰好包含一个可见
`editor-control`；draft、history、focus 与 IME engine 始终由 Blue 保留。

迁移后运行静态 validator、独立 packed fixture、Fiber unload、late-result 与宽度
扫描。参考实现见[示例目录](/plugins/examples)，完整节点构造见
[公共 UI Kit](/plugins/ui-kit)。
