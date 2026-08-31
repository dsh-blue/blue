# Pane 与 Overlay

`panes` 向 Blue 的 header、left、right 或 bottom lane 增量贡献界面；`overlays`
打开由宿主管理生命周期与焦点的浮层。两者都接收 canonical `BlueUiNode`，插件不
接触 renderer、终端坐标或 raw focus handle。

## Pane 契约

```ts
api.panes?.register(contribution: BluePaneContribution): BlueResult<BluePaneRegistration>
```

| 字段 | 说明 |
| --- | --- |
| `id` | 全局唯一、非 Blue 保留命名空间的 contribution id |
| `placement` | `header \| left \| right \| bottom` |
| `size` | lane 的 `min`、`preferred`、`max` 尺寸提示；最终分配由宿主决定 |
| `narrow` | 窄屏时转到 `bottom`、提供 `overlay` 入口或 `hidden` |
| `render` | 同步返回 `BlueUiNode \| null`；保持纯净且廉价 |
| `onEvent` | 可选结构化事件 handler，不接收 raw key 或 renderer object |

下面的 `manifest` 是已校验的 canonical manifest；它为 `panes` 申请 `right`
placement，并按实际使用申请 `commands` 与 `overlays`。完整顶层结构见
[快速开始](/plugins/quickstart)。

```ts
const opened = ctx.bluePluginHost.open(ctx, manifest)
if (!opened.ok) return
const api = opened.value.api

const registered = api.panes?.register({
  id: 'acme.inspector.context',
  title: 'Context',
  placement: 'right',
  size: { min: 20, preferred: 30, max: 40 },
  narrow: 'bottom',
  render: () => ui.fields([
    { label: 'Mode', value: [{ text: 'normal', tone: 'success' }] },
    { label: 'Tokens', value: [{ text: '12k / 28k', tone: 'muted' }] },
  ]),
})
if (registered !== undefined && !registered.ok) ctx.logger.warn(registered.message)
```

多个 side pane 由 Blue 生成 lane tabs。插件只控制 active pane 内部，不能再次
切分外层 lane。注册返回的 handle 可 `refresh()` 和 `setHidden()`；注册与 handle
都绑定 consumer Fiber，卸载后调用会返回结构化拒绝。Canonical grant 只允许
manifest 声明的 placement；同一 consumer 最多 8 个 pane，每个 registration 的
`refresh()` 在滚动一秒内最多成功 20 次。

用户用 `F6` / `Shift+F6` 按布局顺序在 Editor 与可聚焦 pane 之间移动；跨过首尾
边界会回到 Editor。Lane tabs 由宿主管理，不复用 pane 内部的 Tab 语义；capturing
overlay 打开时会暂时独占焦点。

## Overlay 契约

```ts
api.overlays?.open(request: BlueOverlayRequest, options?: {
  userGesture?: BlueUserGesture
}): BlueResult<BluePublicOverlayHandle>
```

普通非 capturing overlay 可用于短暂详情。`capturing: true` 的 overlay 可以包含
交互控件并获得焦点，但必须由当前 Blue 用户操作携带的一次性 `userGesture` 打开：

```ts
const command = api.commands?.register({
  id: 'show-details',
  label: 'Show details',
  execute: async (_args, options) => {
    if (options?.userGesture === undefined) {
      return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'user gesture required' }
    }
    const result = api.overlays?.open({
      id: 'acme.details',
      title: 'Details',
      capturing: true,
      dismissible: true,
      anchor: 'center',
      width: '70%',
      maxHeight: '70%',
      render: () => ui.surface({
        chrome: 'overlay',
        child: ui.text('Opened by an explicit command'),
      }),
    }, { userGesture: options.userGesture })
    return result?.ok ? { ok: true, value: undefined } : result ?? {
      ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'overlay host unavailable',
    }
  },
})
if (command !== undefined && !command.ok) ctx.logger.warn(command.message)
```

Gesture 不能缓存、转交或跨异步用户操作重用。关闭、异常、超时与插件卸载都会
清理 overlay，并由宿主恢复先前焦点。全局 overlay stack 最多 4 个，同一 consumer
最多 1 个 capturing overlay；每个 handle 的 `refresh()` 同样限制为滚动一秒 20 次。
Overlay 是瞬时 action，owner gap/reload 不会缓存或重放。

## 响应式与宽度

- `narrow` 是外层 lane 策略；node 内部用 `ui.child(node, { when })` 做局部显示；
- 不读取终端列数，不手工换行，不嵌 ANSI；core 使用唯一宽度真值编译节点；
- `size` 是约束提示，不是固定像素或行列承诺；极窄窗口可停放或隐藏贡献；
- `render()` 不做 I/O。外部状态变化后调用 registration 的 `refresh()`。

完整可运行实现见 [header、right inspector、bottom log 与 overlay 示例](/plugins/examples)。
`BlueUiNode` 的全部字段、默认值和事件载荷见 [UI 节点参考](/plugins/ui-reference)；
从旧 `dock` contribution 迁移见[迁移指南](/plugins/ui-migration)。
