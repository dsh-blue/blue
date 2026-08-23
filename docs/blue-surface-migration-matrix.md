# Blue Surface Migration Matrix

This is the F5 control document for the frontend-runtime branch. A row is
complete only after the official consumer, independent fixture, unload/late
result checks, width scan, golden or e2e comparison, bundle composition, and
real-profile acceptance are all recorded. An additive model or registry alone
does not satisfy the row.

| Surface / owner | Official API or input facts | Model and consumer | Capability / fallback | Bundle row | Automated evidence | Exact deletion condition |
|---|---|---|---|---|---|---|
| status / transcript + interaction mode | `sessionTitle`, request context facts, `blueSession` binding, `planMode`, cwd/git probes | `StatusModel` -> `BlueStatusModelService` -> two-band footer; basic/cwd/git/title/context/mode all publish models | missing/empty facts render zero columns; normal entries truncate, context hides; git keeps an empty mounted entry for lazy TTL recovery | service in `blue-transcript`; provider rows `blue-status-basic/cwd/git/title/context/mode` | status model/provider specs; transcript width scan; bundle e2e + VT golden; unload/reattach/duplicate/hidden transition coverage | retire direct `BlueStatusEntry` provider compatibility after `blue-frontend-runtime` live footer parity; retain the footer renderer while TUI exists |
| dock / transcript | already-projected `DockModel` contributions; legacy panes still own their official domain subscriptions | `BlueDockModelService` -> screen content/bottom lanes; placement, priority, id, `preferredRows`, collapse | absent model is omitted; legacy activity/queue/todo/btw/agents panes remain the product fallback | service in `blue-transcript`; existing pane rows unchanged | dock lifecycle/order specs and adversarial width scan; bundle e2e retains editor/footer order | replace each legacy pane only after an official feature publishes its model and PTY mouse/PageUp/PageDown, focus, tail-follow, and End behavior pass |
| command + panel / interaction | official `commands.list/execute` and `commands/change`; optional `blueContextFeature` action surface | immutable `CommandModel`; `CommandModelService.execute`; `FrontendPanel` for select/form/info/loading/error | missing command service returns empty/absent; `/context` falls back to `InfoPanel`; legacy dialogs remain | service in `blue-interaction`; optional `blue-context` row disabled | command abort/late-result specs; panel action/cancel/loading/slot tests; interaction width scan; bundle e2e | remove a legacy dialog only after its official model producer, slot/focus/mouse fixture, and live acceptance exist; remove command-list fallback after every host provides the official service |
| tool presentation / transcript | official `dsh-tools` `ToolCallView`, `ToolResultView`, and canonical `ToolResult` | `createToolPresentationModel` -> `BlueModelToolService` -> `renderFrontendView`; generic/terminal/diff/search/read/web converters | absent presentation uses canonical raw result; errors use danger text; unknown calls use tool name | service in `blue-transcript`; legacy `blue-intent-diff/terminal` rows remain | canonical converter and lifecycle specs; transcript shared width scan; bundle VT/e2e legacy comparison | remove fold-owned card presenters only after an official projection publishes every live/replay tool model and Ctrl-O/long-output golden + PTY acceptance pass |
| theme / frontend + core | Blue semantic token configuration; no Harness session input | `ThemeModelService`; core compiles semantic colors into terminal paint functions | activation failure/absent provider selects built-in dark/plain model; legacy aliases stay | theme rows `blue-theme-dark/light/auto/custom` | frontend theme lifecycle/duplicate/unload tests; core dark/light/custom and width suites | remove compatibility aliases only after all model consumers use semantic tokens and dark/light/auto/custom live acceptance passes |
| editor / interaction | input owner's shared set/submit/clear-or-interrupt actions | `EditorModelService` publishes `set`/`submit`/`abort`; existing pi-tui editor remains the TUI consumer | absent editor returns no model/false action; existing plain editor is fallback | service in `blue-interaction`; `blue-editor-plus` stays optional | editor model + real input owner specs; paste/history/completion/slot suites; interaction width scan | remove shared-editor compatibility only after a replacement consumer passes paste/history/completion/resize/mouse/selection/scroll and PTY acceptance |
| transcript / transcript | already-projected readonly `View[]`; explicitly no Harness event input | immutable `createTranscriptModel`/append -> `TranscriptModelService`; newest 200 model entries rendered | null/absent source mounts nothing; old event fold + transcript renderer remains baseline and export fallback | service in `blue-transcript`; no duplicate model producer in default bundle | replay/live/immutability/window/unload/reattach specs; transcript width scan; bundle legacy e2e/VT golden | replace old fold consumer only after official projection covers replay/live/resume/thinking/image/markdown/tool/interruption and PTY tail-follow/notification/End/resize/copy parity |

## Current Evidence

The core model adapter is renderer-neutral and width-bounded. The context
vertical slice now consumes the official four-key projection cut and has an
independent tarball fixture, a real dsh-context 0.25.3 host fixture, a TUI
panel consumer, width scan, and bundle e2e. Its bundle row stays disabled and
it has not replaced `blue-status-context` pending live profile acceptance.
Remote v2 negotiation and lease transport now have a real authenticated
Unix-socket daemon fixture, including two sessions, authorization, response
carriers, contention, release, and late-event cleanup. This is deliberately
not recorded as SSH bootstrap or live-profile acceptance.

Status providers have crossed the model boundary and retain footer golden
parity. Command execution, generic panels, canonical tool conversion, editor
actions, dock ordering, and the bounded transcript viewport have official
consumers and lifecycle fixtures. The dock/tool/transcript/editor product
paths intentionally remain additive: no default bundle producer duplicates
the legacy pane, tool card, transcript, or editor content.

The acceptance profile for every row is `blue-frontend-runtime`. Automated
evidence does not mark the human column complete; that happens only after the
user runs `dsh --profile blue-frontend-runtime` and responds `验收通过`.

## Required Record Per Row

Focused F5 evidence is reproducible with:

```sh
pnpm exec vitest run packages/transcript/tests/status-model.spec.ts packages/transcript/tests/dock-model.spec.ts packages/transcript/tests/tool-model.spec.ts packages/transcript/tests/transcript-model.spec.ts packages/interaction/tests/command-model.spec.ts packages/interaction/tests/editor-model.spec.ts packages/interaction/tests/frontend-panel.spec.ts packages/transcript/tests/width-scan.spec.ts packages/interaction/tests/width-scan.spec.ts packages/bundle/blue/tests/e2e.spec.ts packages/bundle/blue/tests/vt-snapshot.spec.ts
pnpm run test:coverage
```

The independent packed fixture command is `node script/blue-plugin-fixture.mjs
packages/frontend --install`; F6 owns its multi-package closure and external
adapter expansion. Live acceptance, and therefore every legacy deletion, is
still pending.
