# Blue Surface Migration Matrix

This is the current F5/cutover control document. `source-complete` means the old runtime path was physically removed and focused evidence exists; final release readiness still requires the current full gate, packed fixtures, isolated-profile smoke, and explicit human acceptance.

| Surface / owner | Official input | Model and consumer | Fallback / scope | Bundle composition | Current status |
|---|---|---|---|---|---|
| status / transcript + mode | `blueConversationFacts`, session reader/actions, title, cwd/git probes | canonical `BlueStatusNode` -> package-private `BlueStatusEntryService` -> two-band footer | absent values render no column; git probe and presentation policy are tree/Fiber scoped | baseline service/basic row; cwd/git/title/context/mode enhancements | source-complete; generic frontend status model deleted |
| bottom panes / transcript + interaction | `blueConversationFacts`, app queue/actions, opaque side-session projection | each pane publishes canonical `BlueUiNode` into bottom-only `BlueBottomPaneService`; five narrow renderer adapters preserve unexpressed semantics | local expanded/scroll/timer state only; no pane folds session events | activity/queue/todo/btw/agents rows with explicit inject pins | source-complete; generic dock model, placement lanes, pane-owned folds and child Session tracking deleted |
| command + panel / interaction | official commands and app structured actions | `CommandModel`, readonly canonical documents and structured actions -> shared canonical panel adapter; reusable list/form/info/settings/question/approval/plan-review controls remain | execution aborts on unload and rejects late completion; update progress is action state, not renderer state | interaction + public interaction bridge | source-complete; generic `PanelModel`, model/effort, trace/detail and update renderer classes deleted |
| tool presentation / transcript | official dsh-tools call/result views as domain input | `ToolPresentationModel.call/result: BlueUiNode` -> `BlueModelToolService` -> direct canonical compile inside the semantic transcript tool component | canonical rich-text node on absent or unknown presentation | transcript baseline; no intent rows | source-complete; frontend `View` adapter, `blueIntents`, and diff/terminal/cordis presenters deleted |
| theme / frontend + core | semantic theme config | `ThemeModelService`; core compiles terminal paint functions | activation failure selects dark/plain; provider state is Fiber scoped | theme-dark baseline; light/auto/custom/ocean/paper package entries | complete |
| editor / interaction | input-owner set/submit/abort and submit transformations | `EditorModelService` plus tree-scoped `EditorHostService` | plain editor remains the concrete TUI consumer; no module singleton | interaction baseline; editor-plus/paste-image enhancements | source-complete; shared editor singleton deleted |
| transcript / conversation + transcript | official `SessionProjectionRegistry` -> `blueConversation` | whole projection snapshot/feed -> semantic `TranscriptModelService`; newest 200 entries | readiness capability orders resumed replay; stale session/seq callbacks rejected | conversation + official-model are baseline rows | source-complete; legacy fold/direct subscription deleted |
| context validation adapter | app `blueSessionProjections.currentMany/subscribe` | renderer-neutral context feature model/action | epoch rejection, multi-key coalescing, capability absence | validation-only; not a bundle row | complete as independent adapter |
| public plugin contributions | stable manifest and `BlueView` | plugin host -> view/interaction owner bridges | capability denial and duplicate-id errors are structured; all registrations Fiber owned | API host baseline; two bridge rows | complete |

## Deletion Record

| Deleted or superseded path | Replacement | Status |
|---|---|---|
| transcript `fold.ts` and direct event subscription | `blueConversation` + official transcript consumer | complete |
| generic frontend status compatibility | canonical status-node producers and private footer service | complete |
| `blueIntents` and intent subpaths | official tool view/result -> canonical `ToolPresentationModel.call/result` nodes | complete |
| seven-kind frontend `View`, core `frontend-renderer`, and legacy helper aliases | canonical `BlueUiNode`, direct core compiler, `toolCallNode`/`toolResultNode` | complete |
| pane-owned activity/todo/agents/btw event folds | `blueConversationFacts`, app actions and canonical bottom-pane nodes | complete |
| shared editor module singleton | frontend-tree `EditorHostService` / `InteractionStateService` | complete |
| implicit bundle ordering | explicit inject dependencies plus bundle assertions | complete |
| package-internal cross-imports | public exports and narrow app/adapter contracts | complete |
| command-specific dialog render/state classes (`ModelPanel`/`EffortPanel`, `TracePanel`/`TraceDetailPanel`, `UpdatePanel`, thinking-segment chrome) | generic renderer-neutral panel models, structured actions and shared `FrontendPanel` | complete |

Raw `SessionEvent` use that remains inside app-owned domain/action helpers, persistence audit export, and trace-query formatting is not a renderer fold. Those owners may inspect durable facts as part of their official responsibility; no raw event or Session object crosses into frontend models.

## Reproducible Focused Evidence

```sh
pnpm exec vitest run packages/conversation/tests packages/transcript/tests packages/interaction/tests
pnpm exec vitest run packages/bundle/blue/tests/e2e.spec.ts packages/bundle/blue/tests/vt-snapshot.spec.ts
node script/blue-plugin-validate.mjs packages/transcript
node script/blue-plugin-validate.mjs packages/context
node script/blue-plugin-validate.mjs packages/app
node script/blue-plugin-validate.mjs packages/interaction
```

The final evidence record belongs in [blue-runtime-cutover-ledger.md](./blue-runtime-cutover-ledger.md). Validation-only package acceptance does not imply that the package is shipped in the Blue bundle.
