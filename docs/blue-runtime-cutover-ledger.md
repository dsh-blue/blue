# Frontend Runtime Cutover Ledger

> Status: the C4/C6 evidence below records the earlier frontend-runtime cutover checkpoint. On the current W4-W6 integration branch, W6-1 capability cleanup, W6-2 canonical-node source migration, and the W6-3 session read/act source plus packed-fixture checkpoint are complete. The W6-3 packed app fixture passes 9/9 scenarios on both the current Harness `0.1.1-rc.2` line and previous `0.1.1-rc.1` line. W6-4 release closure, refreshed full-tree/profile gates, and explicit live human acceptance remain pending. No merge, version change, tag, publish, or production-profile mutation is authorized before acceptance.

## Frozen Inputs

| Input | Frozen commit | Role |
|---|---|---|
| remote master | `285bf799667469f24d1d2cd4b29a6b817d909f73` | rc.8 behavior and release baseline |
| accepted runtime tree | `f79e17cfd2a94283447db4ae4624b3c903a064d7` | accepted renderer-neutral reference implementation |
| runtime implementation | `ab3d73c68e5f873b904752b4c07bf767a827914b` | implementation reference before merge records |
| PR #58 | `895ad362364e2b5f4104643e319cc38a23df96f1` | message retraction |
| PR #59 | `529ef3ee6c8f974e2e7e89cc7459c5aebff9e116` | update notice cooldown |
| PR #60 | `f3645c2fd76cc280c7fa95470670363420c7f913` | creative mode and plugin host |
| PR #61 | `e9ef7ca49fa922e5778f78aa1660143d5138fb20` | settings |
| PR #62 | `dac99a4cb24278bef10e3672b59530d5eb3d9d6c` | rewind and session tree |
| PR #63 | `f2d8ab2514ace94c3a07a30d9d2d247ac2af1a33` | provider onboarding |

PR #34 and #38 are out of scope; PR #36 is superseded. The earlier checkpoint was developed in `/home/x/dev/blue-runtime-cutover` on `p2/frontend-runtime-cutover`; the current W4-W6 integration continues in `/home/x/dev/deepseek-harness-plugin/blue/blue-ui-w4-w6` on `p2/ui-api-w4-w6` for PR #77.

## Behavior Migration

