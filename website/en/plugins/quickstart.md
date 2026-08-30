# Quickstart

This guide builds a header-pane plugin from scratch. It uses only the public
`@dsh-blue/blue-api` and `@dsh-blue/blue-ui` packages, with no core, pi-tui, or
repository-internal imports.

Install the author tool, read the current machine catalog, then generate the
canonical local package:

```sh
npm install --global @dsh-blue/blue-plugin-kit@0.1.1-rc.3
blue-plugin catalog --json
blue-plugin create ./blue-workspace-header --name @acme/blue-workspace-header
```

The generator emits a no-build status baseline. The rest of this page adapts it
into a header pane. Take capability names, versions, resources, and quotas from
the catalog rather than inferring future surfaces from this prose.

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
    "@dsh-blue/blue-api": "0.1.1-rc.3",
    "@dsh-blue/blue-ui": "0.1.1-rc.3"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

Do not depend on core, pi-tui, or the dsh runtime. Plugins are ESM-only; any
build tool is acceptable as long as `exports` points to the emitted
`lib/index.js`.

## Manifest and composition row

`blue.plugin.json` is the single manifest shared by package discovery and runtime admission:

```json
{
  "$schema": "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json",
  "schemaVersion": 1,
  "id": "@acme/blue-workspace-header",
  "entry": ".",
  "api": "^1.0.0-beta.1",
  "compatibility": {
    "blue": ">=0.1.1-rc.3 <0.1.2",
    "harness": ">=0.1.1-rc.1 <0.1.2",
    "node": "^22.19.0 || >=24.0.0"
  },
  "capabilities": {
    "required": [
      {
        "name": "panes",
        "version": "^1.0.0",
        "resources": { "placements": ["header"] }
      }
    ],
    "optional": []
  }
}
```

`cordis.patch.yml` makes the installed package an opt-in Cordis row:

```yaml
- insert:
    - id: '@acme/blue-workspace-header'
      name: '@acme/blue-workspace-header'
```

The manifest `id` must equal the npm package name. `entry` is a public
`package.json.exports` subpath, not a `lib/` file path. The Cordis entry `name`
and loader-row `id` are separate namespaces; this tutorial keeps them aligned
for easier diagnostics, but the protocol does not require either to equal the
package name.
The compatibility ranges cover rc.3 Blue plus the current and previous Harness
lines exercised by this repository's packed fixture. Narrow them when a plugin
uses a Host feature that has a smaller verified matrix.

## Plugin entry

```ts
import type { Context } from '@deepseek-ai/cordis'
// Pull in the public Context.bluePluginHost declaration merge.
import type {} from '@dsh-blue/blue-api'
import { validateBluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1'
import { ui } from '@dsh-blue/blue-ui'
import manifestSource from '../blue.plugin.json' with { type: 'json' }

export const name = '@acme/blue-workspace-header'
export const inject = ['bluePluginHost']

const parsed = validateBluePluginManifestV1(manifestSource)
if (!parsed.ok) throw new TypeError(`invalid blue.plugin.json: ${parsed.issues[0]?.message ?? 'unknown issue'}`)
const manifest = parsed.value

export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, manifest)
  if (!opened.ok) return

  const registered = opened.value.api.panes?.register({
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
invalidates the pane and any retained API facade. This example expects
TypeScript `resolveJsonModule`; Node 22/24 loads the JSON through import
attributes. `opened.value.grants` records exact grants, while
`unavailableOptional` contains structured denials for optional capabilities.

## Install and verify

Use a dedicated development profile rather than your everyday `blue` profile:

```sh
dsh plugin --profile blue-header-dev add link:/path/to/blue-workspace-header
dsh --profile blue-header-dev
```

Close the static and dual-Harness packed gates before installation:

```sh
blue-plugin validate ./blue-workspace-header
blue-plugin conformance ./blue-workspace-header
blue-plugin conformance ./blue-workspace-header --harness-line 0.1.1-rc.1
```

After confirming the header appears, remove the plugin row or run
`/plugin remove`, then restart. The header must disappear completely. Before
publishing, also run the static validator, packed-install fixture, and narrow
width scans described in [Debugging and validation](/en/plugins/testing).

Continue with [Panes and overlays](/en/plugins/dock), the
[public UI kit](/en/plugins/ui-kit), the
[UI node reference](/en/plugins/ui-reference), the
[example catalog](/en/plugins/examples), and the
[legacy UI API migration guide](/en/plugins/ui-migration).
