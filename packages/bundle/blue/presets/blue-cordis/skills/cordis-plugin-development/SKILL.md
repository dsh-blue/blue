---
name: cordis-plugin-development
description: >-
  Create, modify, debug, or roll back temporary dynamic Cordis plugins in a
  blue-cordis session, including additive Blue UI prototypes. Use for inspect,
  define, run, iterate, stop, and rollback before packaging an accepted feature.
---

# Develop dynamic Cordis plugins

Dynamic plugins are process-local experiments. They disappear when the toolset
unloads or dsh restarts, create no package files, install no dependencies, and
modify no composition. `cordis_stop` pauses a run while keeping its immutable
packages; `cordis_undefine` permanently removes it.

The evaluator is not a security boundary. Granted services affect the live
runtime, so treat this workflow like shell access.

## Workflow

1. Discuss the visible behavior with the user.
2. Call `cordis_inspect_list` to discover current Providers and method schemas.
3. Query only the Services, Events, Builtins, or Tools the prototype needs.
4. For an existing dynamic plugin, read its exact package with
   `cordis_inspect_self(pluginId, packageId)`.
5. Write plain JavaScript in `code.host`, preview it, then call
   `cordis_define`.
6. Activate the returned exact package with `cordis_run`: `run` for the
   first/current package, `update` for a different package.
7. Inspect diagnostics, define a new immutable package to repair, and rerun.
8. Stop or undefine when finished.
9. After acceptance, ask whether to keep a local package, create a GitHub
   repository, publish to npm, or leave it ephemeral. Load
   `blue-plugin-development` only after that choice.

After `cordis_run` reports approval or startup pending, stop the current tool
flow and wait for the runtime update instead of busy-waiting.

## Define envelope

```json
{
  "plugin": { "kind": "new", "idPrefix": "probe" },
  "name": "Readable package name",
  "purpose": "One sentence describing the visible result.",
  "code": {
    "host": "return { name: 'probe', inject: ['bluePanes'], apply(ctx) { /* work */ } }"
  }
}
```

`idPrefix` matches `^[a-z]{3,6}$`. `inject` belongs on the returned plugin
object. `ctx` exists only inside `apply(ctx)` or another callback receiving
it.

## Use the current service graph

Provider and method names come from `cordis_inspect_list` and
`cordis_inspect_query`. At runtime, call the real service rather than
displaying or caching catalog output.

Use native dsh services directly for domain behavior:

- `commands` for commands;
- `sessionProjections` for projection snapshots;
- `tools` or the inspected `harness` Builtin for tool registration;
- other inspected dsh services for their own behavior.

Use Blue services only for terminal UI:

- `bluePanes`;
- `blueStatus`;
- `blueOverlays`;
- `blueEditorExtensions`.

Use `blueCurrentAgent.current()` when a native Agent-scoped service needs the
Agent selected by Blue. Do not guess service methods or depend on core
renderer objects such as `blueScreen`, `blueComponents`, raw focus, pi-tui,
ANSI, or terminal width.

## Direct Blue UI example

```js
return {
  name: 'health-probe',
  inject: ['commands', 'blueOverlays'],
  apply(ctx) {
    ctx.commands.register({
      name: 'health-probe',
      description: 'Open the health probe',
      handler() {
        ctx.blueOverlays.close('probe.health')
        ctx.blueOverlays.open({
          id: 'probe.health',
          title: 'Health',
          capturing: true,
          render: () => ({ kind: 'text', content: 'healthy', tone: 'success' }),
        })
        return { kind: 'success', text: 'opened health probe' }
      },
    })
  },
}
```

Registries reject invalid or duplicate ids by throwing. Native commands return
the native dsh command result shape. A capturing overlay is Escape-dismissible
unless `dismissible: false`.

Renderer-neutral nodes contain data, not pi-tui components. Render functions
are synchronous, cheap, and do no I/O.

## Execution environment

`code.host` is a plain JavaScript function body, not TypeScript or a module.
Do not use `import`, `require`, TypeScript syntax, decorators, or globals not
confirmed by `Builtin.listBuiltins`.

Read optional services with `ctx.get(name)` and handle absence. Declare
`inject` for hard dependencies that should put the plugin into Cordis waiting
until the service exists. The Guard rejects `ctx.service` access without the
matching injection.

The timer is a service. Query it, inject `timer`, and then use
`ctx.timeout`/`ctx.interval`; do not assume global timers exist.

## Lifecycle

Every side effect must disappear after stop, update, or undefine:

- service registrations are bound to the dynamic plugin Fiber;
- use `ctx.on()` for events;
- retain and call disposers from subscriptions or external APIs;
- use `ctx.effect()` for explicit cleanup;
- do not create process-wide state outside `apply()`;
- do not retain Agent/Session after current selection changes.

For a Waterfall event, query its exact signature and call `next()` unless the
listener intentionally stops downstream processing.

## Live data

Service instances, events, Agent, Session, projections, and tool state are live
host objects. Read only required leaf fields. Do not recursively enumerate,
clone, stringify, expose, or retain them. Construct owned JSON from the minimum
strings, numbers, and booleans needed by the UI or tool result.

## Versions and repair

A Plugin is the stable `pluginId`; a Package is an immutable `packageId`;
each activation has a `pluginRunId`. `currentPackageId` is the latest
successful package and `nextPackageId` is the pending or failed target.

After failure:

1. inspect the exact package and diagnostics;
2. refresh service/tool inspection if a dependency is unknown;
3. define a new package under the same plugin;
4. `update` to the new package, or `run` the current package to roll back.

Do not retry automatically after user rejection. Do not create a replacement
when an `@pluginId` target is unavailable.

## Common failures

| Failure | Check |
| --- | --- |
| service is not declared | add a true hard `inject`, or use `ctx.get()` with absence handling |
| `code.inject` is invalid | move `inject` onto the plugin returned by `code.host` |
| invalid id prefix | use 3-6 lowercase English letters |
| `ctx is not defined` | move the statement inside `apply(ctx)` |
| parse failure | remove TypeScript, imports, require, or unavailable globals |
| duplicate contribution id | choose a plugin-owned id or close/dispose the prior contribution |
| update failure | inspect next, define a repair, or explicitly run current to roll back |
