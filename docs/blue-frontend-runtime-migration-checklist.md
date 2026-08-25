# Frontend Runtime 迁移实施清单

这是一份供 Codex goal-mode 逐阶段执行的实施清单。Goal agent 必须按顺序
推进，完成一个阶段后更新本文件和 `blue-runtime-cutover-ledger.md`，运行该阶段
门禁，并停止等待下一阶段条件；不得自行跳过人工验收、提前升版或创建 PR。

## 0. 执行约束

### 0.1 固定输入

- 起点：`origin/master@285bf799667469f24d1d2cd4b29a6b817d909f73`。
- 参考 runtime：`f79e17cfd2a94283447db4ae4624b3c903a064d7`。
- 参考实现细分：`ab3d73c68e5f873b904752b4c07bf767a827914b`。
- PR #58：`895ad362364e2b5f4104643e319cc38a23df96f1`。
- PR #59：`529ef3ee6c8f974e2e7e89cc7459c5aebff9e116`。
- PR #60：`f3645c2fd76cc280c7fa95470670363420c7f913`。
- PR #61：`e9ef7ca49fa922e5778f78aa1660143d5138fb20`。
- PR #62：`dac99a4cb24278bef10e3672b59530d5eb3d9d6c`。
- PR #63：`f2d8ab2514ace94c3a07a30d9d2d247ac2af1a33`。

不得 force-push、替换 master ancestry 或直接把旧 runtime branch 当成 master
的替代历史。参考 runtime 只提供模型、边界和行为证据。

### 0.2 发布边界硬约束

正式 release set 只有以下 10 个包：

```text
packages/api
packages/frontend
packages/harness-adapter
packages/conversation
packages/core
packages/app
packages/transcript
packages/interaction
packages/bundle/blue
packages/cli
```

以下 4 个包只用于第三方/外部架构验证，不得进入 release set、Blue bundle
dependency closure、`check:pack` tarball 或 rc.9 lockstep gate：

```text
packages/context
packages/remote
packages/openpencil
packages/lark
```

`website` 是私有 VitePress workspace，仅参与文档构建和版本文案检查，不发布
npm。最终正式版本在真人验收后才统一改为 `0.1.0-rc.9`；Harness 版本线仍为
`0.1.1-rc.2`，上一兼容 fixture 为 `0.1.1-rc.1`。

### 0.3 架构硬约束

- 只有 `packages/core` 可以 import pi-tui、ANSI、raw terminal、focus handle
  和 terminal width truth。
- Domain -> projection/action -> frontend model -> renderer consumer。
- model 只能包含 readonly 数据和结构化 action，不包含 Agent、Session、Promise、
  renderer object、ANSI、DOM、React、terminal width 或 module singleton 状态。
- Cordis service/event 是运行时 seam；package import 只用于公开类型、manifest、
  model 和纯函数。禁止 import `packages/*/src/*` 内部实现。
- 每个 registration、subscription、timer、child process、async continuation 都
  必须由当前 Cordis Fiber 拥有。
- provider swap 必须是 `capture -> abort -> dispose -> activate -> restore`；激活
  失败只能回退 plain provider，不能阻塞 Agent loop。
- capability 缺失是正常结果，使用 `BLUE_CAPABILITY_ABSENT` 或 plain fallback；
  不得让整棵 Cordis tree pending。
- UI 不折叠 Harness session events；事件是事实，projection 是状态，action 是写入。

## 1. C0：工作区、引用与审计基线

### C0-01 建立 worktree 和 refs

- [ ] 确认工作分支从远程 master 创建，命名 `p2/frontend-runtime-cutover`。
- [ ] 创建 archive refs 保存已验收 runtime 和六个冻结 PR head。
- [ ] 在开始修改前记录 `git status`、`git rev-parse`、`git write-tree`。
- [ ] 所有后续实现只发生在该 worktree；生产 `blue` profile 不得 link。

### C0-02 阅读和登记约束

- [ ] 阅读根 `AGENTS.md`、四个 skill 的 `SKILL.md`、目标包 `AGENTS.md`。
- [ ] 更新 `docs/blue-runtime-cutover-ledger.md`，登记 frozen refs、package set、
  owner、删除条件和当前 status。
- [ ] 为每个功能建立 parity 行：master/PR 输入、domain、projection/action、model、
  renderer、composition、fallback、fixture、删除条件。

### C0-03 校准 workspace/package contract

