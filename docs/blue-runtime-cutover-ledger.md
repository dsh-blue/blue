# Frontend Runtime Cutover Ledger

> Status: PR #77 is the integration carrier for PR #72's design and PR #78's locale behavior. PR #79 merged the Plugin API v1 design/control baseline at `7f3d13a` and was merged into PR #77 at `124d220`. The current `blue-pr77-beta` worktree hardens that tree as a `1.0.0-beta.1` runtime foundation. Earlier W4-W6 and locale acceptance evidence remains historical baseline evidence only; it does not cover the new Beta authority boundary or its eventual exact head. Full automatic gates, dedicated-profile dogfood, fresh review and fresh live acceptance are required before merge. No protocol `1.0.0`, Stable API, publish, production-profile mutation, superseded-PR closure or acceptance-profile deletion is authorized by this state.

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
| PR #72 | `f60e21d726be40b3ecd6dfa545048e88c1efba20` | public UI API design, subsumed by PR #77 |
| PR #77 | `9a6a25549e54735de3e5f2a7604146269648d956` | accepted W1-W6 implementation and integration base |
| PR #77 locale candidate | `ee6e6380a8d2d995344d600073a69843bab8f33e` | current UI + i18n acceptance candidate |
| PR #78 | `d2f3d1c138692e365cf4439ae7a02cd8c74ff51f` | locale behavior reference against the pre-#77 topology |
| PR #79 | `7f3d13ab80932dc6bb778c359328c582d3767eae` | merged Draft v1 contract, Host lifecycle, PR #77 merge control and P1-P9 roadmap |
| PR #77 Beta base | `124d2204af9e4547aef276ac9301fc11ea45654f` | PR #79 merge commit present on `p2/ui-api-refactor`; Beta hardening exact head still pending |

PR #34 and #38 are out of scope; PR #36 is superseded. The earlier checkpoint was developed in `/home/x/dev/blue-runtime-cutover` on `p2/frontend-runtime-cutover`; W4-W6 continued in `/home/x/dev/deepseek-harness-plugin/blue/blue-ui-w4-w6` on `p2/ui-api-w4-w6`; locale integration was accepted from `/home/x/dev/deepseek-harness-plugin/blue/blue-ui-i18n-integration`. Beta hardening now lives only in `/home/x/dev/deepseek-harness-plugin/dsh/blue-pr77-beta` on PR #77's `p2/ui-api-refactor` branch.

## PR Integration Disposition

- PR #77 remains the single merge carrier. It already contains PR #72's design and implementation, so PR #72 contributes no separate commit to replay.
- PR #79 is already merged and its `7f3d13a` design/control baseline is an ancestor of the PR #77 Beta worktree. PR #77 implements only the merge handbook's minimum Beta safety gate; P1-P9 remain independent follow-up deliveries.
- PR #78's aggregate commit is not cherry-picked. Its locale service, Harness setting, first-wave translations and live-switch behavior are reimplemented on PR #77's renderer-neutral models, canonical panels and package ownership boundaries.
- The disposable `BlueSettingsList.updateItems()` seam described by PR #78 is not restored. `CanonicalSettingsController.updatePresentation()` reprojects labels in place while preserving controller, cursor and form state.
- PR #72 and PR #78 remain open until the locale-integrated PR #77 candidate passes live acceptance and is merged. Only then may they be closed as superseded.

## Behavior Migration

