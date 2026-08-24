---
name: cordis-plugin-development
description: Create, modify, debug, or roll back dynamic Cordis Plugins in this Blue session — HOST HALF ONLY. Covers the inspect → define → run → approve → diagnose lifecycle, runtime diagnostics, dynamic model Tools, approval failures, and version management. Blue is a terminal UI: a `code.client` half targets the browser slot system and has no surface here, so never write one; UI changes belong in Blue source (blue-plugin-development skill).
---

# Develop Dynamic Cordis Plugins (host half)

Dynamic plugins are temporary, process-local experiments: they live in the shared DSH process memory, are visible only to the session that defined them, and disappear on `cordis_stop`/`cordis_undefine`, toolset unload, or DSH restart. They create no plugin files, install no packages, and modify no `cordis.yml`. To keep an experiment, implement it as a composition row (editing-cordis-compositions) or a real Blue plugin (blue-plugin-development).

The vm sandbox isolates globals but is not a security boundary: host-realm helpers make escape possible, and granted services affect the live runtime. Treat this toolset like bash access.

## Standard workflow

1. Call `cordis_inspect_list` to obtain the Providers, methods, and schemas currently registered.
2. Select the smallest set of `cordis_inspect_query` calls needed to read the exact Services, Events, Builtins, or Tools that the implementation will use.
3. For a new Plugin, design its first Package. To modify an existing Plugin, first use `cordis_inspect_self(pluginId, packageId)` to read the base source and diagnostics.
4. Write plain JavaScript in `code.host` only, then call `cordis_define`.
5. Call `cordis_run` with the final `pluginId` and `packageId` returned by define.
6. Handle approval, waiting, and failures from the Run card, steering messages, or `cordis_inspect_self`.
7. Use `cordis_stop` to disable the Plugin temporarily. Use `cordis_undefine` only when it is no longer needed.

Do not wait in the same turn for user approval or asynchronous results. After `cordis_run` returns `awaiting-approval` or `starting`, end the current Tool flow and wait for the system to report the final outcome through state updates and steering.

## Tool usage guidance

| Tool | Use it when | Do not |
| --- | --- | --- |
| `cordis_inspect_list` | Discover current Providers and method schemas in one call; refresh after the runtime capability directory changes | Hard-code Provider names and skip list; treat a manifest as business data |
| `cordis_inspect_query` | Confirm exact Service methods, Event modes, Builtins, or Tool schemas before writing code | Use it instead of calling a real Service from the Plugin |
| `cordis_inspect_self` | List current Plugins, inspect version pointers, or read exact Package source and runtime diagnostics | Fetch all source just to build a list; use it to modify or start a Plugin |
| `cordis_define` | Create a Plugin's first version or append an immutable Package to an existing Plugin; let the user preview the code first | Expect define to execute `apply`, request approval, or update current |
| `cordis_run` | Activate an exact Package; use `run` for first activation, restart, or rollback, and `update` to switch versions | Use `run` to switch versions implicitly; treat pending or starting as success |
| `cordis_stop` | Pause current effects while preserving Packages, grants, and version pointers for later use | Use stop to mean permanent deletion |
| `cordis_undefine` | Permanently remove a Plugin and all of its Packages and clear historical business views | Call it while rollback, inspection, or restart is still needed |

## Provider navigation

Select methods from the actual `cordis_inspect_list` result. Common initial methods include:

- `Service.listService`: without `service`, returns every callable Service with its purpose and exact method signatures. Query the selected `service` again for access rules, structured method descriptions/parameters/returns, and only its referenced types.
- `Event.listEvents`: without `event`, returns every Event with its purpose, dispatch mode, and exact listener signature. Query the selected `event` again for its structured listener contract and only its referenced types; a Waterfall listener must call `next()`.
- `Builtin.listBuiltins`: returns evaluator-provided symbols and signatures that cannot be obtained through `ctx.get()`.
- `Tool.listTools`: returns Tool schemas actually visible to the current Agent, including dynamically registered Tools.

Provider names, methods, and inputs must come from the current list result. The Service/Event Catalog describes which interfaces this version permits; it does not guarantee that a Service is currently mounted. At runtime, use real Services and Events rather than caching or displaying Catalog query results.

In a Blue session the host service store also carries Blue's own L1 services (`blueScreen`, `blueKeymap`, `blueTerminalInfo`, `blueComponents`, and the transcript/interaction registries) — inspect them the same way before consuming one.

## Execution environment

`code.host` is a plain JavaScript function body that returns a Cordis Plugin. It is not compiled by TypeScript or a bundler.

Do not use:

- `import`, `require`, TypeScript types, `as`, or decorators;
- globals not confirmed by `Builtin.listBuiltins`;
- guessed access to `process`, `Buffer`, `fetch`, or native timers.

Correct:

```js
return {
  apply(ctx) {
    const sessions = ctx.get('sessions')
    if (sessions === undefined) return
    // use the queried service
  },
}
```

