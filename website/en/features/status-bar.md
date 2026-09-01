# Status bar

The footer uses at most two rows. Every built-in and third-party entry
registers on the same `blueStatus` service with a renderer-neutral
`BlueStatusNode`.

| Entry | Priority | Content |
| --- | --- | --- |
| basic | 0 | current model |
| mode | 2 | plan/yolo state |
| cwd | 5 | current working directory |
| git | 10 | branch and change summary |
| context | 20 | context occupancy |
| title | 30 | session title |

Entries sort by priority/id within a band. The right band yields first under
width pressure. An entry declares `row` and `overflow`; lower-priority
entries hide when space runs out.

Third-party contribution:

```ts
export const inject = ['blueStatus']

export function apply(ctx: Context): void {
  ctx.blueStatus.register({
    id: 'acme.health',
    priority: 15,
    band: 'right',
    visible: true,
    node: { kind: 'text', content: 'healthy', tone: 'success' },
  })
}
```

Registration follows the Fiber. See [plugin status entries](/en/plugins/status).