| Surface | Domain / official input | Projection / action | Frontend model / renderer | Status |
|---|---|---|---|---|
| CLI and release pipeline | package manifests/profile | immutable package contract | standalone CLI/workflows | candidate gates complete; human accepted; registry post-merge |
| ocean/paper themes | semantic palette config | Fiber-owned theme registration | `ThemeModel` + core compiler | source-complete; human accepted |
| native image paste | clipboard capability | attachment save/editor action | editor/notification models | source-complete; human accepted |
| update/changelog | npm/profile capability | cancellable update actions | panel/notification models | source-complete; human accepted |
| trace | official session query | scoped query/copy action | list/detail panels | source-complete; human accepted |
| btw | app side-session action | opaque projection session + owned handle | canonical bottom-pane node + accepted renderer adapter | source-complete; human accepted |
| retract (#58) | request cancellation/durable replacement | app retract lifecycle | semantic transcript removal/notice | source-complete; human accepted |
| update cooldown (#59) | install eligibility/cache | startup notification action | `NotificationModel` | source-complete; human accepted |
| creative mode (#60) | capability-scoped plugin host | effect-bound registries | canonical pane/status/command/notification bridges | source-complete; human accepted |
| settings (#61) | official settings | revisioned get/set/unset | settings/form panels | source-complete; human accepted |
| rewind/tree (#62) | session store/query | rewind action/tree query | select/info panels | source-complete; human accepted |
| onboarding (#63) | credentials/settings | secret write action | secret-aware form flow | source-complete; human accepted |
| public UI API (#72/#77/#79) | Beta manifest + safe UI vocabulary | manifest-scoped facade; private control/raw app services | canonical compiler, managed surfaces and panels | Beta hardening source in progress; exact-head gates and fresh acceptance pending |
| locale (#78) | process locale + official `locale.preference` | tree-scoped revisioned locale snapshot | interaction/transcript reproject in place | accepted baseline retained; Beta exact-head regression pending |

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

- The locale-integrated branch's eleven release packages and website are closed at `0.1.1-rc.2`; the independent Harness line remains `0.1.1-rc.2`.
- Validation-only packages remain outside the release/bundle closure; `packages/context/package.json` remains `0.1.0-rc.2`.
- The bundle contains 33 Blue-owned rows: 2 host-support, 1 private-runtime composition group, 9 baseline, 15 enhancement and 6 assembly rows. The group wraps all 30 product rows and isolates `bluePluginControl`, `blueSessionReader`, `blueSessionProjections` and `blueSessionActions`; public `bluePluginHost` remains available across the boundary.
- Locale runtime/settings adaptation, conversation projection and official transcript consumption are baseline rows. Context, remote, OpenPencil and Lark are validation-only, not bundle rows.
- No operation may mutate the production `blue` profile.

## PR #79 Beta Hardening Record

The current PR #77 worktree applies the merge handbook's minimum safety gate:

- API/host version is `1.0.0-beta.1`; examples, package docs, Website copy,
  release notes and Creative Mode skills use the same executable range without
  claiming protocol v1 Stable.
- Generic public `session.act`, its requester types and app owner bridge are
  removed. Public session access is readonly `session.read`; domain writes
  remain with their owning Harness service or feature action.
- Notification consumers receive publish-only `notifications.publish`.
  Aggregate and global-notification observation are owner-only operations.
- The package root exports no callable owner helper. A closure-bound
  `bluePluginControl` owns attach/snapshot/observe/gesture/close operations and
  is composition-isolated with raw app reader/projection/action services.
- Status/editor providers and editor extensions retain their runtime and
  reference fixtures as Experimental surfaces; they are not part of the
  Stable v1 root.
- Whole-tree hostile-sibling and readonly-session evidence is part of the
  candidate suite. Final exact-head validation, dual-Harness packed fixtures,
  smoke, dedicated `blue-pr77-beta` profile evidence, review and human
  acceptance remain mandatory and are not inferred from the records below.

## Pre-Hardening UI + i18n Integration Evidence

Automatic candidate evidence:

- `pnpm run test`: 189 files, 2999 passed, 31 skipped.
- `pnpm run test:coverage`: per-file 100% of 17046 statements, 11328
  branches, 3577 functions and 13621 lines.
- `pnpm run typecheck`, `pnpm run build`, `pnpm run diagrams:check` and
  `pnpm run website:build` exit 0. `pnpm run lint` exits 0 with seven warnings
  and no errors.
- `pnpm run check:lib` verifies 87 built/shipped claims. `pnpm run check:pack`
  verifies 11 publint-clean rc.2 tarballs, 179 library files / 1548012 bytes,
  and an external UI kit packed install/runtime/type check.
- `pnpm run check:examples` validates all eight example packages and executes
  the eight-scenario ecosystem fixture on Harness `0.1.1-rc.2` and
  `0.1.1-rc.1`, with exact packed host peer resolution.
- All 15 package validators return `valid: true` with zero package,
  architecture or lifecycle violations.
- `pnpm run smoke:happy`, `pnpm run smoke:pty`,
  `pnpm run smoke:pty:mouse` and `pnpm run smoke:pty:output` pass serially
  with exit 0.

Packed fixture matrix, each from an independent tarball install using only
public package exports:

| Target | Harness `0.1.1-rc.2` | Harness `0.1.1-rc.1` |
|---|---:|---:|
| harness-adapter, including locale live reload/unload | 8/8 | 8/8 |
| conversation | 11/11 | 11/11 |
| core | 7/7 | 7/7 |
| transcript | 13/13 | 13/13 |
| interaction | 11/11 | 11/11 |
| app | 9/9 | 9/9 |
| context | 7/7 | 7/7 |
| remote | 7/7 | 7/7 |
| OpenPencil | 9/9 | 9/9 |
| Lark | 9/9 | 9/9 |

Every report has exact requested `harnessPackages`, matching
`declared`/`executed`, empty `skipped`/`failures`, `independentInstall: true`
and `fixtureCleaned: true`.

Dedicated locale-profile evidence:

- `PROFILE=blue-ui-i18n-integration script/install-dev.sh` rebuilt the candidate
  and link-installed the complete release closure into the isolated profile;
  production profile `blue` was not modified.
- A real pseudo-TTY boot against candidate `ee6e638` opened `/settings`, kept the
  locale row selected while cycling `zh -> en -> system`, and resolved the
  `system` state to English under `C.UTF-8`.
- With the English `/hel` draft and completion menu still open, a real
  settings-file watcher update restored `locale.preference: zh`. The mounted
  editor retained `/hel`, the same completion changed to Chinese, Tab still
  completed `/help`, and the resulting help panel and already-mounted banner
  rendered their Chinese chrome.
- `/quit` exited 0. The 52,684-byte raw transcript at
  `/tmp/blue-ui-i18n-integration-ee6e638.typescript` contains one
  bracketed-paste enable and one disable, no terminal-width error, no uncaught exception
  and no crash marker. The existing `blue-overflow.log` was not modified by the
  run, and no new crash log was produced.
- The settings document ends at its original persisted value,
  `locale: { preference: zh }`.

At this checkpoint the remaining gate was fresh human live acceptance of that
exact profile and candidate; the earlier acceptance of `cf8b3bd` could not
satisfy it. Regardless of its later disposition, this checkpoint predates and
cannot satisfy the PR #79 Beta-hardening acceptance gate.

## Pre-integration W4-W6 Candidate Evidence

Final candidate tree:

- The final candidate tree passes 185 test files / 2965 tests with
  31 skipped, per-file 100% coverage (16773 statements, 11206 branches, 3495
  functions, 13403 lines), build, typecheck, lint, diagrams, website, 86
  built/shipped lib claims, 11 publint-clean tarballs, 8/8 example scenarios on
  both Harness lines, all package/example/validation-only validators, and the
  required current/previous-line packed fixtures.
- `smoke:happy`, `smoke:pty`, `smoke:pty:mouse`, and `smoke:pty:output` pass
  serially on that tree. Parallel smoke execution is unsupported because each
  smoke owns the checkout's dependency self-heal/build step; only the clean
  serial results are release evidence.

W4/G4 and W5/G5 direct evidence:

- The shared `ADVERSARIAL x SCAN_WIDTHS` sweep (120 through 2 columns) covers
  canonical single/multi select, form, settings, document select/loading,
  Questionnaire, PlanReview, Help, Info, and the prompt mounted by an actual
  approval plugin request. Transcript drives an accepted adapter through the
  real `BlueBottomPaneService` mount, clamp, and gutter path. The focused pair
  currently passes 210/210.
- The editor-provider swap test observes the provider's
  `BlueEditorSnapshot` and directly retains draft, history, cursor, plan mode,
  attachment snapshot, outer/editor focus, completion identity, and renderer
  exact renderer IME marker bytes passing through candidate replacement.
  Existing suites retain the fallback/breaker, provider unload, stale result,
  and input fencing evidence. Real pi-tui IME composition is not inferred from
  the fake editor; the final live acceptance gate that owns this path passed.

Dedicated-profile evidence:

- `blue-ui-api-w4-w6` is the isolated acceptance profile; production `blue`
  was not modified. Automated PTY dogfood covers the default single-column
  frame, 120/80/40-column plugin layout and narrow fallback, status/editor
  provider swap, theme swap, session switch, overlay, draft input, `/new`,
  `/quit`, bracketed-paste restoration, clean exit, and absence of
  overflow/crash logs.
- The user live-tested both `blue-ui-api-w4-w6` (ecosystem showcase) and
  `blue-ui-api-default` (default distribution), then explicitly replied
  `验收通过` on 2026-08-29. At the user's request, both profiles remain installed
  until the later merge cleanup.
- Registry install smoke is deliberately not reported as complete. No accepted
  candidate is published yet; after merge and the release tag, the workflow
  publishes the candidate artifact, installs that exact
  registry version, and gates rc/latest dist-tag promotion.

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

This evidence completed the earlier C6 checkpoint and was later accompanied by
that checkpoint's own live acceptance. It does not substitute for the current
PR #79 Beta-hardening exact head, dedicated profile, review or user response;
automated evidence alone cannot satisfy those gates.