## Access Services

Read optional capabilities with `ctx.get(name)` by default and handle their absence. Declare `inject` only when a Service is a hard dependency and the Plugin must enter waiting until Cordis reactivates it after the Service appears:

```js
return {
  inject: ['requiredService'],
  apply(ctx) {
    ctx.requiredService.someMethod()
  },
}
```

Do not overuse `inject` merely to avoid an `undefined` check. Do not access `ctx.requiredService` without declaring the injection; the Guard rejects undeclared dependencies.

## Manage side effects

Every contribution must be removed after the Plugin is stopped, updated, or removed. The package `ctx` façade does NOT expose `effect()` — the supported cleanup paths are the disposers returned by Cordis APIs:

- Use `ctx.on()` to register Event listeners (removed with the fiber).
- Retain disposers returned by Cordis Service, Tool, and timer APIs.
- Do not create process-wide side effects at module scope or outside `apply()`.
- If a `subscribe()` does not return a disposer, first query whether the Service provides a supported cleanup mechanism. Do not assume unload automatically removes arbitrary third-party callbacks.

## Timers

The timer is a Service named `timer`, not a Builtin. Query `{ "service": "timer" }` through `Service.listService` before using it, and declare `inject: ['timer']` before using the timer mixin (`ctx.timeout`, `ctx.interval`). A global `setTimeout` does not exist in the sandbox.

## Listen to Events

Query the Event Provider first to confirm the parameter order, return value, and `mode`. The last parameter of a Waterfall Event is `next`; unless the listener intentionally stops downstream processing, it must call and return it:

```js
return {
  apply(ctx) {
    ctx.on('some/waterfall', (payload, next) => {
      console.log(payload)
      return next()
    })
  },
}
```

## Register a dynamic model Tool

The host `harness` Builtin registers a Tool callable in the next model step. First query the current `harness` signature with `Builtin.listBuiltins`, then inspect existing Tool names and schemas with `Tool.listTools` to avoid conflicts.

Tool arguments and return values must be JSON-compatible. `execute` owns the business result; render and presentation own only what the model and the UI see. Tool registration must belong to the current Plugin fiber so it is automatically removed after stop or update.

## Handle internal live data

Service instances, Event payloads, Session and Conversation Snapshots, Tool state, and other DSH/Cordis objects are internal live data.

Do not:

- call `JSON.stringify` or `structuredClone` on these objects or their descendants;
- recursively enumerate, fully copy, or display them as a whole;
- place Host objects in the Package's long-lived state or Tool return values.

Read only the leaf fields required by the current feature. Extract the minimum strings, numbers, booleans, and other scalar values before constructing owned JSON.

## Versions, approval, and repair

- A Plugin is the stable instance identified by `pluginId`.
- A Package is an immutable code version identified by `packageId`.
- Every activation attempt has its own `pluginRunId`.
- `currentPackageId` is the latest successful version; it does not imply the Plugin is currently running.
- `nextPackageId` is the target awaiting approval, activating, or most recently failed.

Choose the `cordis_run` mode as follows:

| Current state | Target | mode |
| --- | --- | --- |
| No current | Any Package under the Plugin | `run` |
| Has current | The same Package | `run` |
| Has current | A different Package | `update` |
| Update failed | `nextPackageId` | `update` to retry |
| Update failed | `currentPackageId` | `run` to roll back |

After a technical failure:

1. Use `cordis_inspect_self(pluginId, packageId)` to read the failed version's source and exact diagnostics.
2. If the error involves an unknown capability, list and query the corresponding Provider again.
3. Define a new Package under the same Plugin; do not overwrite the failed Package.
4. Run again with the new `packageId` and the correct mode.

Do not retry automatically after the user rejects approval. A failed update does not automatically restore the old physical Run; explicitly run current when recovery is required.

## Modify @pluginId

When the user identifies a target with `@pluginId`, do not create another Plugin. The injected context contains only identity, version pointers, and the default base Package, not source code.

1. Read the base Package with `cordis_inspect_self(pluginId, packageId)`.
2. Preserve the parts that do not need to change and modify only the target code.
3. Call `cordis_define` with `plugin.kind: 'existing'` and the original `pluginId`.
4. Use the returned `packageId`; when current exists, activate the new version with `update` in the usual case.

If the reference is unavailable, explain that the Plugin was removed, belongs to another Session, or was lost on process restart. Do not create a same-named replacement.

## Common failure checks

| Failure | Check first |
| --- | --- |
| `service "x" is not declared` | Whether code uses `ctx.x` without declaring `inject: ['x']` on the Plugin object; switch to `ctx.get('x')` with an absence check or declare a true hard dependency |
| `cannot get property "timer" without inject` | Query the timer Service and declare `inject: ['timer']` |
| Parse failure | Whether the code uses TypeScript, `import`/`require`, or an unavailable global |
| Update failure | Preserve current/next semantics; repair next and update, or run current to roll back |
