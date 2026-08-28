# Legacy UI API migration

The new public boundary is canonical nodes plus capability-scoped registries.
Migration does not wrap an old renderer object; it transfers layout, focus,
width, and lifecycle ownership to Blue.

| Old use | New use | Migration action |
| --- | --- | --- |
| `dock` / `BlueDockContribution` | `panes` / `BluePaneContribution` | set `placement: 'bottom'`, rename `view` to `render`, express budget through `size` |
| `panels` or a private panel registry | `panes` | choose header/left/right/bottom and declare a `narrow` fallback |
| `BlueComponent`, core factory, pi-tui component | `BlueUiNode` + `@dsh-blue/blue-ui` | return canonical nodes and remove renderer/terminal imports |
| direct `showOverlay()` | `overlays.open()` | contribute `BlueOverlayRequest`; a capturing overlay consumes the current `userGesture` |
| additive status used to replace the footer | `status.provider` | register an inert candidate selected by user settings |
| editor facade or raw input hook | `editor.extensions` / `editor.provider` | use an extension for additive behavior; keep exactly one `editor-control` in a full shell |
| module singleton / manual dispose | Cordis Fiber registration | register inside `apply(ctx)` and let the consumer Fiber roll it back |

## Bottom dock migration example

```ts
// Old: capabilities: ['dock']; api.dock.register({ view, preferredRows })
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'acme.activity',
  api: '^1.0.0',
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

Plugin `priority` no longer overrides user layout. The host and profile own the
lane, order, active pane, visibility, and size. When a side lane no longer
fits, Blue follows `narrow` or parks the pane; plugins do not inspect
`process.stdout.columns`.

## Lifecycle and events

- check every `BlueResult` from `open()`, `register()`, and overlay open;
- never cache a user gesture; it is valid only within the current Blue-owned dispatch;
- never retain and reuse a registry, command, registration, or overlay handle after unload;
- keep `render()` synchronous, pure, and free of I/O; do asynchronous work in a domain service and request redraw through registration `refresh()`;
- honor event-context `signal` and `revision`, ignoring late results after abort.

## Provider migration

Installing a provider only adds a candidate. It must not write
`blue.statusProvider` or `blue.editorProvider`; selection, atomic swap, failure
rollback, and breakers belong to the owner. An editor provider may rearrange
shell metadata but must contain exactly one visible `editor-control`; Blue
always retains the draft, history, focus, and IME engine.

After migration, run the static validator, independent packed fixture, Fiber
unload, late-result, and width scans. Use the [example catalog](/en/plugins/examples)
for runnable references and the [public UI kit](/en/plugins/ui-kit) for node
construction.
