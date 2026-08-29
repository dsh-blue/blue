# Notifications

`notifications.publish` is a publish-only renderer-neutral capability. Blue currently presents a transient notice bar in the editor, but that is a renderer decision: plugins publish semantic `BlueNotification` values and cannot observe other plugins' global notice stream.

## Contract

```ts
api.notifications?.publish(notification: BlueNotification): BlueResult
```

`BlueNotification`:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | a lowercase namespace id of 1–128 characters |
| `view` | `BlueView` | the notification content; all five kinds are usable, and the current presentation summarizes the view into a single line of text |
| `tone` | `BlueTone?` | the semantic tone of the whole notification, used for coloring at presentation |

## Full example

Publish a notification after a command succeeds (paired with the [commands](/en/plugins/commands) capability):

```ts
api.notifications?.publish({
  id: 'clip.saved',
  view: { kind: 'text', content: `saved ${args.length} word(s)` },
  tone: 'success',
})
```

## Behavior details

- **No public observation**: only Blue's official owner consumes the internal stream; ordinary plugins cannot subscribe to, forward, or enumerate other plugins' notices;
- **No dedup, no throttling**: the host neither merges same-id notifications nor rate-limits. Frequency control is the publisher's responsibility — throttle high-frequency events (progress ticks) yourself, or use the [status bar](/en/plugins/status) instead;
- **Failures are structured**: an illegal id or a non-object `view` makes `publish` return `BLUE_INVALID_CONTRIBUTION`; rejections from the presentation adapter are also returned as failures, never thrown;
- **Transient presentation**: the current notice bar neither queues nor keeps history, and an owner gap never buffers or replays it. For persistently visible state, use the [status bar](/en/plugins/status) or a [pane](/en/plugins/dock).

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| `BLUE_INVALID_CONTRIBUTION` | the id contains uppercase/illegal characters, or `view` is missing |
| notification spam | no throttling on a high-frequency path — debounce on the publisher's side |
| `api.notifications` is undefined | `open()` did not declare `notifications.publish` |
| `subscribe` is missing | expected: global notification observation is an owner-only control-plane operation |

## Reference

- How a notification flows inside Blue: public notification → interaction bridge → editor notice, see the [Seam reference](/en/plugins/seams).
