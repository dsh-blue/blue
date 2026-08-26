# `@dsh-blue/blue-openpencil`

This optional Interaction adapter consumes only the official dsh-tools `tools/result` event and `tools.get(name, scope)` presentation callbacks. It recognizes the five public OpenPencil tool names, converts canonical call/result views through `createToolPresentationModel`, publishes errors through `blueNotifications`, deduplicates by call id, and retains at most 100 models.

The execution's Agent scope is used only for the synchronous official lookup and is never stored. `ToolExecutionResult.meta` is deliberately removed before `presentResult` because OpenPencil may place a signed editor capability there. No browser route, React/canvas state, file state, bearer value, or package-internal API crosses this package.

Every subscription, model registration, and notification disposer belongs to the adapter instance and is cleared on Fiber unload. Late events and duplicate call ids are ignored. Missing definitions or presentation callbacks fall back to canonical plain text/diff rendering; the OpenPencil domain package remains independently usable.

Deletion condition: replace this package when dsh-openpencil publishes a stable renderer-neutral Blue/frontend provider that owns the same bounded result projection and capability elision contract.

Packed acceptance: `script/blue-plugin-fixture.mjs packages/openpencil --install` executes seven shared runtime scenarios plus presentation/meta-elision and dedupe/retention/unload scenarios. Run the same 9/9 contract with `--harness-line <previous-version>` for compatibility; the 2026-08-23 baseline passed on Harness `0.1.1-rc.2` and `0.1.1-rc.1`.
