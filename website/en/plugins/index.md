# Writing a Blue plugin

Every surface in Blue is a Cordis plugin — your own enhancements stand **level** with the built-ins: the same seams, the same `/theme` hot-swap reload behavior, the same automatic rollback of every contribution on unload. This page is the minimal knowledge to get started.

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

## The seams Blue opens

Downstream plugins may only import documented contracts and subpaths — never Blue package internals:

| Seam | Entry | What you can do |
| --- | --- | --- |
| Screen mount | `ctx.blueScreen` | Mount components (`addChild` returns a disposer), open overlays, `setFocus`, request renders |
| Key registration | `ctx.blueKeymap` | Register contextual/global keys; conflicts surface at registration, never fight at runtime |
| Component factory | `ctx.blueComponents` | Create editor/markdown/select/image components + width/fuzzy pure functions — no pi-tui anywhere |
| Terminal facts | `ctx.blueTerminalInfo` | Read the OSC 11 background probe and keyboard-protocol capabilities |
| Theme | `blueTheme` provider swap | Provide a whole palette (28 tokens), hot-switched by `/theme` |
| Status bar | `ctx.blueStatus` | Register footer entries (priority/row/align) |
| Render intents | `ctx.blueIntents` | Provide custom cards for new tool kinds (how diff and terminal cards exist) |
| Session facts | `ctx.blueSession` + `blue/session-changed` etc. | Read the current Agent, track switches, trigger resume/new/fork |
| Shared editor | module-level `editor-instance` + `blue/input-editor-changed` | Layer autocomplete providers, `onKey` interception, submit transformers |
| Chrome helpers | `@dsh-blue/blue-core/chrome` subpath | Theme-agnostic frame/rule/hint drawing pure functions |

Seams inherited from the harness are open to you too: `ctx.commands.register` (slash commands, auto-listed in completion), `ctx.userQuestions.registerProvider` (take over questions), the `'approval/request'` waterfall, `attachments`, and `ctx.tools` / `ctx.agents` / `ctx.sessions`.

## A complete example

A plugin adding a clock entry to the status bar and registering a `/now` command:

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

Both registrations return disposers and are effect-managed — they vanish on unload, and `/now` appears in the editor's slash completion automatically.

## Assembly into a profile

Plugins enter the composition layer as a **subpath export + patch row**: export a subpath in your package's `package.json`, then add a row to the profile's `cordis.patch.yml`:

```yaml
- id: my-plugin-clock
  name: 'my-scope/my-pkg/clock'
```

Rows add, delete, and reorder freely — Blue's own 21 rows are assembled exactly this way (see the [features overview](/en/features/)). Zero-code customization: don't want a surface? Delete its row.

## Design discipline

1. Depend only on documented seams and contract packages (the `@dsh-blue/blue-*` type exports);
2. Every registration returns a disposer and lives inside `ctx.effect`;
3. plain-first: your plugin stands level with Blue's built-in enhancements — there is no "internal channel";
4. New seams open only when a first real consumer appears, and may adjust before the signature freeze.
