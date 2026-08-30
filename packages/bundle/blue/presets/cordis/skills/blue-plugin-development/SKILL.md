---
name: blue-plugin-development
description: Create or persist a Blue frontend plugin after an in-session prototype is accepted, or add a Blue frontend entry to an existing Harness plugin package. Uses the published blue-plugin catalog, generator, validator, and packed conformance command without requiring a Blue checkout. Stops with a capability proposal when the machine catalog cannot express the requested feature. Not for ephemeral prototyping, Blue core changes, agent presets, marketplace submission, or publishing without explicit user authorization.
---

# Develop a Blue plugin

Use this skill only after the user asks for a durable Blue plugin or accepts an
ephemeral prototype and chooses a persistent outcome. Before acceptance, use
`cordis-plugin-development`; do not create package files, repositories,
commits, tags, releases, or profile installs.

The published `blue-plugin` command is the machine authority. A checked-out
Blue repository is neither required nor a source of copied capability names.

## 1. Read the installed contract

Run this first in the intended authoring environment:

```sh
blue-plugin catalog --json
```

Use only capability names, versions, resources, limits, and quotas present in
that output. Do not infer a capability from Website prose, examples, an old
flat manifest, internal services, or an experimental provider implementation.

Map every requested behavior to the returned catalog before writing files.
Classify capabilities as required only when the plugin is meaningless without
them; otherwise declare them optional and implement a plain/read-only absence
fallback. Never use `bluePluginControl`, raw session/projection/action
services, `blueScreen`, `blueComponents`, pi-tui, ANSI, terminal width, focus
handles, private registries, or package-internal imports.

If the request cannot be expressed by the catalog, stop without generating or
editing a package. Return a proposal containing:

- the user workflow and why current capabilities cannot express it;
- the smallest renderer-neutral capability or resource addition;
- readonly data and structured actions, with owner and scope;
- lifecycle, unavailable fallback, quota, abort/stale/unload, and width risks;
- one official consumer, one external consumer, and conformance evidence that
  would be required before Beta or Stable admission.

Do not approximate the missing capability with an owner-only service.

## 2. Confirm the persistent outcome

The user must choose exactly one current outcome: local package, GitHub
repository, npm package, or intentionally ephemeral. An accepted prototype
does not authorize GitHub/npm work. Local persistence does not authorize a
commit, repository, profile mutation, or publication.

For GitHub or npm, first complete and validate a local package. Then request or
confirm repository ownership, package name, visibility, authentication, 2FA,
organization policy, tag, and exact version before the corresponding external
mutation. Never publish merely because conformance passes.

## 3. Choose the package path

### New package

Create an empty destination with the published generator:

```sh
blue-plugin create ./my-blue-plugin --name @acme/my-blue-plugin
```

The generated no-build ESM status plugin is a valid baseline. Adapt its
canonical `blue.plugin.json`, public entry, and `cordis.patch.yml` to the
catalog decisions. Keep `package.json.blue.manifest` as the only discovery
pointer and keep `manifest.id` equal to the npm package name.

### Existing Harness plugin

Do not run `create` over an existing package. Preserve its domain entry,
exports, files, dependencies, scripts, and ownership. Add:

- one public renderer-neutral Blue entry subpath;
- one canonical `blue.plugin.json` and `package.json.blue.manifest` pointer;
- the manifest and entry to `files`;
- one additive loader row in the package's existing patch, or a package-owned
  patch when it does not yet ship one;
- exact public Blue dependencies and host-provided Cordis peers required by
  that entry.

The Blue entry injects the plugin's public renderer-neutral Harness Service or
projection. It must not read databases, files, Web routes, Agent/Session
objects, credentials, renderer state, or package internals to recreate domain
truth. If the Harness plugin has no suitable public seam, stop and propose that
seam before adding the Blue entry.

## 4. Implement the accepted feature

Every Cordis entry exports stable `name`, optional `inject`, and `apply(ctx)`.
Open the parsed canonical manifest through `ctx.bluePluginHost.open(ctx,
manifest)` and check every `BlueResult`. Register only through the granted
facade. Registrations are Fiber-bound and all subscriptions, timers, and
external listeners must unwind with that Fiber.

Return renderer-neutral nodes from `@dsh-blue/blue-ui`. Render functions are
synchronous, cheap, and free of I/O. Blue owns layout, theme, width, focus,
input routing, and terminal safety. Plugin-owned handlers validate event
revision/context, honor abort, reject stale results, and call only the domain
Service that owns the write.

Preserve a capability-absent fallback. Definition-style registrations may be
restored after an owner gap, but notifications, overlays, gestures, actions,
and old callback results are never queued or replayed.

## 5. Close the local package gate

Run the published checks from any directory:

```sh
blue-plugin validate ./my-blue-plugin
blue-plugin conformance ./my-blue-plugin
blue-plugin conformance ./my-blue-plugin --harness-line <previousHarnessLine-from-catalog>
```

Both conformance reports must have:

- `valid: true`;
- `peerResolution: "normal"` and the requested exact Harness line;
- `declared` equal to `executed`;
- empty `skipped` and `failures`;
- `fixtureCleaned: true`;
- public packed entry load, real Host admission, 20/40/80/120 width render,
  Fiber unload cleanup, and capability-absent fallback evidence.

The validator and fixture disable lifecycle scripts while packing untrusted
input, but they are compatibility checks, not a security sandbox.

## 6. Dogfood without replacing the live tree

Use a dedicated profile and delegate installation to its owner:

```sh
dsh plugin --profile blue-my-plugin add link:/absolute/path/to/my-blue-plugin
dsh --profile blue-my-plugin
```

Exercise supported widths, the primary workflow, unavailable fallback, unload,
restart, and any session replay/swap behavior. Rebuild the package between
looks; reinstall only when its dependency graph changes. Never use the
production `blue` profile for acceptance and never hot-replace the running
Cordis tree through `/plugin`.

Wait for explicit human acceptance before distribution. The deterministic P5
gate ends at an accepted local package plus current/previous Harness packed
conformance. GitHub and npm are separate, explicitly authorized outcomes.
