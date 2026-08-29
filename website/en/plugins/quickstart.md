# Quickstart

This guide builds a header-pane plugin from scratch. It uses only the public
`@dsh-blue/blue-api` and `@dsh-blue/blue-ui` packages, with no core, pi-tui, or
repository-internal imports.

## Package skeleton

```text
blue-workspace-header/
├── blue.plugin.json
├── cordis.patch.yml
├── package.json
├── tsconfig.json
└── src/index.ts
```

Declare the Blue packages as dependencies and host-provided Cordis as a peer:

```json
{
  "name": "@acme/blue-workspace-header",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./lib/index.js" },
  "files": ["lib/**/*", "blue.plugin.json", "cordis.patch.yml"],
  "blue": { "manifest": "./blue.plugin.json" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@dsh-blue/blue-api": "^0.1.0",
    "@dsh-blue/blue-ui": "^0.1.0"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

Do not depend on core, pi-tui, or the dsh runtime. Plugins are ESM-only; any
build tool is acceptable as long as `exports` points to the emitted
`lib/index.js`.

## Manifest and composition row

`blue.plugin.json` requests the minimum capability:

```json
{
  "id": "@acme/blue-workspace-header",
  "api": "^1.0.0-beta.1",
  "entry": "./lib/index.js",
  "capabilities": ["panes"]
}
```

`cordis.patch.yml` makes the installed package an opt-in Cordis row:

```yaml
- id: '@acme/blue-workspace-header'
  name: '@acme/blue-workspace-header'
```

Keeping the package name, manifest id, exported `name`, and loader-row id
identical makes profile diagnostics much simpler.

## Plugin entry

```ts
import type { Context } from '@deepseek-ai/cordis'
// Pull in the public Context.bluePluginHost declaration merge.
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@acme/blue-workspace-header'
export const inject = ['bluePluginHost']

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: name,
    api: '^1.0.0-beta.1',
    capabilities: ['panes'],
  })
  if (!opened.ok) return

  const registered = opened.value.panes?.register({
    id: 'acme.workspace.summary',
    title: 'Workspace',
    placement: 'header',
    size: { min: 1, preferred: 3, max: 4 },
    narrow: 'hidden',
    render: () => ui.surface({
      chrome: 'lane',
      padding: 1,
      child: ui.stack.row([
        ui.richText([
          { text: 'Branch ', tone: 'muted' },
          { text: 'main', tone: 'accent', emphasis: 'strong' },
        ]),
        ui.child(ui.text('ready', { tone: 'success' }), {
          grow: 1,
          when: { minWidth: 32 },
        }),
      ], { gap: 1, align: 'center' }),
    }),
  })
  if (registered !== undefined && !registered.ok) ctx.logger.warn(registered.message)
}
```

The `ui` builders only construct and deeply freeze renderer-neutral nodes.
Blue's compiler owns terminal width, themes, focus, scrolling, and chrome. The
registration is bound to the current Cordis Fiber; unloading the plugin also
invalidates the pane and any retained API facade.

## Install and verify

Use a dedicated development profile rather than your everyday `blue` profile:

```sh
dsh plugin --profile blue-header-dev add link:/path/to/blue-workspace-header
dsh --profile blue-header-dev
```

After confirming the header appears, remove the plugin row or run
`plugin remove`, then restart. The header must disappear completely. Before
publishing, also run the static validator, packed-install fixture, and narrow
width scans described in [Debugging and validation](/en/plugins/testing).

Continue with [Panes and overlays](/en/plugins/dock), the
[public UI kit](/en/plugins/ui-kit), the [example catalog](/en/plugins/examples),
and the [legacy UI API migration guide](/en/plugins/ui-migration).