- [ ] `script/package-contract.mjs` 只收集 10 个正式 release package。
- [ ] 验证包通过独立 validator/fixture 入口运行，不被 `PACKAGE_DIRS` 收集。
- [ ] `tsconfig.json`、`tsdown.config.ts`、`clean-lib`、`check:lib`、`check:pack`、
  `release-packages`、release workflow 对 10 个包一致。
- [ ] exports、files、tsdown entry 三角完整；验证包可以 build/test，但不生成发布 tarball。
- [ ] 当前版本保持 rc.8 基线，禁止此阶段改 rc.9。

门禁：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、
`pnpm check:lib`。完成后提交 C0，停止等待审查。

## 2. C1：Frontend runtime foundation

### C1-01 `blue-api`

- [ ] 稳定导出 `BlueResult`、capability/error taxonomy、readonly `BlueView`、manifest
  validation、registration handle。
- [ ] `BluePluginHost` 只允许声明能力范围内的 command/status/dock/notification。
- [ ] owner namespace、duplicate id、invalid contribution、API major mismatch 都返回
  structured result。
- [ ] consumer Fiber unload 自动清理所有 registration/subscription。
- [ ] 添加 hostile plugin、duplicate、denied capability、unload fixture。

### C1-02 `blue-frontend`

- [ ] 定义 Text/RichText/Fields/List/Sections/Code/Diff、Panel、Status、Dock、
  Notification、Editor、Transcript、ToolPresentation、Theme model。
- [ ] 对所有 model 做 readonly/freeze；禁止 Promise、pi-tui、ANSI、Agent/Session。
- [ ] 实现 provider host：capture/abort/dispose/activate/restore、generation fence、
  plain fallback、late callback rejection。
- [ ] provider swap 并发测试覆盖最后请求获胜、旧 provider 不再发布 model。
- [ ] theme model 只保存 semantic token，不保存 ANSI formatter。

### C1-03 `blue-harness-adapter`

- [ ] 按 session/projection/action/model/question-approval 拆成独立 adapter。
- [ ] 所有版本差异和 capability probing 集中在 adapter；feature 不写版本号分支。
- [ ] adapter 不暴露 Agent/Session，不保留第二套 domain state，不 import package-internal。
- [ ] attach watermark、abort、session/request epoch、stale rejection、detach cleanup
  全部有 headless tests。
- [ ] 每个 adapter 源文件写上精确删除条件。

### C1-04 `blue-core` frontend renderer bridge

- [ ] `renderFrontendView`/`renderFrontendModel` 只消费 model，不读 Harness events。
- [ ] 所有输出经 core width seam；非法宽度由 frame clamp 兜底并记录 overflow。
- [ ] core 是唯一 pi-tui/raw terminal 依赖；新增 model package 不得引入 pi-tui。
- [ ] plain provider、empty/absent/error/loading panel 都有 renderer fixture。

门禁：frontend/headless unit + architecture boundary + provider lifecycle + width scan；
`pnpm test:coverage` 必须保持每个 executable source file 100%。完成后提交 C1，停止。

## 3. C2：rc.8 master parity 迁移

每个条目都必须完成六层证据：domain/adapter、projection/action、model、renderer
consumer、headless fixture、bundle/composition。未完成六层不得切默认 row。

### C2-01 CLI、bundle 和发布管线

- [ ] 保留 `blue-cli` 的 `-V`、`--profile`、plugin 参数翻译、pnpm preflight、profile
  calibration、nested dsh、shrinkwrap 和 failure classification。
- [ ] bundle 保留 cordis-host-runner、preset roster、thin-host disable list、session-title
  cadence、Blue rows 和明确 inject/dependency。
- [ ] release workflow 只发布 10 个包，验证包只运行 fixture。
- [ ] `check:pack` 验证所有正式包 exports、bin、shrinkwrap、dependency protocol、
  no-source/no-map、publint/ATTW 和尺寸预算。

### C2-02 Theme

- [ ] dark/light/auto/custom 迁移到 ThemeModel semantic tokens。
- [ ] 保留 ocean/paper 的用户可见语义；决定是作为正式主题 row 还是兼容 alias，并在
  ledger 记录删除条件。
- [ ] theme activation、duplicate、unload、auto background change、窄终端 golden 通过。

### C2-03 Clipboard、paste、editor

