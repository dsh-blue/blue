# 通知

`notifications.publish` 是 publish-only 的 renderer-neutral 通知能力。当前 Blue 的呈现是编辑器里的瞬时通知条（toast 式），但这是 renderer 的决定——插件只发布语义化的 `BlueNotification`，不能观察其他插件的全局通知流。

## 契约

```ts
api.notifications?.publish(notification: BlueNotification): BlueResult
```

`BlueNotification`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 1–128 字符的小写命名空间 id |
| `view` | `BlueView` | 通知内容，五种 kind 均可用；当前呈现会把视图摘要为单行文本 |
| `tone` | `BlueTone?` | 整条通知的语义色调，用于呈现时着色 |

## 完整示例

命令执行成功后发一条通知（配合 [commands](/plugins/commands) 能力）：

```ts
const published = api.notifications?.publish({
  id: 'clip.saved',
  view: { kind: 'text', content: `saved ${args.length} word(s)` },
  tone: 'success',
})
if (published !== undefined && !published.ok) return published
```

## 行为细节

- **没有公共 observe**：只有 Blue 官方 owner 能消费内部通知流；普通插件不能订阅、转发或枚举其他插件通知；
- **不去重，有硬配额**：host 不合并同 id 通知；grant 会公开深度 64、4096 个容器、8192 个属性和 32 KiB primitive/key bytes 的有界克隆上限，通过预检后，序列化后的 `view` 仍须小于等于 32 KiB。同一 Cordis consumer 跨 canonical/legacy facade 共用滚动一秒 20 条的发布配额。高频进度仍应使用[状态栏](/plugins/status)；
- **失败是结构化的**：id 非法或 `view` 不是对象时返回 `BLUE_INVALID_CONTRIBUTION`，超出大小/速率配额返回 `BLUE_LIMIT_EXCEEDED`。owner observer 的异常按 observer 收容，不会让已接受的 publish 失败或阻断其它 observer；
- **瞬时呈现**：当前的通知条不排队、不留历史，owner gap 中也不会缓存或补发。需要持久可见的状态请用[状态栏](/plugins/status)或 [pane](/plugins/dock)。

## 常见错误

| 现象 | 原因 |
| --- | --- |
| `BLUE_INVALID_CONTRIBUTION` | id 含大写/非法字符，或 `view` 缺失 |
| `BLUE_LIMIT_EXCEEDED` | `view` 超过结构预检/最终 32 KiB 上限，或同一 consumer 在滚动一秒内已成功发布 20 条 |
| 通知刷屏 | 即使在硬上限内也不应把 progress tick 当通知；改用 status/pane |
| `api.notifications` 是 `undefined` | `open()` 的 capabilities 没声明 `notifications.publish` |
| 找不到 `subscribe` | 这是预期行为；全局 notification observation 是 owner-only control-plane 操作 |

## 参考

- 通知在 Blue 内部的流转：public notification → interaction bridge → editor notice，见 [Seam 参考](/plugins/seams)。
