# Frontend Runtime Cutover Ledger

> Status: active migration record. The cutover is complete only when every
> behavior row and deletion row is `complete`, all evidence gates pass, and the
> dedicated profile receives explicit human acceptance.

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

The remote master and PR heads are frozen for this migration. PR #34 and #38
are out of scope; PR #36 is superseded by this cutover.

## Behavior Migration

| Surface | Domain / official input | Projection / action | Frontend model | Renderer / composition | Required evidence | Status |
|---|---|---|---|---|---|---|
| CLI and release pipeline | npm/package manifests | package contract and immutable tarball release | n/a | standalone CLI and workflows | CLI specs, `check:lib`, `check:pack`, packed install | in progress |
| ocean/paper themes | semantic palette config | Fiber-owned theme registration | `ThemeModel` | core palette compiler and bundle rows | lifecycle, width, live theme swap | pending |
| native image paste | platform clipboard capability | attachment save plus `editor.set` action | notification/editor models | interaction command and core input route | platform probes, abort/unload, PTY paste | pending |
| update/changelog | npm/profile capability | cancellable update actions | command/panel/notification models | generic frontend panel | cooldown, rollback, late result, packed CLI | pending |
| trace | official trace projection | session-scoped trace query/action | list/detail panel models | generic frontend panel | replay, switch, unload, width | pending |
| btw | session action capability | side-session action/model | dock model | dock renderer | resize, scroll, unload, width | pending |
| retract (#58) | cancellation plus durable surface replacement | `session.retract` | editor notification/action result | no transcript event fold | replay/restart, ordinary compaction, stale rejection | pending |
| update cooldown (#59) | install eligibility/cache | startup notification action | `NotificationModel` | notification consumer | time/cache matrix, unload | pending |
| creative mode (#60) | capability-scoped plugin host | effect-bound contribution registries | view/command/status/dock/notification models | standard consumers and preset composition | hostile plugin, unload, packed fixture | pending |
| settings (#61) | official settings service | revisioned get/set/unset | `SettingsPanelModel` | generic form/list renderer | stale revision, restart marker, secret elision | pending |
| rewind/tree (#62) | official session store/query | `session.rewind` and tree query | `SessionTreeModel` | generic select/info renderer | seed lineage, stale action, restart/replay | pending |
| onboarding (#63) | official credentials/settings capability | `credentials.set` | secret `FormPanelModel` | generic form renderer | redaction, abort/unload, provider refresh | pending |

## Legacy Deletion Gate

| Superseded surface | Replacement required before deletion | Status |
|---|---|---|
| transcript `fold.ts` and direct session-event subscription | official conversation projection covers live/replay/tool/thinking/image/interruption/retraction | pending |
| direct `BlueStatusEntry` compatibility | every status producer publishes `StatusModel` | pending |
| legacy tool intent presenters | official tool projection/presentation model covers every card | pending |
| command-specific dialog implementations | generic renderer-neutral panel models cover all commands | pending |
| activity/todo/agents/queue/btw pane-owned folds | official feature projections publish `DockModel` | pending |
| shared editor module singleton | frontend-tree-scoped editor host and structured actions | pending |
| implicit bundle ordering | explicit dependencies and composition assertions | pending |
| package-internal imports | public exports or narrow adapter contracts | pending |

Compatibility adapters may remain only for the current and previous Harness
lines. Each adapter must state the upstream capability that permits its removal;
none may expose or retain an Agent, Session, renderer object, or duplicate
business state.

## Final Evidence

- Full unit, per-file coverage, typecheck, lint, diagrams, build, library-export,
  package, website, and all real-process smoke gates.
- Validator passes for every runtime and migrated package.
- Packed fixtures execute every declared scenario without skips on Harness
  `0.1.1-rc.2` and `0.1.1-rc.1`.
- `blue-runtime-cutover` profile exercises every behavior row above.
- Explicit human acceptance precedes the rc.9 version change and atomic PR.