- [ ] native Wayland/X11 image paste、attachment admission、timeout/cooldown、late result
  cleanup 通过 structured `editor.set`/notification model 接入。
- [ ] 保留 OSC52 与 tmux `load-buffer -w -` 复制路径；“复制成功”只能在命令成功后发布。
- [ ] 保留 external editor suspend/resume、draft/history/completion、slot replacement、
  mouse selection、resize、PageUp/PageDown/End。
- [ ] editor public model 不包含 pi-tui editor object；core 才是 renderer consumer。

### C2-04 Update、changelog、trace

- [ ] `/update` 保留 eligibility、registry check、rollback、downgrade、preflight、安全失败。
- [ ] `/changelog` 使用 structured command/panel model；不直接构造 legacy dialog。
- [ ] `/trace` 将聚合和详情数据改为 session-scoped projection/query，panel 只消费 model。
- [ ] 更新、trace、changelog 的 abort、unload、late result、width 和 session switch 有测试。

### C2-05 Transcript、status、dock、tool

- [ ] status 全部发布 StatusModel，footer renderer 只消费 registry snapshot。
- [ ] activity/todo/agents/queue/btw 每个 pane 都有 DockModel producer 和 explicit placement。
- [ ] canonical tool call/result 转成 ToolPresentationModel，Read/Write/Shell/error/long
  output/fold/expand 保持 golden/e2e parity。
- [ ] conversation projection 只处理 append-origin facts；transcript official consumer
  不再读取 SessionEvent[]。
- [ ] banner、markdown、image、thinking、window/step retention、Ctrl-O、scroll/tail-follow
  与 rc.8 行为对比通过。

### C2-06 Session、model、preset、命令

- [ ] 保留 `/model`、`/provider`、`/effort`、`/preset`、`/plan`、`/compact`、`/permission`、
  `/sessions`、`/context`、`/export`、`/theme`。
- [ ] 每条命令使用 CommandModel + structured action；不得在 renderer 中直接调用 Harness。
- [ ] session switch 固定为 abort -> unsubscribe -> clear -> attach -> publish binding。
- [ ] modelRef、preset selection、resume/fork、clean exit/epitaph 行为不回归。

门禁：旧 master golden/e2e 对比、各 surface width scan、bundle composition drift、
真实 build/smoke。每个 surface 独立提交并更新 package `AGENTS.md`。

## 4. C3：PR #58-#63 迁移

### C3-58 Message retract

- [ ] 在 app/adapter 创建 `session.retract` structured action。
- [ ] action 负责 cancellation 和 durable retract fact；携带 session/request epoch。
- [ ] conversation projection 处理 replacement；ordinary compaction 不能删除 append-origin
  transcript。
- [ ] official transcript consumer 隐藏 source event，不能由 legacy fold 再生成一行。
- [ ] replay/live/restart/abort/stale/ordinary-compaction tests 完成。

### C3-59 Update cooldown

- [ ] 保留 cache、eligibility、installable 判定、cooldown 和版本比较。
- [ ] startup notice 转 NotificationModel，安装操作转 CommandModel/action。
- [ ] timer、child process、registry request、late result 全部 Fiber-owned。
- [ ] hit/miss/cooldown/refresh/uninstall/retry fixtures 完成。

### C3-60 Creative mode/plugin host

- [ ] 使用稳定 capability-scoped `bluePluginHost`；manifest/API major/owner namespace 校验。
- [ ] 动态插件只能贡献 BlueView、command、status、dock、notification。
- [ ] Cordis card 使用官方 tool presentation model；删除 legacy intent bridge 的新增依赖。
- [ ] hostile plugin、missing capability、duplicate owner、unload、late event、packed install
  fixture 完成。
- [ ] creative preset、bundle row、CLI prototype 行为全部保留。

### C3-61 Settings

- [ ] 建立 SettingsPanelModel：namespace、typed field、unset、revision、secret marker、
  restart marker。
- [ ] get/set/unset 使用 expected revision；冲突返回 structured rejection。
- [ ] theme/editor/paste/update 等原有 settings 行为迁移到 model/action。
- [ ] secret 不进入 model snapshot、notification、日志和 error message。
- [ ] theme swap、stale revision、cancel、unload、narrow width fixture 完成。

### C3-62 Rewind/session tree