| Surface | Domain / official input | Projection / action | Frontend model / renderer | Status |
|---|---|---|---|---|
| CLI and release pipeline | package manifests/profile | immutable package contract | standalone CLI/workflows | machine evidence to rerun; human pending |
| ocean/paper themes | semantic palette config | Fiber-owned theme registration | `ThemeModel` + core compiler | source-complete; human pending |
| native image paste | clipboard capability | attachment save/editor action | editor/notification models | source-complete; human pending |
| update/changelog | npm/profile capability | cancellable update actions | panel/notification models | source-complete; human pending |
| trace | official session query | scoped query/copy action | list/detail panels | source-complete; human pending |
| btw | app side-session action | opaque projection session + owned handle | canonical bottom-pane node + accepted renderer adapter | source-complete; human pending |
| retract (#58) | request cancellation/durable replacement | app retract lifecycle | semantic transcript removal/notice | source-complete; human pending |
| update cooldown (#59) | install eligibility/cache | startup notification action | `NotificationModel` | source-complete; human pending |
| creative mode (#60) | capability-scoped plugin host | effect-bound registries | canonical pane/status/command/notification bridges | source-complete; human pending |
| settings (#61) | official settings | revisioned get/set/unset | settings/form panels | source-complete; human pending |
| rewind/tree (#62) | session store/query | rewind action/tree query | select/info panels | source-complete; human pending |
| onboarding (#63) | credentials/settings | secret write action | secret-aware form flow | source-complete; human pending |

## Legacy Deletion Gate

| Superseded surface | Replacement | Status |
|---|---|---|
| transcript `fold.ts` and direct session-event subscription | official `blueConversation` replay/live projection and semantic consumer | complete |
| generic frontend status compatibility | all status producers publish canonical status nodes | complete |
| legacy tool intent presenters | official tool presentation -> canonical `ToolPresentationModel.call/result` nodes | complete |
| seven-kind frontend `View`, core `frontend-renderer`, and old tool helper aliases | canonical `BlueUiNode`, direct compiler, `toolCallNode`/`toolResultNode` | complete |
| command-specific dialog implementations | generic renderer-neutral panel models, structured actions and shared `FrontendPanel` | complete; model/effort, trace/detail and update renderer classes deleted |
| activity/todo/agents/queue/btw pane-owned folds | `blueConversationFacts`/app actions -> canonical bottom-pane nodes | complete |
| shared editor module singleton | frontend-tree `EditorHostService` and `InteractionStateService` | complete |
| implicit bundle ordering | explicit inject dependencies and composition assertions | complete |
| package-internal imports | public exports and narrow adapter/app contracts | complete |

The deletion audit distinguishes renderer event folding from legitimate domain ownership. App helpers may inspect a private Agent/session log to perform rewind, retraction, title cadence, mode restoration or audit export; trace formatting may consume official query records. None of those values enter a frontend model as Agent, Session or raw renderer state.

`blue-conversation` now owns both `blueConversation` and `blueConversationFacts`. Transcript rendering, status producers and activity/todo/agents panes consume projection values through app-owned reader/projection seams. BTW uses an owned opaque side-session handle; queue uses app actions. The generic frontend status/dock contracts, seven-kind frontend `View`, core `frontend-renderer`, `blueIntents`, intent subpaths, child-event tracking, the shared editor singleton, `ModelPanel`/`EffortPanel`, `TracePanel`/`TraceDetailPanel`, `UpdatePanel`, and their retired thinking-segment renderer are physically absent. Provider/tool/transcript/context UI data uses canonical `BlueUiNode`; OpenPencil's Harness tool views remain domain input only.

## Package And Composition Record

- Release line stays `0.1.0-rc.8` until the acceptance gate authorizes the later release step.
- Validation-only packages remain outside the release/bundle closure; `packages/context/package.json` remains `0.1.0-rc.2`.
- The bundle contains 29 Blue-owned rows: 2 host-support, 8 baseline, 15 enhancement and 4 assembly rows.
- Conversation projection and official transcript consumption are baseline rows. Context, remote, OpenPencil and Lark are validation-only, not bundle rows.
- No operation may mutate the production `blue` profile.

## Earlier C6 Evidence

Current-tree machine evidence (2026-08-26):

- `pnpm run test`: exit 0; 162 files, 2419 passed, 36 skipped.
- `pnpm run test:coverage`: exit 0; 100% of 11757 statements, 7444
  branches, 2476 functions, and 9694 lines.
- `pnpm run typecheck`: exit 0. `pnpm run lint`: exit 0 with ten existing
  warnings and no errors.
- `pnpm run build`: the first clean forced build exposed context's missing
  `../app` project reference; after adding that dependency arm, the clean build
  exits 0. `pnpm run check:lib` verifies 67 built/shipped export claims.
- `pnpm run diagrams:check` and `pnpm run website:build`: exit 0.
- `pnpm run check:pack`: exit 0; exactly 10 tarballs, all publint-clean, with
  160 library files / 1163271 bytes and no workspace/link/file spec leak.
- All 14 `node script/blue-plugin-validate.mjs <package>` runs exit 0 with
  `valid: true` and zero package, architecture, or lifecycle violations. JSON
  reports are preserved under `.artifacts/validation/`.

Packed fixture matrix, each from an independent tarball install and public
package exports only:

| Target | Harness `0.1.1-rc.2` | Harness `0.1.1-rc.1` |
|---|---:|---:|
| context | 7/7 | 7/7 |
| remote | 7/7 | 7/7 |
| conversation | 11/11 | 11/11 |
| transcript | 11/11 | 11/11 |
| openpencil | 9/9 | 9/9 |
| lark | 9/9 | 9/9 |

Every fixture report has exact requested `harnessPackages`, empty `skipped`
and `failures`, `declared === executed`, `independentInstall: true`, and
`fixtureCleaned: true`. The fixture runner itself was updated from the retired
context/conversation service shapes to the public app projection seams before
this matrix was accepted; both failing pre-fix JSON reports remain preserved.

Process/profile evidence:

- `pnpm smoke:happy`: `HAPPY_SMOKE_PASS exit=0` at 40 columns with the real
  CLI and width-hostile mock stream.
- `pnpm smoke:pty`: `PTY_SMOKE_PASS exit=0`.
- `pnpm smoke:pty:mouse`: `PTY_MOUSE_SMOKE_PASS exit=0`.
- `PROFILE=blue-runtime-cutover script/install-dev.sh`: exit 0; all 11 linked
  Blue packages resolve into `/home/x/dev/blue-runtime-cutover`; production
  profile `blue` was not modified.
- The pseudo-TTY `/quit` smoke exits 0. Its preserved transcript
  `.artifacts/blue-runtime-cutover-headless-20260826-c4.typescript` contains
  one bracketed-paste enable and one disable, no width error, and a clean
  session-save exit; no `blue-overflow.log` exists in the profile.

This evidence completed the earlier C6 checkpoint; it does not substitute for
the current W4-W6 branch's pending release gates or unified acceptance profile.
The final gate remains the user's live test and exact acceptance response
`验收通过`; automated evidence cannot substitute for it.
