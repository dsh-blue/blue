# Writing your first plugin

Blue's extension surfaces are managed by a Cordis plugin host: your plugin declares capabilities, contributes renderer-neutral views/actions, and is rolled back automatically on unload. This page builds a first plugin against stable `@dsh-blue/blue-api`; see the [Seam reference](/en/plugins/seams) for the complete map.

::: warning Preview-stage caveat
Seam signatures are planned to freeze in Phase 3; plugins integrating today may need adaptation across upgrades. This page is kept in sync with every release.
:::

## The plugin model

A Blue plugin is a Cordis plugin — export `name` (a stable string), an optional `inject` (the services it waits for), and `apply(ctx)`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin.hello'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  // Register through the capability-scoped API
}
```

`bluePluginHost.open(ctx, manifest)` binds the API to the caller's Fiber; every contribution registration is rolled back when the plugin unloads.

## Your first plugin: a status-bar clock

Goal: add the current time to the status bar and register a `/now` command. The complete code:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'

export const name = 'my-plugin.clock'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'my-plugin.clock',
    api: '^1.0.0',
    capabilities: ['status', 'commands'],
  })
  if (!opened.ok) throw new Error(opened.message)

  const status = opened.value.status!.register({
    id: 'clock.status',
    priority: 25,
    render: () => ({ kind: 'text', content: new Date().toLocaleTimeString() }),
  })
  if (!status.ok) throw new Error(status.message)

  const command = opened.value.commands!.register({
    id: 'now',
    label: 'Print the current time',
    execute: async () => ({ ok: true, value: undefined }),
  })
  if (!command.ok) throw new Error(command.message)
}
```

Notes:

- `inject` declares the stable host dependency, so the plugin activates only when it exists;
- the manifest exposes only requested capabilities and failures are structured results;
- both registrations bind to the current Fiber and vanish on unload;
- `/now` appears in the editor's slash completion and `/help` automatically; no extra UI registration.

## Packaging and assembly

1. **Export a subpath**: expose the plugin entry in your package's `package.json` (e.g. `"./clock": "./lib/clock.js"`); the shape is identical to Blue's built-in plugins (see [Built-in plugins](/en/plugins/builtins)).
2. **Add a patch row** to the profile's `cordis.patch.yml`:

```yaml
- id: my-plugin-clock
  name: 'my-scope/my-pkg/clock'
```

3. **Install**: `dsh plugin --profile blue add link:/path/to/your/pkg` during development, or the marketplace's one-liner once it opens.

Rows add, delete, and reorder freely — zero-code customization: don't want a surface? Delete its row.

## Next steps

- [Seam reference](/en/plugins/seams) — the stable plugin host and Blue's internal projection/action/model boundaries;
- [Built-in plugins](/en/plugins/builtins) — the bundle's 28 Blue-owned rows and validation-only packages.

## Design discipline

1. Depend only on public contracts such as `@dsh-blue/blue-api`, never package internals;
2. Request only capabilities you use and handle every `BlueResult`;
3. Contributions are renderer-neutral data/actions;
4. Do not retain Agent, Session, renderer objects, or cross-Fiber mutable singletons.
