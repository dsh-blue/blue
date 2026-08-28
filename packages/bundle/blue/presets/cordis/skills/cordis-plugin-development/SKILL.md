---
name: cordis-plugin-development
description: >-
  Create, modify, debug, or roll back dynamic Cordis plugins in a Blue session,
  including hot-mounted additive UI prototypes. Use for the inspect, define,
  run, iterate, and rollback lifecycle before packaging an accepted feature.
---

# Develop Dynamic Cordis Plugins (host half)

Dynamic plugins are temporary, process-local experiments: they live in the shared DSH process memory, are visible only to the session that defined them, and disappear on toolset unload or DSH restart. `cordis_stop` pauses a run while retaining its immutable definitions; `cordis_undefine` removes them. They create no plugin files, install no packages, and modify no `cordis.yml`. To keep an experiment, implement it as a composition row (editing-cordis-compositions) or a real Blue plugin (blue-plugin-development).

The vm sandbox isolates globals but is not a security boundary: host-realm helpers make escape possible, and granted services affect the live runtime. Treat this toolset like bash access.

## Standard workflow

0. **Discuss the requirement with the user first.** Do not define a package on a vague request — pin down what the user wants to see, then prototype.
1. Call `cordis_inspect_list` to obtain the Providers, methods, and schemas currently registered.
2. Select the smallest set of `cordis_inspect_query` calls needed to read the exact Services, Events, Builtins, or Tools that the implementation will use.
3. For a new Plugin, design its first Package. To modify an existing Plugin, first use `cordis_inspect_self(pluginId, packageId)` to read the base source and diagnostics.
4. Write plain JavaScript in `code.host` only, then call `cordis_define`.
5. Call `cordis_run` with the final `pluginId` and `packageId` returned by define.
6. Handle approval, waiting, and failures from the Run card, steering messages, or `cordis_inspect_self`.
7. Use `cordis_stop` to disable the Plugin temporarily. Use `cordis_undefine` only when it is no longer needed.
8. **When the user accepts the prototype, ask before persisting it.** Offer four explicit outcomes: keep a local plugin package, upload its repository to GitHub, publish it to npm, or leave it ephemeral. Do not create package files, repositories, commits, tags, or releases before the user chooses. After consent, load the blue-plugin-development skill and implement only the chosen path; identify login, 2FA, repository, organization, or token steps the user must perform. Warn that the ephemeral choice vanishes on restart.

Do not wait in the same turn for user approval or asynchronous results. After `cordis_run` returns `awaiting-approval` or `starting`, end the current Tool flow and wait for the system to report the final outcome through state updates and steering.

## Tool usage guidance

| Tool | Use it when | Do not |
| --- | --- | --- |
| `cordis_inspect_list` | Discover current Providers and method schemas in one call; refresh after the runtime capability directory changes | Hard-code Provider names and skip list; treat a manifest as business data |
| `cordis_inspect_query` | Confirm exact Service methods, Event modes, Builtins, or Tool schemas before writing code | Use it instead of calling a real Service from the Plugin |
| `cordis_inspect_self` | List current Plugins, inspect version pointers, or read exact Package source and runtime diagnostics | Fetch all source just to build a list; use it to modify or start a Plugin |
| `cordis_define` | Create a Plugin's first version or append an immutable Package to an existing Plugin; let the user preview the code first | Expect define to execute `apply`, request approval, or update current |
| `cordis_run` | Activate an exact Package; use `run` for first activation or the current Package, and `update` to switch to any different Package (including an older rollback target) | Use `run` to switch versions implicitly; treat pending or starting as success |
| `cordis_stop` | Pause current effects while preserving Packages, grants, and version pointers for later use | Use stop to mean permanent deletion |
| `cordis_undefine` | Permanently remove a Plugin and all of its Packages and clear historical business views | Call it while rollback, inspection, or restart is still needed |

`cordis_define` accepts one exact envelope. For a new Plugin it has this shape:

```json
{
  "plugin": { "kind": "new", "idPrefix": "probe" },
  "name": "Readable package name",
  "purpose": "One sentence describing the user-visible result.",
  "code": {
    "host": "return { name: 'probe', inject: ['bluePluginHost'], apply(ctx) { /* work */ } }"
  }
}
```

`plugin.idPrefix` must match `^[a-z]{3,6}$`: three through six lowercase English letters, with no digits, punctuation, or final numeric suffix. `code` has only `host` and `client`; `inject` belongs on the Plugin object returned by `code.host`, never beside `code.host` or in a `code.inject` property. The host string is evaluated as a function body, so `ctx` exists only as the parameter of `apply(ctx)` (or another callback that receives it). Top-level statements in `code.host` cannot refer to `ctx`.

## Provider navigation

Select methods from the actual `cordis_inspect_list` result. Common initial methods include:

