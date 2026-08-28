# Dock panes

The `dock` capability registers a pane into the bottom area above the editor. The bottom area is Blue's "dashboard" slot — the built-in activity, queue, todo, btw, and agents panes all line up here, and your pane sits alongside them.

## Contract

```ts
api.dock?.register(contribution: BlueDockContribution): BlueResult<BlueRegistration>
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | a lowercase namespace id of 1–128 characters |
| `view` | `BlueView \| (() => BlueView \| null)` | a static view, or a function returning the current view (returning `null` shows nothing for that frame) |
| `priority` | `number?` | optional integer, default 50. **Dock panes sort by priority** (smaller first; ties break by registration order) |
| `preferredRows` | `number?` | preferred row count, an integer in 0–20; absent or out-of-range values clamp to the 20-row ceiling |
| `minRows` | `number?` | minimum row count, an integer in 0–20. **Reserved field**: not yet consumed by the current renderer |
| `collapsible` | `boolean?` | whether the user may collapse the pane. **Reserved field**: not yet consumed by the current renderer |

Out-of-range `preferredRows` / `minRows` (non-integer or outside 0–20) returns `BLUE_LIMIT_EXCEEDED` from `register()`.

## Full example

A pane showing todo counts (data comes from Harness service injection):

```ts
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'my-plugin.metrics',
  api: '^1.0.0',
  capabilities: ['dock'],
})
if (!opened.ok) return

opened.value.dock?.register({
  id: 'metrics.pane',
  priority: 40,
  preferredRows: 3,
  view: () => ({
    kind: 'fields',
    rows: [
      { label: 'requests', value: [{ text: String(stats.requests) }] },
      { label: 'errors', value: [{ text: String(stats.errors), tone: stats.errors > 0 ? 'danger' : 'muted' }] },
      { label: 'uptime', value: [{ text: formatUptime(stats.startedAt), tone: 'muted' }] },
    ],
  }),
})
```

Compose multi-part content with `sections`; `body` recurses as any `BlueView`:

```ts
view: {
  kind: 'sections',
  sections: [
    { title: 'summary', body: { kind: 'text', content: '...' } },
    { title: 'last diff', collapsed: true, body: { kind: 'diff', before: oldCode, after: newCode } },
  ],
}
```

## Behavior details

- **A pane-set change rebuilds the whole area**: when any dock contribution registers or unregisters, the bottom area rebuilds all plugin panes in the priority order of the current snapshot. The `view` function re-evaluates on the new frame — no manual refresh needed;
- **Row counts are a budget, not a promise**: `preferredRows` clamps to the renderer's plugin-view row ceiling (20); when the terminal is too narrow, over-wide rows are truncated — width budgeting is the renderer's job, see [Core concepts](/en/plugins/concepts#the-blueview-vocabulary);
- **The gutter is added by the renderer**: the separator bar on a pane's left edge is drawn uniformly by the renderer — do not draw your own borders in the view;
- **Static view vs function view**: an unchanging nameplate uses a static `BlueView`; state-varying content uses a function — it re-evaluates every frame, so keep it cheap too.

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| `BLUE_LIMIT_EXCEEDED` | `preferredRows` / `minRows` is not an integer or outside 0–20 |
| `BLUE_INVALID_CONTRIBUTION` | `view` is neither an object nor a function |
| the pane never appears | the function view returned `null`; `register()` failed unchecked; the pane was pushed out of the visible area by later higher-priority panes |
| pane order is not what you expected | check each pane's `priority` (default 50); ties break by registration order |

## Reference

- The built-in panes live in two packages: activity, todo, btw, and agents in `blue-transcript`, queue in `blue-interaction` ([Built-in plugins](/en/plugins/builtins));
- How a dock contribution flows inside Blue: public contribution → view bridge → core's bounded dock mount, without entering the built-in pane registry; see the [Seam reference](/en/plugins/seams).
