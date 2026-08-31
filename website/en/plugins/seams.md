# Seam reference

Blue's current seams are explicit Cordis services, projection/action boundaries, renderer-neutral model registries, and patch rows. The old mutable `blueSession` binding, `blue/session-changed`, `blueStatus`, `blueIntents`, and shared-editor module singleton have been removed.

## Third-party Beta entry

External plugins request capabilities from the current `1.0.0-beta.1` host through `ctx.bluePluginHost.open(ctx, manifest)`:

| Capability | Contribution | Blue consumer |
|---|---|---|
| `commands` | `BlueCommandContribution` plus async `BlueResult` | interaction bridge into the Harness command registry |
| `status` | `BlueStatusEntryContribution` returning a renderer-neutral `BlueStatusNode` | view bridge into the private footer registry and core status compiler |
| `notifications.publish` | publish-only `BlueNotification` | interaction bridge into the editor notice sink |
| `panes` | `BluePaneContribution` | core surface bridge into the bounded pane mount |
| `overlays` | `BlueOverlayRequest` | core surface bridge into the overlay mount |
| `session.read` | `BluePluginSessionReader`: result-bearing `current` / `subscribe` | app session owner bridge into exact-field frozen epoch/revision snapshots |
| `session.projections.read` | `BlueSessionProjectionReader`: `current` / `currentMany` / `subscribe` | app projection owner bridge into exact-key JSON cuts with epoch/seq fences |
| `status.provider` (Experimental) | inert `BlueStatusProvider` candidate | status-provider owner into the core status compiler |
| `editor.extensions` (Experimental) | inert `BlueEditorExtensionContribution` | interaction owner into editor extension binding |
| `editor.provider` (Experimental) | inert `BlueEditorProvider` candidate | editor-provider owner into the core editor-shell compiler |

`@dsh-blue/blue-api` owns manifest validation, capability scoping, duplicate ids, the owner namespace, and lifecycle. Registrations bind to the caller's Fiber and disappear on unload. `commands`, `status`, `panes`, and the three Experimental/reference facets use inert registration buffers. `overlays` has only a durable capability definition; every open still requires the live renderer owner. After an owner gap only the latest definitions are restored. Actions, overlays, gestures, notifications, and old callback results are never replayed.

Private `bluePluginControl.attachCapabilities()` returns a generation-bound owner lease. Capability overlap revokes every authority on the displaced lease, and that lease scopes snapshot/notification observation, gestures, and semantic close. `notifications.publish`, `session.read`, and `session.projections.read` require active owners, so operations return `BLUE_CAPABILITY_ABSENT` while an owner is missing; `null` means the owner is online with no current session. Notifications expose publish only, never global observation, with host-enforced 32 KiB and 20-per-rolling-second quotas. Both session facades are read-only; generic `session.act` has been removed, and domain writes continue through their owning Harness service, command, or feature action. See [Read-only session data](/en/plugins/session).

The provider/editor facets remain Experimental/reference runtime and are not part of the Stable v1 root. Their candidates stay inert until selected in settings. See [Status](/en/plugins/status#exclusive-status-provider) and [Editor providers](/en/plugins/editor-providers) for persisted selection and fallback behavior.

## Internal Blue boundaries

These are product-composition seams, not a route for third-party code to bypass `bluePluginHost`:

| Owner | Seam | Purpose |
|---|---|---|
| core | `blueScreen` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` / theme | TUI kernel; only core touches pi-tui/raw terminal |
| app | `blueSessionReader` | readonly current-session snapshot; the public host applies exact-field scope |
| app | `blueSessionProjections` | current-session epoch plus consistent-cut seq, children, and subscriptions; the public host applies exact-key/JSON/size scope |
| app | `blueSessionActions` | domain actions for followup/steer/interrupt, mode/model/preset/tool/skill, rewind, and side sessions |
| conversation | `blueConversation` / `blueConversationFacts` | official replay/live transcript and status/pane facts |
| transcript | transcript model, private status/bottom-pane registries, and tool model service | readonly models/canonical nodes into the TUI renderer |
| interaction | `blueEditorHost` / `blueInteractionState` | frontend-tree-scoped editor, completion, submit barrier, draft/settings/paste state |
| API composition | `bluePluginControl` | owner attach, aggregate/notification observation, gestures, and semantic close; private-realm only |
| bundle | `cordis.patch.yml` | 34 Blue-owned rows: 3 host-support, 1 private group, and 30 product rows |

The default bundle's `blue-runtime-private` group wraps the complete product segment and isolates `bluePluginControl`, `blueSessionReader`, `blueSessionProjections`, and `blueSessionActions` from ordinary siblings. Public `bluePluginHost` still crosses the isolation boundary to provide manifest-scoped facades. Ordinary plugins cannot obtain management authority through service injection or Cordis proxy unwrapping.

Session-switch events such as `blue/request-resume`, `-new`, `-fork`, and `-rewind` are commands addressed to the app owner, not broadcasts carrying Session objects into renderers.

## Design discipline

- frontend models contain no Promise, ANSI, terminal width, focus handle, Agent, Session, or renderer object;
- UI code never folds the Harness event log;
- registrations, listeners, timers, screen mounts, and async tasks have unload/abort paths;
- late results check session/provider generation;
- packages import only public exports;
- absent optional capabilities return structured absent/plain behavior without pending the tree.

The engineering-level map lives in [`docs/blue-seams.md`](https://github.com/dsh-blue/blue/blob/master/docs/blue-seams.md).
