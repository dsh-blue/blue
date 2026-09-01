# `@dsh-blue/blue-app`

English | [中文](README.zh.md)

Blue's startup and current-Agent coordinator. It resolves or creates Agents
through native dsh services and exposes `ctx.blueCurrentAgent`:

```ts
const agent = ctx.blueCurrentAgent.current()
const stop = ctx.blueCurrentAgent.subscribe((next, revision) => {
  // next is the exact live Agent selected by Blue, or null
})
```

The package also owns session navigation request events, request lifecycle,
retraction, title cadence, and the process exit epitaph. Commands,
projections, tools, settings, and all other domain behavior remain on native
dsh services.