- [ ] session-query adapter 返回 readonly SessionTreeModel，不由 UI 复制 event log。
- [ ] `session.rewind` action 保留 seed、parent、fork、branch、current marker 和 durable notice。
- [ ] stale branch、cancel、session switch、resume/replay、action failure tests 完成。
- [ ] tree renderer 使用通用 select/info model，不创建专用业务 renderer state。

### C3-63 Provider onboarding

- [ ] credentials/settings adapter 只暴露 capability-scoped `credentials.set` action。
- [ ] onboarding 使用 secret-aware FormPanelModel；输入值绝不进入日志/notification/snapshot。
- [ ] provider refresh、成功后 model/session refresh、取消、abort、duplicate submit、
  unload、failure recovery 全部有 fixture。
- [ ] `dsh-credentials` 缺失时返回 absent/plain fallback，不阻塞 Blue boot。

每个 C3 slice 完成后：更新 parity ledger、包级 AGENTS、README（如 public behavior 改变）、
fixture report，提交独立 commit，并停止等待审查。

## 5. C4：旧实现删除

只有在替代物和删除条件同时满足后执行物理删除：

- [ ] `transcript/fold.ts` 不再有任何运行时 consumer；删除 direct session-event subscription。
- [ ] 删除 legacy `BlueStatusEntry` compatibility provider。
- [ ] 删除 legacy tool intent presenters，保留 canonical/plain fallback 所需最小转换。
- [ ] 删除 command-specific dialog state，保留 generic PanelModel renderer。
- [ ] 删除 pane-owned event folds；所有 pane 从 DockModel/projection 获取状态。
- [ ] 删除 shared-editor module singleton，改为 frontend-tree scoped editor host。
- [ ] 删除 package-internal imports、隐式 row order 和无删除条件的兼容 bridge。
- [ ] `rg` 静态审计确认 Agent/Session 没有穿越 app/domain -> model -> renderer 边界。
- [ ] bundle e2e 确认 official provider 与 fallback 不重复呈现同一 surface。

删除完成后运行完整 source-plane tests、architecture validator、bundle e2e 和 width scan；
没有通过证据不得删除，也不得用“当前没有发现调用点”替代 fixture。

## 6. C5：外部验证插件

验证插件不进入发布，但必须独立证明架构可迁移：

### `context`

- [ ] 官方 projection snapshot/change、watermark、multi-key coalescing、resume、late event。
- [ ] `/context` panel/status model、refresh action、absent fallback、unload。

### `remote`

- [ ] v1/v2 capability probing、Unix/SSH transport、multi-session、seq resume、write lease。
- [ ] question/approval、timeout/cancel/outcome-unknown、reconnect、late cleanup。

### `openpencil`

- [ ] 只消费官方 tool result/presentation；移除 signed metadata；缺 presentation plain fallback。
- [ ] duplicate call、retention、unload、packed exports fixture。

### `lark`

- [ ] 只通过官方 command 和公开 settings route；不保存 secret/domain snapshot。
- [ ] notification dedupe、retry、route absent、abort、unload、packed exports fixture。

每个验证插件运行当前/上一 Harness line fixture，报告 `declared === executed`、空
`skipped`、空 `failures`、`fixtureCleaned === true`。验证包不能出现在 release index。

## 7. C6：完整验证与 profile dogfood

### 7.1 自动门禁

```sh
pnpm run test
pnpm run test:coverage
pnpm run typecheck
pnpm run lint
pnpm run diagrams:check
pnpm run build
pnpm run check:lib
pnpm run check:pack
pnpm run website:build
pnpm run smoke:happy
pnpm run smoke:pty
pnpm run smoke:pty:mouse
```

### 7.2 Packed fixtures

- [ ] 10 个正式包的 tarball closure 可安装，workspace/link/file spec 不泄漏。
- [ ] 4 个验证包分别执行独立 packed fixture，不从 source path import。
- [ ] 当前 `0.1.1-rc.2` 和上一 `0.1.1-rc.1` 的 Harness package closure 精确一致。
- [ ] 所有 declared scenario 都执行，未用 skip 隐藏兼容性失败。

### 7.3 专用 profile

```sh
PROFILE=blue-runtime-cutover script/install-dev.sh
dsh --profile blue-runtime-cutover
```

必须真人检查：

