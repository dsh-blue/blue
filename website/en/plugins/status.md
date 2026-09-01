# Status bar

The `status` capability registers a status bar entry into the bottom footer. Entries are renderer-neutral: your `render()` returns a canonical `BlueStatusNode`, and the core status compiler owns validation, layout, coloring, and truncation.

## Contract

```ts
api.status?.register(contribution: BlueStatusEntryContribution): BlueResult<BlueRefreshRegistration>
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | a lowercase namespace id of 1–128 characters (`^[a-z0-9][a-z0-9._/-]*$`, dots allowed) |
| `render` | `() => BlueStatusNode \| null` | returns the canonical non-interactive status tree for the current frame; returning `null` hides the entry for that frame |
| `priority` | `number?` | optional integer metadata, default 50. The footer sorts by priority then stable id; row/alignment remain internal Blue policy |

## Full example

A status entry showing the git branch (data comes from Harness service
injection, not the Blue API). Here `manifest` is a validated canonical manifest
whose required requests include
`{ "name": "status", "version": "^1.0.0" }`:

```ts
export const name = 'my-plugin.branch'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, manifest)
  if (!opened.ok) return

  let branch: string | null = null
  // ... subscribe to branch changes through a Harness service ...

  const registered = opened.value.api.status?.register({
    id: 'branch.status',
    render: () => branch === null
      ? null // hide the whole entry outside a repository
      : { kind: 'text', content: ` ${branch}`, tone: 'accent' },
  })
  if (registered !== undefined && !registered.ok) ctx.logger.warn(registered.message)
}
```

## Behavior details

- **Bounded registration and refresh**: one consumer may register at most 64 status entries. Each registration may successfully call `refresh()` at most 20 times in a rolling second; overflow returns `BLUE_LIMIT_EXCEEDED`;
- **`render()` is called on every frame** — every footer redraw re-evaluates all status entries. Treat it as a pure function: keep it cheap, no I/O, no large allocations. Update data elsewhere (subscriptions, timers); `render()` only reads the latest value;
- **Returning `null` hides, it does not remove**: the entry stays registered and may reappear on the next frame. Good for badges that are only visible in a certain state;
- **Over-wide entries are truncated**: the footer's width budget is tight, and entries are handled with a `truncate` policy. Keep content short — the status bar is not a panel; long content goes in a [pane](/en/plugins/dock);
- **Only the status subset is accepted**: `text`, `rich-text`, `fields`, `progress`, and recursive `stack` nodes are available; interactive nodes are rejected safely. The canonical compiler preserves tone/emphasis.
- **Failures and owner gaps are contained**: one failing `render()` cannot break the footer. Existing inert definitions restore after owner reload, but old callback results never replay.

## Exclusive status provider

> `status.provider` is an Experimental/reference surface and is not part of the Stable v1 root. The contract below records the executable implementation for provider collaboration and regression evidence.

This facet is available only through the explicitly legacy inline transition
manifest. The P1 canonical schema rejects `status.provider`, so do not copy the
following open shape into a new plugin manifest.

`status.provider` registers a candidate that replaces the whole footer rather than appending one entry:

```ts
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'my-plugin.compact-status',
  api: '^1.0.0-beta.2',
  capabilities: ['status.provider'],
})
if (!opened.ok) return

opened.value.statusProviders?.register({
  id: 'my-plugin.compact',
  render: snapshot => ({
    kind: 'text',
    content: `${snapshot.busy ? 'Working' : 'Ready'} · ${snapshot.session?.model?.id ?? 'No model'}`,
  }),
})
```

A candidate stays inert after registration; Blue calls `render()` only when `blue.statusProvider` selects it. The snapshot is a frozen readonly copy containing only the public current session, validated visible additive entries, and the `busy` flag. Blue compiles and dry-renders at the footer's actual width first, so an invalid, empty, over-three-row, or failing candidate cannot replace a working same-session provider.

Selection lives in `settings.yaml`; `blue.default` restores the built-in additive footer:

```yaml
blue:
  statusProvider: my-plugin.compact
```

A missing or failing desired id remains persisted; the renderer never silently rewrites it. First-activation failure and session switches use `blue.default`. Three failures for one provider in a rolling 60-second window open a timer-free breaker. Switching away and reselecting, or registering a new generation under the same id, permits another attempt.

## Common pitfalls

| Symptom | Cause |
| --- | --- |
| the entry never appears | `render()` always returns `null`; or `register()` failed and the return value went unchecked |
| the entry content never updates | the data changed but no redraw was triggered — status entries re-evaluate on every screen redraw, so confirm your data source actually updated; for frequent-refresh scenarios, consider a lightweight timer driving invalidation |
| embedded ANSI in text causes misalignment | a violation of the vocabulary convention — use only `tone`, see [Core concepts](/en/plugins/concepts#the-blueview-vocabulary) |

## Reference

- The built-in status entries live in two packages: model, cwd, git, title, and context in `blue-transcript`, mode in `blue-interaction` ([Built-in plugins](/en/plugins/builtins));
- How a status entry flows inside Blue: public contribution → view bridge → private footer entry registry → core status compiler; see the [Seam reference](/en/plugins/seams).
