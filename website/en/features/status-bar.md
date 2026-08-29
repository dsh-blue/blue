# Status bar

The footer is a two-row canonical status surface. Built-in producers publish readonly `BlueStatusNode` values, rendered by the package-private `BlueStatusEntryService` and core status compiler. Third-party plugins contribute the same renderer-neutral nodes through the current Beta `bluePluginHost` `status` capability.

## Layout and gray tiers

Entries connect with two-space slots — no separator glyphs; brightness tiers build the hierarchy (the kimi visual identity):

| Tier | Color | Carries |
| --- | --- | --- |
| Brightest | `text` | model, context — what you read every turn |
| Middle | `muted` | cwd, git badge, session title |

(The dimmest `textMuted` tips tier retired with the S30 footer swap — teaching tips now ride only the activity pane's spinner rows.)

## Built-in entries

| Entry | Priority | Position | Content |
| --- | --- | --- | --- |
| `blue-status-basic` | 0 | row 1 left | model name (persisted request header, falling back to agent options; `text` tier) |
| `blue-status-mode` | 2 | row 1 left | session-mode badge: `plan` (accent tier, pending ellipsis while messages are queued) or `yolo` (warning tier); renders nothing in normal (see [Session modes](/en/features/modes)) |
| `blue-status-cwd` | 5 | row 1 left | session cwd (home shortened to `~`, deep paths to the last three segments; `muted` tier) |
| `blue-status-git` | 10 | row 1 left | full badge `branch [+a -d ↑e↓f]` (TTL-cached probe: branch 5s / status 15s; hidden outside a git repository) |
| `blue-status-context` | 20 | row 2 right | latest step's context occupancy: `context: N% (K/M)` with a window, degrading to `ctx N` without (`text` tier) |
| `blue-status-title` | 30 | row 1 right | the session title folded from the harness `sessionTitle` service (`muted` tier; the slot the rotating tips occupied before the S30 footer swap; hidden while untitled) |

A running agent's status is **not** in the footer — that's the activity pane's job (see [Bottom panes](/en/features/panes)).

## Ordering and yielding

- the same band and cluster sort by ascending priority, then stable id;
- right clusters right-align and yield before left ones under width pressure;
- each entry truncates within its cluster budget; entries that fit neither row drop lowest-priority-first.

## Contributing

A third-party plugin opens the status capability, then registers a `BlueStatusEntryContribution`:

```ts
const opened = ctx.bluePluginHost.open(ctx, {
  id: 'my-plugin.build',
  api: '^1.0.0-beta.1',
  capabilities: ['status'],
})
if (!opened.ok) throw new Error(opened.message)

const registered = opened.value.status!.register({
  id: 'build.status',
  priority: 15,
  render: () => ({ kind: 'text', content: myLine, tone: 'muted' }),
})
if (!registered.ok) throw new Error(registered.message)
```

The host binds the registration to the caller's Fiber, so the entry disappears on unload. Public status contributions currently enter the default footer lane; row/alignment are internal fixed-footer layout policy, not a third-party renderer contract.
