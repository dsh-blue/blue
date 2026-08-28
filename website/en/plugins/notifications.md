# Notifications

The `notifications` capability provides a pair of renderer-neutral publish/subscribe channels. Blue's current presentation is a transient notice bar in the editor (toast-style), but that is the renderer's decision — your plugin only publishes a semantic `BlueNotification`.

## Contract

```ts
api.notifications?.publish(notification: BlueNotification): BlueResult
api.notifications?.subscribe(listener: (notification: BlueNotification) => void): BlueRegistration
```

`BlueNotification`:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | a lowercase namespace id of 1–128 characters |
| `view` | `BlueView` | the notification content; all five kinds are usable, and the current presentation summarizes the view into a single line of text |
| `tone` | `BlueTone?` | the semantic tone of the whole notification, used for coloring at presentation |

The `BlueRegistration` returned by `subscribe` likewise binds to the caller's Fiber and unsubscribes automatically on unload.

## Full example

Publish a notification after a command succeeds (paired with the [commands](/en/plugins/commands) capability):

```ts
api.notifications?.publish({
  id: 'clip.saved',
  view: { kind: 'text', content: `saved ${args.length} word(s)` },
  tone: 'success',
})
```

The subscribing side (for example, your adapter wants to forward notifications to its own log channel):

```ts
api.notifications?.subscribe((notification) => {
  // notification 是全树广播：会收到其他插件发布的通知
  myLogger.info(notification.id, notification.view)
})
```

## Behavior details

- **Tree-wide broadcast**: a `publish`ed notification reaches every subscriber plus Blue's presentation adapter — put your namespace in the id so subscribers can filter;
- **No dedup, no throttling**: the host neither merges same-id notifications nor rate-limits. Frequency control is the publisher's responsibility — throttle high-frequency events (progress ticks) yourself, or use the [status bar](/en/plugins/status) instead;
- **Failures are structured**: an illegal id or a non-object `view` makes `publish` return `BLUE_INVALID_CONTRIBUTION`; rejections from the presentation adapter are also returned as failures, never thrown;
- **A throwing subscriber hurts no one else**: a single listener's exception is isolated and blocks neither other subscribers nor the presentation;
- **Transient presentation**: the current notice bar neither queues nor keeps history. For persistently visible state, use the [status bar](/en/plugins/status) or a [pane](/en/plugins/dock).

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| `BLUE_INVALID_CONTRIBUTION` | the id contains uppercase/illegal characters, or `view` is missing |
| notification spam | no throttling on a high-frequency path — debounce on the publisher's side |
| subscribe receives nothing | `open()`'s capabilities did not declare `notifications`, so `api.notifications` is `undefined` |

## Reference

- How a notification flows inside Blue: public notification → interaction bridge → editor notice, see the [Seam reference](/en/plugins/seams).