- 启动版本标识与生产/其他本机 profile 不混淆；
- prompt、stream、resume、fork、session switch、clean exit；
- `/model`、`/provider`、`/settings`、`/rewind`、`/context`、`/plan`、`/preset`；
- #58 retract、#59 cooldown、#60 creative mode、#63 onboarding；
- `/update`、`/changelog`、`/trace`；
- dark/light/auto/custom/ocean/paper 主题；
- native image paste、OSC52/tmux copy、external editor；
- todo/plan overlay 不遮挡 panel，status/dock/editor layout；
- CJK、长文本、20/40 列窄屏、resize、mouse、Ctrl-O、PageUp/PageDown、End；
- provider unload/swap、capability absent、fallback、late result；
- tmux copy mode 和真实 clipboard 行为。

Codex 必须等待用户明确回复“验收通过”。自动 smoke 不能替代该回复。

### 7.4 Cutover evidence (2026-08-25)

The final cutover worktree is `/home/x/dev/blue-runtime-cutover` on
`p2/frontend-runtime-cutover`. The merge residual in `theme-palette.ts` was
removed and the bundle manifest was corrected so validation-only `context`,
`remote`, `openpencil`, and `lark` packages are not in the release or bundle
dependency set.

Machine evidence recorded in the ledger:

- C0-C3 implementation and package contract: the ten release package set is
  enforced by `script/package-contract.mjs`; all 14 package validators return
  `valid: true`.
- C5 fixtures: `context` and `openpencil` on Harness `0.1.1-rc.2`, and
  `remote` and `lark` on `0.1.1-rc.1`, each report
  `declared === executed`, empty `skipped`/`failures`, and
  `fixtureCleaned: true`.
- C6 automatic gates: 170 test files / 2711 tests, per-file coverage 100% on
  statements/branches/functions/lines, typecheck, lint, build, lib exports,
  package contract, diagrams, website build, and happy/PTY/mouse width smoke
  all pass. `check:pack` produces exactly 10 tarballs.
- The dedicated profile links every package to this worktree and a headless
  pseudo-TTY boot exits 0 with bracketed paste enabled at boot and disabled at
  exit.

C4 remains intentionally pending. The official conversation/transcript path
is the default product consumer, but the search audit still finds legitimate
fallback/export/pane consumers of `fold.ts`, direct session facts, legacy
`BlueStatusEntry`, and intent registries. Those rows must not be marked deleted
until their documented replacement conditions are met and separately tested.

C6 is therefore awaiting live human acceptance. C7 is locked: do not change
the Blue version from `0.1.0-rc.8`, create a release PR, tag, merge, delete the
profile, or publish npm until the user explicitly replies `验收通过` after
running the full checklist against `dsh --profile blue-runtime-cutover`.

## 8. C7：版本、PR 和合并

只有 C6 人工验收通过后：

- [ ] 将 10 个正式 package manifest、website 文案和 `BLUE_VERSION` 统一升级到
  `0.1.0-rc.9`。
- [ ] Harness pins、peer ranges、minimumReleaseAgeExclude、`HARNESS_LINE` 保持
  `0.1.1-rc.2`，不得随 Blue 版本一起修改。
- [ ] 生成 rc.9 release notes，更新中英文 README/website/AGENTS 文档。
- [ ] 重新运行全部自动门禁、check:pack、双 Harness fixture 和 profile smoke。
- [ ] 检查 release index 只有 10 个正式包，确认 context/remote/openpencil/lark 不在其中。
- [ ] 创建一个从 `p2/frontend-runtime-cutover` 到远程 `master` 的原子 PR。
- [ ] PR 描述附上 parity matrix、deletion ledger、fixture JSON、全量 gate 和 dogfood log。
- [ ] 不在用户最终确认前 merge、tag、publish、删除 profile 或关闭冻结 PR。
- [ ] merge 到 master 后在主 checkout 重新 `pnpm run build`，清理专用 profile，保留归档证据。

## 9. Goal-mode 汇报格式

每个 goal round 结束时必须报告：

1. 阶段 ID 和目标；
2. 修改的包、文件和新增/删除的 service/event；
3. Domain/Projection/Action/Model/Renderer/Composition 边界证据；
4. 测试命令和完整结果；
5. fixture 的 declared/executed/skipped/failures；
6. 删除了哪些旧接口，删除条件是什么；
7. 尚未完成项、风险和下一阶段前置条件；
8. commit hash；
9. 尚未真人验收时，明确写“等待人工验收”，不得写“完成迁移”。

若发现 Harness API、包发布边界或行为基线与本清单冲突，停止实现，记录证据和
选项，先修订清单；不得自行扩大 scope。