- `Service.listService`: without `service`, returns every callable Service with its purpose and exact method signatures. Query the selected `service` again for access rules, structured method descriptions/parameters/returns, and only its referenced types.
- `Event.listEvents`: without `event`, returns every Event with its purpose, dispatch mode, and exact listener signature. Query the selected `event` again for its structured listener contract and only its referenced types; a Waterfall listener must call `next()`.
- `Builtin.listBuiltins`: returns evaluator-provided symbols and signatures that cannot be obtained through `ctx.get()`.
- `Tool.listTools`: returns Tool schemas actually visible to the current Agent, including dynamically registered Tools.

Provider names, methods, and inputs must come from the current list result. The Service/Event Catalog describes which interfaces this version permits; it does not guarantee that a Service is currently mounted. At runtime, use real Services and Events rather than caching or displaying Catalog query results.

In a Blue session the host service store also carries the capability-scoped `bluePluginHost`. Declare it as an injection and use that public facade for Blue contributions; do not probe or use raw renderer, theme, transcript, status, bottom-pane, tool, editor, command, session, loader, or shared HMR owner services from dynamic code. Never fall back to an owner registry when a public capability is absent: owner services are deliberately isolated from the creative realm, and a profile that exposes one is misconfigured rather than granting a compatibility route. The inspect catalog is an incomplete view of general host services, but Blue's owner boundary is explicit: absence of `bluePluginHost` means this runtime does not support a Blue UI prototype.

## Mount additive Blue UI from the host half

The host half can prototype additive Blue UI through the capability-scoped `bluePluginHost` facade. The user sees contributions appear in the running session with no reinstall and no restart. Register renderer-neutral `panes`, `status`, `commands`, or `notifications` contributions:

```js
return {
  name: 'my-probe',
  inject: ['bluePluginHost'],
  apply(ctx) {
    const opened = ctx.bluePluginHost.open(ctx, {
      id: 'com.example.my-probe',
      api: '^1.0.0',
      capabilities: ['panes', 'notifications'],
    })
    if (!opened.ok) throw new Error(opened.code + ': ' + opened.message)
    const registered = opened.value.panes.register({
      id: 'my-probe-pane',
      placement: 'bottom',
      size: { preferred: 1 },
      render: () => ({ kind: 'text', content: 'my probe pane', tone: 'muted' }),
    })
    if (!registered.ok) throw new Error(registered.code + ': ' + registered.message)
  },
}
```

- `panes`, `overlays`, `status`, `commands`, and `notifications` are additive capabilities. Duplicate contribution IDs, Blue owner namespaces, and existing slash-command names are rejected.
- `BlueUiNode` is renderer-neutral. The TUI adapter owns width, theme, layout, and error fallback; dynamic code must not import pi-tui or assemble ANSI rows.
- The host facade binds registrations to the dynamic plugin Fiber. Retain no raw Blue service or Agent/Session object in package state.
- Activity pane internals, transcript fold rules, existing command handlers, editor internals, themes, and root composition are owner-only. Add a new pane/status/command or notification instead.
- Check every `open()`, `register()`, and `publish()` result. These APIs report ordinary failures as `BlueResult`; they do not throw. Throwing only after checking is appropriate when the Package must fail activation instead of pretending that a contribution is live. A command may return the `BlueResult` from `publish()` directly.
- `BLUE_CAPABILITY_ABSENT` means the requested owner bridge is not active. At `open()` it means at least one requested capability cannot currently render or execute; from `register()` or `publish()` it means a bridge unloaded after the API was opened. Do not retry through internal registries. Report the missing capability, keep a plain/read-only fallback when the feature has one, or stop and ask the user to upgrade/restart the Blue profile.
- `BLUE_CAPABILITY_DENIED` means the capability is outside the phase-one public set, not that an internal service should be probed. Duplicate and invalid contribution failures are likewise structured diagnostics; surface their `code` and `message`.

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

Every contribution must be removed after the Plugin is stopped, updated, or removed. `bluePluginHost.open(ctx, manifest)` binds all of its registrations to the package Fiber. For other APIs, use the lifecycle-safe context verbs and returned disposers:

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
| `dynamic tool registration must use a tool returned by harness.defineTool(...)` | The Tool object was hand-assembled; build it with the `harness` Builtin's `defineTool` (query its exact signature with `Builtin.listBuiltins` first) and register that return value |
| `cannot get property "timer" without inject` | Query the timer Service and declare `inject: ['timer']` |
| `BLUE_CAPABILITY_ABSENT` | The matching Blue owner bridge is not mounted or unloaded; do not use private status/bottom-pane registries, command registries, or any other owner service as a fallback |
| `code.inject is not a declared property` | Move `inject` onto the Plugin object returned inside `code.host`; the `code` envelope accepts only `host` and `client` |
| `plugin.idPrefix must contain 3-6 lowercase English letters` | Use a semantic prefix matching `^[a-z]{3,6}$`; the Host appends the numeric suffix |
| `ctx is not defined` | Move the statement into the returned Plugin's `apply(ctx)`; `code.host` top level has no `ctx` variable |
| Parse failure | Whether the code uses TypeScript, `import`/`require`, or an unavailable global |
| Update failure | Preserve current/next semantics; repair next and update, or run current to roll back |
