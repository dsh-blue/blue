# Panes and overlays

## Pane

`bluePanes` supports `header`, `left`, `right`, and `bottom` placement.

```ts
export const inject = ['bluePanes']

export function apply(ctx: Context): void {
  const pane = ctx.bluePanes.register({
    id: 'acme.inspector',
    title: 'Inspector',
    placement: 'right',
    size: { min: 20, preferred: 30, max: 40 },
    narrow: 'bottom',
    render: () => ({ kind: 'text', content: 'healthy' }),
  })

  // Call after domain state changes:
  pane.refresh()
}
```

`narrow` may be `bottom`, `overlay`, or `hidden`. The handle also exposes
`setHidden(boolean)`.

## Overlay

```ts
export const inject = ['commands', 'blueOverlays']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'health',
    description: 'Open health details',
    handler: () => {
      ctx.blueOverlays.close('acme.health')
      ctx.blueOverlays.open({
        id: 'acme.health',
        title: 'Health',
        capturing: true,
        anchor: 'center',
        width: '70%',
        render: () => ({ kind: 'text', content: 'healthy' }),
      })
      return { kind: 'success', text: 'opened health details' }
    },
  })
}
```

A capturing overlay receives focus and is Escape-dismissible by default.
Only explicit `dismissible: false` disables this. A non-capturing overlay may
not contain interactive controls.

Pane and overlay ids are unique within their registry. Core still admits
render and event output. Fiber unload removes panes and closes overlays opened
by that Fiber.
