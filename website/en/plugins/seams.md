# Seam reference

Blue's current seams are explicit Cordis services, projection/action boundaries, renderer-neutral model registries, and patch rows. The old mutable `blueSession` binding, `blue/session-changed`, `blueStatus`, `blueIntents`, and shared-editor module singleton have been removed.

## Stable third-party entry

External plugins request capabilities through `ctx.bluePluginHost.open(ctx, manifest)`:

| Capability | Contribution | Blue consumer |
|---|---|---|
| `commands` | `BlueCommandContribution` plus async `BlueResult` | interaction bridge into the Harness command registry |
| `status` | `BlueStatusEntryContribution` returning a renderer-neutral `BlueStatusNode` | view bridge into the private footer entry registry and core status compiler |
| `status.provider` | `BlueStatusProvider` returning an exclusive renderer-neutral `BlueStatusNode` | status-provider owner into the core status compiler |
| `notifications` | `BlueNotification` | interaction bridge into the editor notice consumer |
| `panes` | `BluePaneContribution` | view bridge into the private pane registry and core bounded pane mount |
| `overlays` | `BlueOverlayRequest` | public overlay host into the core overlay mount |
| `editor.extensions` | `BlueEditorExtensionContribution` | interaction bridge into editor extension binding |
| `editor.provider` | `BlueEditorProvider` returning an exclusive renderer-neutral editor shell | editor-provider owner into the core editor-shell compiler |
| `session.read` | `BlueSessionReader`: `current` / `subscribe` only | app session owner bridge into frozen revisioned snapshots |
| `session.act` | `BlueSessionRequester`: `request` only | app session owner bridge into FIFO structured actions |

`@dsh-blue/blue-api` owns manifest validation, capability restriction, duplicate ids, the owner namespace, and lifecycle. Registrations bind to the caller's Fiber and disappear on unload.

When the `session.read` / `session.act` owner is absent, `open()` returns `BLUE_CAPABILITY_ABSENT`. Once active, the two returned fields remain strictly isolated; see [Session reads and actions](/en/plugins/session) for lifecycle and result codes. Candidates for both exclusive-provider capabilities stay inert until their id is selected in settings. See [Status bar](/en/plugins/status#exclusive-status-provider) and [Editor providers](/en/plugins/editor-providers) for persisted selection and fallback behavior.

## Internal Blue boundaries

| Owner | Seam | Purpose |
|---|---|---|
| core | `blueScreen` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` / theme | TUI kernel; only core touches pi-tui/raw terminal |
| app | `blueSessionReader` / `blueSessionRequester` | readonly current-session snapshot / narrow actions; the public bridge does not expose broad app actions |
| app | `blueSessionProjections` | consistent-cut projection values, seq, children, and subscriptions |
| app | `blueSessionActions` | followup/steer/interrupt plus mode/model/preset/tool/skill/rewind/side-session actions |
| conversation | `blueConversation` / `blueConversationFacts` | official replay/live transcript and status/pane facts |
| transcript | transcript model, private status/bottom-pane registries, and tool model service | readonly models/canonical nodes into the TUI renderer |
| interaction | `blueEditorHost` / `blueInteractionState` | frontend-tree-scoped editor slot, completion multiplexer, pre-clear submit barrier, public extension/provider binding, draft/settings/paste state |
| bundle | `cordis.patch.yml` | 31 Blue-owned rows and explicit dependency ordering |

Session-switch events such as `blue/request-resume`, `-new`, `-fork`, and `-rewind` are commands addressed to the app owner, not broadcasts carrying Session objects into renderers.

## Design discipline

- frontend models contain no Promise, ANSI, terminal width, focus handle, Agent, Session, or renderer object;
- UI code never folds the Harness event log;
- registrations, listeners, timers, screen mounts, and async tasks have unload/abort paths;
- late results check session/provider generation;
- packages import only public exports;
- absent optional capabilities return structured absent/plain behavior without pending the tree.

The engineering-level map lives in [`docs/blue-seams.md`](https://github.com/dsh-blue/blue/blob/master/docs/blue-seams.md).
