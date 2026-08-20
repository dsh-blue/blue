# Status bar

The footer — the terminal's bottom two rows — is a **registry-driven** surface: not a hardcoded component, but entries any plugin can register through `blueStatus`. A shell component arranges entries into at most two bands: row one with a left and right cluster, row two with a right cluster.

## Layout and gray tiers

Entries connect with two-space slots — no separator glyphs; three brightness tiers build the hierarchy (the kimi visual identity):

| Tier | Color | Carries |
| --- | --- | --- |
| Brightest | `text` | model, context — what you read every turn |
| Middle | `muted` | cwd, git badge |
| Dimmest | `textMuted` | rotating tips |

## Built-in entries

| Entry | Priority | Position | Content |
| --- | --- | --- | --- |
| `blue-status-basic` | 0 | row 1 left | model name (persisted request header, falling back to agent options; `text` tier) |
| `blue-status-cwd` | 5 | row 1 left | session cwd (home shortened to `~`, deep paths to the last three segments; `muted` tier) |
| `blue-status-git` | 10 | row 1 left | full badge `branch [+a -d ↑e↓f]` (TTL-cached probe: branch 5s / status 15s; hidden outside a git repository) |
| `blue-status-context` | 20 | row 2 right | latest step's context occupancy: `context: N% (K/M)` with a window, degrading to `ctx N` without (`text` tier) |
| `blue-status-tips` | 30 | row 1 right | rotating tips, advancing every 10s, two joined ` | ` when width allows (`textMuted` tier, SWRR-weighted rotation) |

A running agent's status is **not** in the footer — that's the activity pane's job (see [Bottom panes](/en/features/panes)).

## Ordering and yielding

- same band and cluster sort by ascending priority (registration order on ties);
- right clusters right-align and yield before left ones under width pressure;
- each entry truncates within its cluster budget; entries that fit neither row drop lowest-priority-first.

## Contributing

Registering an entry means implementing `BlueStatusEntry`:

```ts
ctx.blueStatus.register({
  id: 'my-plugin.build',        // stable dotted plugin-owned string; duplicates rejected
  priority: 15,                 // built-ins occupy 0/5/10/20/30 — gaps are yours
  row: 1,                       // band: 1 (default) or 2
  align: 'left',                // side: 'left' (default) or 'right'
  render: (width) => myLine,    // one styled line within budget; '' sits this frame out
})
```

Wrap registration in `ctx.effect` — the entry unregisters with the plugin fiber.
