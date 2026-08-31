---
name: blue-plugin-development
description: Create, extend, or migrate a durable external Blue frontend plugin after the user chooses persistence. Uses the installed blue-plugin catalog, generator, validator, and packed conformance runner without requiring a Blue checkout. Not for ephemeral prototypes, Blue repository maintenance, agent presets, marketplace submission, or publishing without explicit authorization.
---

# Develop a Blue plugin

Use this skill only after the user asks for a durable Blue plugin or accepts an
ephemeral prototype and chooses a persistent outcome. Before acceptance, use
`cordis-plugin-development`; do not create package files, repositories,
commits, tags, releases, or profile installs.

The published `blue-plugin` command is the machine authority. A checked-out
Blue repository is neither required nor a source of copied capability names.
The Blue profile exposes its installed command through the trusted
`DSH_BLUE_PLUGIN_NODE` and `DSH_BLUE_PLUGIN_BIN` shell facts. If either fact is
absent, stop and report that the active profile does not provide the P5 author
command; do not fall back to an ambient or downloaded executable. In a POSIX
shell invoke the command as shown below. In PowerShell use
`& $env:DSH_BLUE_PLUGIN_NODE $env:DSH_BLUE_PLUGIN_BIN <arguments>`.

## 1. Read the installed contract

Run this first in the intended authoring environment:

```sh
"$DSH_BLUE_PLUGIN_NODE" "$DSH_BLUE_PLUGIN_BIN" catalog --json
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

## 3. Audit before migrating an existing plugin

Run the validator before editing an existing package. A failing report is an
inventory, not permission to rewrite unrelated domain code:

```sh
"$DSH_BLUE_PLUGIN_NODE" "$DSH_BLUE_PLUGIN_BIN" validate ./existing-plugin
```

Classify the current implementation into domain truth, projection/action
boundary, interaction, renderer, and composition. Record direct pi-tui, ANSI,
DOM, Agent/Session, package-internal, event-folding, module-singleton, implicit
bundle-order, and unowned-listener dependencies. Identify the public
renderer-neutral Service or projection that can remain authoritative.

Migrate additively. Preserve domain behavior and the old renderer as a named
acceptance baseline while introducing the public Blue entry, canonical
manifest, capability-absent fallback, and Fiber-owned registrations. Do not
translate a private renderer or raw session object into a nominally public
model. If no lawful public domain seam or catalog capability exists, stop and
propose the smallest missing seam or capability before editing the frontend.

Delete the old renderer, compatibility adapter, or legacy bundle row only
after packed conformance, unload/restart checks, and explicit live acceptance
prove the replacement. Record any temporary adapter's owner and deletion
condition in the plugin repository.

## 4. Choose the package path

### New package

Create an empty destination with the published generator:

```sh
"$DSH_BLUE_PLUGIN_NODE" "$DSH_BLUE_PLUGIN_BIN" create ./my-blue-plugin --name @acme/my-blue-plugin
```

The generated no-build ESM status plugin is a valid baseline. Adapt its
canonical `blue.plugin.json`, public entry, and `cordis.patch.yml` to the
catalog decisions. Keep `package.json.blue.manifest` as the only discovery
pointer and keep `manifest.id` equal to the npm package name.

### Existing or legacy Harness plugin

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

## 5. Implement the accepted feature

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

## 6. Close the local package gate

Run the published checks from any directory:

```sh
"$DSH_BLUE_PLUGIN_NODE" "$DSH_BLUE_PLUGIN_BIN" validate ./my-blue-plugin
"$DSH_BLUE_PLUGIN_NODE" "$DSH_BLUE_PLUGIN_BIN" conformance ./my-blue-plugin
```

The conformance report must have:

- `valid: true`;
- `peerResolution: "normal"` and the requested exact Harness line;
- `declared` equal to `executed`;
- empty `skipped` and `failures`;
- `fixtureCleaned: true`;
- public packed entry load, real Host admission, 20/40/80/120 width render,
  Fiber unload cleanup, and capability-absent fallback evidence.

The validator and fixture disable lifecycle scripts while packing untrusted
input, but they are compatibility checks, not a security sandbox.

## 7. Dogfood without replacing the live tree

Use a dedicated profile and delegate installation to its owner:

```sh
dsh plugin --profile blue-my-plugin add file:/absolute/path/to/my-blue-plugin
dsh --profile blue-my-plugin
```

Exercise supported widths, the primary workflow, unavailable fallback, unload,
restart, and any session replay/swap behavior. Rebuild and reinstall the local
file snapshot between looks. Never use the
production `blue` profile for acceptance and never hot-replace the running
Cordis tree through `/plugin`.

Wait for explicit human acceptance before distribution. The deterministic P5
gate ends at an accepted local package plus packed conformance on every exact
line in the catalog's `supportedHarnessLines`. GitHub and npm are separate,
explicitly authorized outcomes.
