---
name: blue-plugin-development
description: Create, extend, or migrate a durable ordinary Cordis plugin that uses native dsh services and optionally contributes Blue terminal UI. Use only after the user chooses persistence. Not for ephemeral prototypes, Blue repository maintenance, agent presets, marketplace submission, or publishing without explicit authorization.
---

# Develop a durable Blue plugin

Use this skill after the user asks for a persistent package or accepts a
dynamic prototype and chooses a durable outcome. Before that choice, use
`cordis-plugin-development` and do not create files, repositories, commits,
tags, releases, installs, or publications.

A Blue plugin is an ordinary Cordis plugin. It uses native dsh services
directly and adds Blue services only for terminal UI.

## 1. Confirm scope and outcome

Confirm whether the result is a local package, GitHub repository, npm package,
or intentionally ephemeral. Local persistence does not authorize GitHub, npm,
commit, profile mutation, or publication. Complete and verify a local package
before any separately authorized external action.

Map each behavior to a documented service:

- dsh domain behavior: `commands`, `sessionProjections`, `tools`,
  `settings`, `skills`, `planMode`, `sessionController`, or another
  documented native service;
- terminal UI: `bluePanes`, `blueStatus`, `blueOverlays`, or
  `blueEditorExtensions`;
- current frontend Agent: `blueCurrentAgent`, only when an Agent-scoped
  native service needs the exact selected Agent.

Use the installed package declarations and the DeepSeek Harness reference for
exact signatures. Do not invent methods from prose. If the required native
service or UI surface does not exist, stop and propose the smallest new service
contract instead of reaching into package internals.

Cordis service visibility still follows composition realms. A plugin composed
beside `planMode` may inject it directly. A root UI plugin reads the native
`plan` session projection and writes through the native `/plan` command instead
of reaching into the selected Agent's private context or adding an adapter.

## 2. Audit an existing package

Before editing, identify:

- the domain service or projection that owns truth;
- every Cordis entry, injection, subscription, timer, and disposer;
- direct renderer/ANSI use, raw event folding, module singleton state, and
  implicit composition ordering;
- package exports, files, peer dependencies, and existing patch rows.

Preserve domain behavior, but remove obsolete plugin-model wrappers rather than
carrying two public architectures. Renderer-neutral UI data must not become a
copy of Agent, Session, storage, credentials, or a private package object.

## 3. Create the ordinary package

A minimal package contains:

```text
my-plugin/
├── package.json
├── tsconfig.json
├── src/index.ts
└── cordis.patch.yml
```

`package.json` exposes the built entry and the patch:

```json
{
  "name": "@acme/build-health",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "default": "./lib/index.js"
    },
    "./cordis.patch.yml": "./cordis.patch.yml"
  },
  "files": ["lib/**/*", "cordis.patch.yml"],
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/dsh-commands": "^0.1.2-alpha.3",
    "@dsh-blue/blue-api": "^0.2.0-alpha.1",
    "@dsh-blue/blue-ui": "^0.2.0-alpha.1"
  }
}
```

Include only the peers actually imported. The package-owned
`cordis.patch.yml` inserts the public entry as one ordinary row:

```yaml
- insert:
    - id: '@acme/build-health'
      name: '@acme/build-health'
```

There is no additional Blue metadata file or authoring CLI.

## 4. Implement direct services

Every entry exports `name`, optional `inject`, and `apply(ctx)`:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@acme/build-health'
export const inject = ['commands', 'bluePanes']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'health',
    description: 'Show build health',
    handler: () => ({ kind: 'success', text: 'healthy' }),
  })

  ctx.bluePanes.register({
    id: 'acme.build-health',
    placement: 'right',
    narrow: 'bottom',
    render: () => ui.text('healthy'),
  })
}
```

Render functions are synchronous, cheap, and free of I/O. Blue owns terminal
layout, theme, width, focus, input routing, and safety. Event/completion/submit
callbacks honor their AbortSignal and reject stale results.

Registrations belong to the plugin Fiber. Use `ctx.on()`, `ctx.effect()`,
and returned disposers for every external listener, subscription, timer, or
resource. Do not retain Agent/Session across selection changes; read
`blueCurrentAgent.current()` at operation time or subscribe and clear derived
state on revision.

## 5. Verify the package

Use the package's normal TypeScript, lint, and test commands. Add focused tests
that mount a real Cordis Context with the services the entry injects and prove:

- direct native command/projection/tool behavior;
- exact current-Agent scope when used;
- UI definition shape and renderer-neutral output;
- duplicate/invalid registration failure where relevant;
- Fiber unload removes every contribution;
- async callback abort and late-result handling;
- 20/40/80/120 column rendering for visible UI.

Run `npm pack --dry-run`, install the packed artifact into an empty fixture,
import its public entry, and verify no workspace/link/file protocol leaked.

## 6. Accept in a dedicated profile

```sh
dsh plugin --profile blue-my-plugin add file:/absolute/path/to/my-plugin
dsh --profile blue-my-plugin
```

Rebuild and reinstall the file snapshot after source or dependency changes.
Exercise the primary workflow, narrow width, Agent/session switching, unload,
and restart. Never mutate the production `blue` profile for acceptance.

Wait for explicit human acceptance before GitHub or npm work. Repository
creation and publication require their own confirmed ownership, visibility,
authentication, organization, tag, and exact-version decisions.
