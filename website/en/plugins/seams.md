# Service seam reference

## Native dsh

Plugins directly inject dsh services such as `commands`,
`sessionProjections`, `tools`, `settings`, `skills`, and `sessionController`.
A plugin composed in the same realm as `planMode` can inject it directly; a
root UI plugin reads the native `plan` projection and executes the native
`/plan` command. Blue does not rewrite these methods or results.

## Blue UI

| Service | Write | Consumer |
| --- | --- | --- |
| `bluePanes` | `register(BluePaneContribution)` | core surface renderer |
| `blueStatus` | `register(BlueStatusSource)` | transcript footer |
| `blueOverlays` | `open(BlueOverlayRequest)` | core overlay renderer |
| `blueEditorExtensions` | `register(BlueEditorExtensionContribution)` | interaction editor |

`@dsh-blue/blue-api` provides the Context declaration merge and contracts;
`@dsh-blue/blue-ui` provides pure builders.

## Current Agent

`blueCurrentAgent.current()` returns `Agent | null`.
`subscribe(listener)` immediately replays the current selection and reports
revision changes. Pass the current Agent or `agent.session` to native dsh
services.

## Lifecycle

Every registration follows the consumer Fiber. There is no special admission
stage, grant, owner token, or cross-realm proxy. If the renderer temporarily
unloads, current registry definitions remain and are read again through
`list()/subscribe()` when rendering remounts.

Static UI plugins inject only the Blue service they need. A plugin depending on
`blueCurrentAgent` unloads with app/core dependency changes under ordinary
Cordis rules.
