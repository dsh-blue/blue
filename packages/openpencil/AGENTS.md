# `@dsh-blue/blue-openpencil`

This optional Interaction adapter consumes only the official dsh-tools `tools/result` event and `tools.get(name, scope)` presentation callbacks. It recognizes the five public OpenPencil tool names, treats Harness `ToolCallView`/`ToolResultView` values strictly as domain inputs, and converts them through `createToolPresentationModel` into canonical `BlueUiNode` call/result values. The Blue-facing output never exposes those Harness view types. The adapter publishes errors through `blueNotifications`, deduplicates by call id, and retains at most 100 models.

This validation-only package keeps its own `0.1.0-rc.2` version outside the
product release set. Its Blue peers use the explicit preview window
`>=0.1.2-alpha.1 <0.1.2`; a prerelease caret rooted on `0.1.0` does not admit the
`0.1.2` alpha product line and breaks independent packed installs.

The execution's Agent scope is used only for the synchronous official lookup and is never stored. `ToolExecutionResult.meta` is deliberately removed before `presentResult` because OpenPencil may place a signed editor capability there. No browser route, React/canvas state, file state, bearer value, or package-internal API crosses this package.

Every subscription, model registration, and notification disposer belongs to the adapter instance and is cleared on Fiber unload. Late events and duplicate call ids are ignored. Missing definitions or presentation callbacks fall back to canonical plain text/diff nodes; the OpenPencil domain package remains independently usable.

Deletion condition: replace this package when dsh-openpencil publishes a stable renderer-neutral Blue/frontend provider that owns the same bounded result projection and capability elision contract.

Packed acceptance: `script/blue-plugin-fixture.mjs packages/openpencil --install` executes seven shared runtime scenarios plus presentation/meta-elision and dedupe/retention/unload scenarios. The release gate runs the 9/9 contract on exact Harness `0.1.2-alpha.2`; older RC results are historical evidence, not current compatibility.
