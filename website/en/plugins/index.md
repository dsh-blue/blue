# Writing your first plugin

Every surface in Blue is a Cordis plugin — your own enhancements stand **level** with the built-ins: the same seams, the same `/theme` hot-swap reload behavior, the same automatic rollback of every contribution on unload. This page walks you from zero to a working first plugin; for the full catalog of integration surfaces, see the [Seam reference](/en/plugins/seams).

::: warning Preview-stage caveat
Seam signatures are planned to freeze in Phase 3; plugins integrating today may need adaptation across upgrades. This page is kept in sync with every release.
:::

## The plugin model

A Blue plugin is a Cordis plugin — export `name` (a stable string), an optional `inject` (the services it waits for), and `apply(ctx)`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin.hello'
export const inject = ['blueComponents']

export function apply(ctx: Context): void {
  // …register your contributions
}
```

**Registration is an effect**: wrap every registration (component mounts, commands, keys, status entries) in `ctx.effect(() => ...)` — unloading the plugin's fiber rolls everything back, and `/theme` hot-swap reloads of dependents leave no residue.

## Your first plugin: a status-bar clock

Goal: add the current time to the status bar and register a `/now` command. The complete code:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin.clock'
export const inject = ['blueStatus', 'commands']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.blueStatus.register({
    id: 'my-plugin.clock',
    priority: 25,                     // built-ins occupy 0/5/10/20/30 — gaps are yours
    render: (width) => new Date().toLocaleTimeString(),
  }))

  ctx.effect(() => ctx.commands.register({
    name: 'now',
    description: 'Print the current time',
    handler: () => ({ kind: 'success', text: new Date().toLocaleString() }),
  }))
}
```

Notes:

- `inject` declares dependencies — the plugin activates only when the services exist, no hand-rolled waiting;
- both registrations return disposers and are effect-managed — everything vanishes on unload;
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

- [Seam reference](/en/plugins/seams) — the full catalog of seams Blue opens: screen, keymap, component factory, themes, status bar, render intents, the shared editor, and what each enables;
- [Built-in plugins](/en/plugins/builtins) — Blue's 21 built-ins are living examples of what plugins can do, each removable.

## Design discipline

1. Depend only on documented seams and contract packages (the `@dsh-blue/blue-*` type exports) — never Blue package internals;
2. Every registration returns a disposer and lives inside `ctx.effect`;
3. plain-first: your plugin stands level with Blue's built-in enhancements — there is no "internal channel";
4. New seams open only when a first real consumer appears, and may adjust before the signature freeze.
