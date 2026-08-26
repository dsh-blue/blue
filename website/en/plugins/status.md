# Status bar

The `status` capability registers a status bar entry into the bottom footer. Entries are renderer-neutral: your `render()` returns a `BlueView`, and the renderer handles layout, coloring, and truncation.

## Contract

```ts
api.status?.register(contribution: BlueStatusContribution): BlueResult<BlueRegistration>
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | a lowercase namespace id of 1–128 characters (`^[a-z0-9][a-z0-9._/-]*$`, dots allowed) |
| `render` | `() => BlueView \| null` | returns the view to display for the current frame; returning `null` hides the entry for that frame |
| `priority` | `number?` | optional integer metadata, default 50. **The footer currently lays out entries in registration order** — priority only affects relative order within the same snapshot batch; do not rely on it for layout |

## Full example

A status entry showing the git branch (data comes from Harness service injection, not the Blue API):

```ts
export const name = 'my-plugin.branch'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.branch',
    api: '^1.0.0',
    capabilities: ['status'],
  })
  if (!opened.ok) return

  let branch: string | null = null
  // ... 从 Harness 服务订阅分支变化，更新 branch ...

  opened.value.status?.register({
    id: 'branch.status',
    render: () => branch === null
      ? null // 没有仓库时整条隐藏
      : { kind: 'text', content: ` ${branch}`, tone: 'accent' },
  })
}
```

## Behavior details

- **`render()` is called on every frame** — every footer redraw re-evaluates all status entries. Treat it as a pure function: keep it cheap, no I/O, no large allocations. Update data elsewhere (subscriptions, timers); `render()` only reads the latest value;
- **Returning `null` hides, it does not remove**: the entry stays registered and may reappear on the next frame. Good for badges that are only visible in a certain state;
- **Over-wide entries are truncated**: the footer's width budget is tight, and entries are handled with a `truncate` policy. Keep content short — the status bar is not a panel; long content goes to the [dock](/en/plugins/dock);
- **A `fields` view is flattened**: the value spans of a status entry's `fields` rows are joined into plain text (tone/emphasis are lost in the status slot); if you need a sense of structure, pad it out yourself inside `text`.

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| the entry never appears | `render()` always returns `null`; or `register()` failed and the return value went unchecked |
| the entry content never updates | the data changed but no redraw was triggered — status entries re-evaluate on every screen redraw, so confirm your data source actually updated; for frequent-refresh scenarios, consider a lightweight timer driving invalidation |
| embedded ANSI in text causes misalignment | a violation of the vocabulary convention — use only `tone`, see [Core concepts](/en/plugins/concepts#the-blueview-vocabulary) |

## Reference

- The built-in status entries live in two packages: model, cwd, git, title, and context in `blue-transcript`, mode in `blue-interaction` ([Built-in plugins](/en/plugins/builtins));
- How a status entry flows inside Blue: public contribution → view bridge → footer `StatusModel`, see the [Seam reference](/en/plugins/seams).
