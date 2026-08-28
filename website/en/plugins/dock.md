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

```ts
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'acme.inspector',
  api: '^1.0.0',
  capabilities: ['panes'],
})
if (!opened.ok) return

opened.value.panes?.register({
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
```

Blue creates lane tabs when multiple side panes compete. A plugin controls only
the active pane's interior and cannot split the outer lane again. The returned
handle supports `refresh()` and `setHidden()`; both the registration and handle
are consumer-Fiber bound, so retained calls are rejected after unload.

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
api.commands?.register({
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
```

Gestures cannot be cached, transferred, or reused across asynchronous user
operations. Close, failure, timeout, and plugin unload all remove the overlay;
the host restores the previous focus.

## Responsive layout and width

- `narrow` controls the outer lane; use `ui.child(node, { when })` for local node visibility;
- never read terminal columns, hand-wrap text, or embed ANSI; core compiles nodes with the single width truth;
- `size` is a constraint hint, not a fixed pixel or row/column promise; very narrow layouts may park or hide a contribution;
- do no I/O in `render()`; update external state and call the registration's `refresh()`.

See the runnable [header, right inspector, bottom log, and overlay examples](/en/plugins/examples).
For migration from old `dock` contributions, use the [migration guide](/en/plugins/ui-migration).
