# `@dsh-blue/blue-context`

Implementation detail for this package. Repo-wide conventions live in the root [AGENTS.md](../../AGENTS.md).

`OfficialContextSource` is the narrow adapter over app-owned `blueSessionProjections.currentMany()` and `subscribe()`. It reads `contextTimeline`, `contextPressure`, `contextBreakdown`, and `tokenUsage` from one consistent current-session cut, then maps them into the renderer-neutral context feature. `ContextModel.panel` carries `{ title, node, refresh? }`, while `ContextModel.status` is a provider snapshot whose `nodes` are canonical public `BlueUiNode` values. The package no longer declares `ContextView` or depends on frontend's removed `View`/`PanelModel` vocabulary. No Agent, Session, renderer object, or Promise enters the model.

The package imports only blue-app's public projection/reader types. Keep the `@dsh-blue/blue-app` peer/dev dependency and the `../app` TypeScript project reference together; without the reference, a clean `tsc -b --force` can resolve only stale emitted declarations.

This validation-only package keeps its own `0.1.0-rc.2` version outside the
product release set. Its Blue peers use the explicit preview window
`>=0.1.1-rc.1 <0.1.2`; a prerelease caret rooted on `0.1.0` does not admit the
`0.1.1` product line and breaks independent packed installs.

The projection registry notifies once per changed key during a committed event. The adapter coalesces relevant notifications through one microtask before calling `currentMany()`, buffers the newest cut across attach, rejects stale epochs after session switches, drops late callbacks after disposal, and lets malformed keys degrade independently. `blueSessionReader` supplies only the active session id and attach lifecycle.

The package is independently validated and is not mounted by the Blue bundle in this cutover. The in-bundle `/context` and footer use the app-owned session detail/facts services. Add a bundle row only when the context feature model becomes their sole consumer and the bundle fixture covers swap, unload, replay, and width behavior.
