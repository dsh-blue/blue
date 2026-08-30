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
- **No dedup, with hard quotas**: the host does not merge same-id notifications. The grant publishes bounded-clone ceilings of depth 64, 4,096 containers, 8,192 properties, and 32 KiB of primitive/key bytes; after preflight, the serialized `view` must still fit the exact 32 KiB limit. One Cordis consumer shares a 20-publishes-per-rolling-second budget across canonical and legacy facades. Use the [status bar](/en/plugins/status) for high-frequency progress;
- **Failures are structured**: an illegal id or non-object `view` returns `BLUE_INVALID_CONTRIBUTION`; payload/rate overflow returns `BLUE_LIMIT_EXCEEDED`. Owner-observer exceptions are contained per observer and cannot fail an accepted publish or block sibling observers;
- **Transient presentation**: the current notice bar neither queues nor keeps history, and an owner gap never buffers or replays it. For persistently visible state, use the [status bar](/en/plugins/status) or a [pane](/en/plugins/dock).

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| `BLUE_INVALID_CONTRIBUTION` | the id contains uppercase/illegal characters, or `view` is missing |
| `BLUE_LIMIT_EXCEEDED` | the `view` exceeds a structural-preflight or final 32 KiB limit, or this consumer already published 20 notices in the rolling second |
| notification spam | even below the hard cap, progress ticks belong in status or a pane |
| `api.notifications` is undefined | `open()` did not declare `notifications.publish` |
| `subscribe` is missing | expected: global notification observation is an owner-only control-plane operation |

## Reference

- How a notification flows inside Blue: public notification → interaction bridge → editor notice, see the [Seam reference](/en/plugins/seams).
