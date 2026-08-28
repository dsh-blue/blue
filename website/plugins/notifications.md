# 通知

`notifications` 能力提供一对 renderer-neutral 的发布/订阅通道。当前 Blue 的呈现是编辑器里的瞬时通知条（toast 式），但这是渲染器的决定——你的插件只发布语义化的 `BlueNotification`。

## 契约

```ts
api.notifications?.publish(notification: BlueNotification): BlueResult
api.notifications?.subscribe(listener: (notification: BlueNotification) => void): BlueRegistration
```

`BlueNotification`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 1–128 字符的小写命名空间 id |
| `view` | `BlueView` | 通知内容，五种 kind 均可用；当前呈现会把视图摘要为单行文本 |
| `tone` | `BlueTone?` | 整条通知的语义色调，用于呈现时着色 |

`subscribe` 返回的 `BlueRegistration` 同样绑定调用方 Fiber，卸载自动退订。

## 完整示例

命令执行成功后发一条通知（配合 [commands](/plugins/commands) 能力）：

```ts
api.notifications?.publish({
  id: 'clip.saved',
  view: { kind: 'text', content: `saved ${args.length} word(s)` },
  tone: 'success',
})
```

订阅侧（比如你的 adapter 想把通知转发到自己的日志渠道）：

```ts
api.notifications?.subscribe((notification) => {
  // notification 是全树广播：会收到其他插件发布的通知
  myLogger.info(notification.id, notification.view)
})
```

## 行为细节

- **全树广播**：`publish` 的通知会送达所有订阅者和 Blue 的呈现适配器——id 带上你的命名空间，便于订阅方过滤；
- **不做去重或节流**：host 不合并同 id 通知，也不限频。频率控制是发布方的责任——高频事件（进度 tick）请自己节流，或者改用[状态栏](/plugins/status)；
- **失败是结构化的**：id 非法或 `view` 不是对象时 `publish` 返回 `BLUE_INVALID_CONTRIBUTION`；呈现适配器的拒绝也会作为失败返回，不会抛异常；
- **订阅方异常不影响他人**：单个 listener 抛错会被隔离，不阻塞其他订阅者和呈现；
- **瞬时呈现**：当前的通知条不排队、不留历史。需要持久可见的状态请用[状态栏](/plugins/status)或 [pane](/plugins/dock)。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| `BLUE_INVALID_CONTRIBUTION` | id 含大写/非法字符，或 `view` 缺失 |
| 通知刷屏 | 高频路径上没有节流——在发布方侧做 debounce |
| 订阅收不到 | `open()` 的 capabilities 没声明 `notifications`，`api.notifications` 是 `undefined` |

## 参考

- 通知在 Blue 内部的流转：public notification → interaction bridge → editor notice，见 [Seam 参考](/plugins/seams)。
