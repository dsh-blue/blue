# Panes and overlays

`panes` adds UI to Blue's header, left, right, or bottom lane. `overlays` opens
a surface whose lifetime and focus are owned by the host. Both consume
canonical `BlueUiNode` values; plugins never handle renderer objects, terminal
coordinates, or raw focus handles.

## Pane contract

```ts
api.panes?.register(contribution: BluePaneContribution): BlueResult<BluePaneRegistration>
```

| Field | Meaning |
| --- | --- |
| `id` | globally unique contribution id outside Blue's reserved namespace |
| `placement` | `header \| left \| right \| bottom` |
| `size` | `min`, `preferred`, and `max` lane hints; the host makes the final allocation |
| `narrow` | degrade to `bottom`, an `overlay` entry, or `hidden` on narrow screens |
| `render` | synchronously returns `BlueUiNode \| null`; keep it pure and cheap |
| `onEvent` | optional structured event handler, with no raw keys or renderer objects |

Here `manifest` is a validated canonical manifest. It grants the `right`
placement to `panes` and requests `commands` plus `overlays` for the later
example. See the [quickstart](/en/plugins/quickstart) for the complete top-level
shape.

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

Blue creates lane tabs when multiple side panes compete. A plugin controls only
the active pane's interior and cannot split the outer lane again. The returned
handle supports `refresh()` and `setHidden()`; both the registration and handle
are consumer-Fiber bound, so retained calls are rejected after unload. The
canonical grant permits only declared placements. One consumer may register up
to eight panes, and each registration may successfully refresh at most 20 times
in a rolling second.

## Overlay contract

```ts
api.overlays?.open(request: BlueOverlayRequest, options?: {
  userGesture?: BlueUserGesture
}): BlueResult<BluePublicOverlayHandle>
```

A passive, non-capturing overlay can show transient details. A
`capturing: true` overlay may contain controls and acquire focus, but it must be
opened with the one-shot `userGesture` from the current Blue-owned dispatch:

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

Gestures cannot be cached, transferred, or reused across asynchronous user
operations. Close, failure, timeout, and plugin unload all remove the overlay;
the host restores the previous focus. The global overlay stack holds at most
four entries, one consumer may own at most one capturing overlay, and each
handle may successfully refresh at most 20 times in a rolling second. An
overlay is a transient action and is never buffered or replayed across an owner
gap/reload.

## Responsive layout and width

- `narrow` controls the outer lane; use `ui.child(node, { when })` for local node visibility;
- never read terminal columns, hand-wrap text, or embed ANSI; core compiles nodes with the single width truth;
- `size` is a constraint hint, not a fixed pixel or row/column promise; very narrow layouts may park or hide a contribution;
- do no I/O in `render()`; update external state and call the registration's `refresh()`.

See the runnable [header, right inspector, bottom log, and overlay examples](/en/plugins/examples).
For migration from old `dock` contributions, use the [migration guide](/en/plugins/ui-migration).
