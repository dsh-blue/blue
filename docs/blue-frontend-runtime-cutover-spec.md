# Frontend Runtime 完整迁移规格

状态：迁移前规格与审计基线。本文先于功能实现冻结边界；它不把当前
`p2/frontend-runtime` 的参考代码描述成已经完成的主线迁移。

## 1. 迁移目标

从远程 `master@285bf799667469f24d1d2cd4b29a6b817d909f73` 出发，在保留
Git ancestry 的前提下，把 Blue 主线迁移到 renderer-neutral frontend runtime。
最终结果必须同时满足：

1. rc.8 主线已有行为继续可用；
2. PR #58、#59、#60、#61、#62、#63 的功能全部在新架构下重做；
3. 新增能力只有 Domain -> Projection/Action -> Frontend Model -> Renderer
   Consumer 的路径；
4. 旧的事件折叠、业务状态副本、内部 shortcut 和兼容接口在无消费者后删除；
5. Blue 的正式发布集合与外部架构验证插件严格分离；
6. 当前 Harness 线和上一兼容线均通过独立打包夹具；
7. 专用 profile 由用户真人验收后，才升版 `0.1.0-rc.9` 并创建一个原子 PR。

本迁移不是把已验收 runtime 分支直接替换远程 master，也不是把 master 的旧
UI 提交逐个 cherry-pick。远程 master 是功能基线，已验收 runtime 是边界和
行为参考；每个功能按本规格重新接线。

## 2. 冻结输入

| 输入 | 固定引用 | 用途 |
|---|---|---|
| 远程主线 | `origin/master@285bf799667469f24d1d2cd4b29a6b817d909f73` | rc.8 功能、发布和文档基线 |
| 已验收 runtime | `f79e17cfd2a94283447db4ae4624b3c903a064d7` | renderer-neutral 参考 tree |
| runtime 实现 | `ab3d73c68e5f873b904752b4c07bf767a827914b` | 参考实现的细分提交 |
| #58 retract | `895ad362364e2b5f4104643e319cc38a23df96f1` | 消息撤回 |
| #59 cooldown | `529ef3ee6c8f974e2e7e89cc7459c5aebff9e116` | update notice 冷却 |
| #60 creative | `f3645c2fd76cc280c7fa95470670363420c7f913` | creative mode/plugin host |
| #61 settings | `e9ef7ca49fa922e5778f78aa1660143d5138fb20` | settings 面板 |
| #62 rewind | `dac99a4cb24278bef10e3672b59530d5eb3d9d6c` | rewind/session tree |
| #63 onboarding | `f2d8ab2514ace94c3a07a30d9d2d247ac2af1a33` | provider onboarding |

PR #34、#38 不在范围内；PR #36 的架构方案由本文取代。

## 3. 发布边界

### 3.1 正式随 Blue 发布的包

这些包组成 npm lockstep release，最终统一为 `0.1.0-rc.9`。它们必须有
完整 `exports`、`files`、tsdown entry、tarball contract 和发布说明：

| 包 | 目录 | 责任 | 发布理由 |
|---|---|---|---|
| `@dsh-blue/blue-api` | `packages/api` | 稳定 renderer-neutral contracts、manifest、capability result | 所有 feature/adapter 的公共叶包 |
| `@dsh-blue/blue-frontend` | `packages/frontend` | readonly model vocabulary、provider host、notification/theme registry | 正式 frontend runtime 依赖 |
| `@dsh-blue/blue-harness-adapter` | `packages/harness-adapter` | session/projection/action/model/question 窄兼容桥 | runtime feature 的官方 API 边界 |
| `@dsh-blue/blue-conversation` | `packages/conversation` | append-origin Harness conversation projection | transcript 正式 domain producer |
| `@dsh-blue/blue-core` | `packages/core` | 唯一 pi-tui/raw terminal renderer adapter | TUI kernel |
| `@dsh-blue/blue-app` | `packages/app` | CLI startup、Agent driver、session binding | 可启动产品组合 |
| `@dsh-blue/blue-transcript` | `packages/transcript` | official transcript consumer、status/bottom-pane/tool models | 主内容呈现 |
| `@dsh-blue/blue-interaction` | `packages/interaction` | command/panel/editor/action consumers | 用户交互入口 |
| `@dsh-blue/blue` | `packages/bundle/blue` | Cordis composition、preset、host disables | 用户安装的 bundle |
| `@dsh-blue/blue-cli` | `packages/cli` | 独立 launcher、嵌套 Harness、profile calibration | 单命令分发入口 |

`frontend` 和 `harness-adapter` 虽然没有传统 UI，也不是验证插件；它们是
正式 runtime 的发布依赖，不能因为不直接挂载 TUI row 就从 release 中删除。

### 3.2 只作为外部架构验证样本的包

以下包用于证明第三方/domain 插件可以迁移到 renderer-neutral runtime；它们
不属于 Blue 的产品发布集合，不进入 `PACKAGE_DIRS`、release tarball、Blue
bundle dependency closure 或 rc.9 lockstep version gate：

| 包 | 目录 | 验证内容 | 发布策略 |
|---|---|---|---|
| `@dsh-blue/blue-context` | `packages/context` | 官方 context projection/action 到 panel/status | workspace fixture only |
| `@dsh-blue/blue-remote` | `packages/remote` | remote wire、multi-session、lease、question/approval | workspace fixture only |
| `@dsh-blue/blue-openpencil` | `packages/openpencil` | 第三方 tool presentation/fallback/meta elision | packed validation only |
| `@dsh-blue/blue-lark` | `packages/lark` | 第三方 command/notification/settings route | packed validation only |

它们仍然必须通过 typecheck、lint、unit/coverage、architecture validator、
独立 packed fixture 和当前/上一 Harness line contract；“不发布”不等于
“可以不维护”。它们的版本可与 runtime test contract 对齐，但不能被 release
脚本误收集。

### 3.3 版本化但不发布的 manifest

`website/package.json` 是版本一致性和站点构建的一部分，保持私有；它不进入
npm tarball。根 `package.json` 也是 workspace 私有基线，不作为发布包。

Blue 正式发布版本的最终修改范围是上述 10 个发布包加 `website` 的版本文案
和 `BLUE_VERSION`，统一为 `0.1.0-rc.9`。Harness 版本线仍独立保持当前
`0.1.1-rc.2`，并由上一线 `0.1.1-rc.1` fixture 验证；不能把两个版本号混为一谈。

## 4. 当前代码结构与问题

### 4.1 当前主线（迁移前）

远程 rc.8 主线仍是：

```text
Harness Agent/Session events
  -> packages/app blueSession
  -> packages/transcript fold.ts / panes / intents
  -> packages/interaction dialogs/editor/commands
  -> packages/core pi-tui screen
  -> bundle/cli/release
```

其优势是功能完整、golden/e2e 丰富；问题是 transcript 和 pane 会直接拥有
session event 语义，interaction 会直接持有 Agent/Session 或 Harness service，
renderer 与 domain scope 混在同一 Cordis plugin 中，旧接口不能被第三方复用。

### 4.2 参考 runtime 已有的结构

参考实现已经提供以下目标骨架，但在 cutover 中要逐项核对、补齐 master 功能，
不能直接把参考文档中的“已完成”当作主线证据：

```text
Harness domain
  -> narrow harness-adapter / official projection
  -> blue-conversation / feature projection + structured action
  -> blue-frontend readonly model/provider
  -> blue-core renderer adapter
  -> pi-tui / terminal
```

职责边界：

- `api`：不认识 Agent、SessionEvent、pi-tui、ANSI、terminal width；只放公共
  readonly data、action descriptor 和 capability result。
- `frontend`：model、notification、theme token、provider swap；禁止 Promise、
  renderer object、focus handle、Agent/Session、ANSI 和 terminal width。
- `harness-adapter`：集中 capability probing、版本差异和官方结构转换；不保存
  第二套业务状态、不泄漏原始 Agent/Session。
- `conversation`：只做 Harness-domain append-origin projection；不依赖 Blue
  frontend 或 renderer，不做 action/UI。
- `core`：唯一接触 pi-tui、ANSI、raw terminal、focus、width truth 和 layout。
- `transcript`/`interaction`：只消费 model/action，不折叠 Harness events。
- `app`：启动和当前 session binding；不把 Agent 对象向 renderer 暴露。
- `bundle`：显式 composition、preset、disable list 和 row ordering。

### 4.3 必须删除或退役的旧结构

这些不是“以后再优化”的项目，而是切换完成定义的一部分：

| 旧结构 | 替代物 | 删除门槛 |
|---|---|---|
| `transcript/src/fold.ts` 直接折叠 session events | `blue-conversation` projection + official transcript model | replay/live/resume/tool/thinking/image/interruption/retract 全覆盖且无 consumer |
| pane 自己读取/聚合 activity/todo/agents/queue/btw events | feature projection -> canonical bottom-pane node | dock focus、mouse、scroll、tail-follow、resize 和 unload fixture 通过 |
| generic frontend status compatibility | canonical status-node registry | 所有 status producer 转 canonical node，footer parity 通过 |
| `blueIntents` 业务 presenter/fold shortcut | official canonical tool view/result -> `ToolPresentationModel` | Read/Write/Shell/error/long-output 全覆盖 |
| command-specific dialog 作为业务状态容器 | `PanelModel`/`FormPanelModel` + structured action | submit/cancel/loading/error/absent/stale 全覆盖 |
| module singleton shared editor | frontend-tree editor host + `EditorModel` actions | paste/history/completion/slot/focus/resize/selection fixture 通过 |
| interaction 直接持有 Agent/Session | app binding + adapter capability | static boundary scan 和 unload/late-result 通过 |
| 隐式 bundle row 顺序 | explicit inject/dependency/composition assertions | bundle drift validator 通过 |

## 5. 必须迁移的产品能力

### 5.1 rc.8 master 基线

以下功能必须在新架构下保持行为等价：

- CLI launcher、`--profile`/`--resume`、profile calibration、nested Harness、
  release/publish pipeline、npm shrinkwrap；
- dark/light/auto/custom 主题，以及 ocean/paper 主题的视觉语义（若保留为
  内置主题，则以 `ThemeModel` token 重新实现，不能恢复旧 renderer shortcut）；
- native image paste、Wayland/X11 probing、attachment admission、tmux/OSC52
  clipboard、external editor、draft/history/completion、mouse/resize/selection；
- `/update`、preflight、rollback、downgrade guard、cooldown、`/changelog`；
- `/trace` 的聚合、详情滚动、snapshot/live chunk 合并；
- btw pane、activity/todo/agents/queue dock、status/footer、banner、markdown、
  tool cards、fold/expand、window/step retention、image references；
- `/model`、`/provider`、`/effort`、`/preset`、`/plan`、`/compact`、`/permission`、
  `/sessions`、`/context`、`/export`、`/theme` 和 session switching；
- Cordis host-runner、thin-host disables、agent presets、session-title cadence、
  clean exit/exit epitaph、website docs/demo、release notes。

### 5.2 PR #58：message retract

迁移为 session-scoped structured action，例如 `session.retract`：

1. app/adapter 负责取消仍可取消的 request，并提交 durable retract fact；
2. conversation projection 将被撤回的 append-origin surface 替换为 durable
   replacement marker；
3. transcript model 隐藏被替换的源条目，不读取 session event 自己猜测；
4. ordinary compaction 只做 surface replacement，不撤销已经展示的 append-origin
   transcript；
5. action 必须有 request/session epoch、abort、stale rejection 和 replay test。

必须删除 legacy fold 中的 retract 分支，不能两套逻辑同时生成行。

### 5.3 PR #59：update cooldown

保留 installable eligibility、cache、cooldown、profile/version 判定和安全失败
语义；将启动提示、可执行 update action、失败原因投影为
`NotificationModel`/`CommandModel`。更新器不得直接操纵 renderer panel；所有 timer、
网络请求、进程子任务和 late result 必须 Fiber-owned。验证命中、冷却、刷新、
安装不可用、卸载和重复通知。

### 5.4 PR #60：creative mode / plugin host

保留 capability-scoped `bluePluginHost` 和 namespace ownership：动态插件只能
贡献 `BlueView`、command、status、dock、notification，不能拿到 core、raw terminal、
Agent/Session 或 package-internal API。creative preset 和 Cordis cards 必须走
official tool presentation model。插件 host 必须支持 manifest validation、owner
隔离、Fiber cleanup、unload、absent capability 和 hostile plugin fixture。

### 5.5 PR #61：settings

把 dsh settings service 映射为 renderer-neutral `SettingsPanelModel`：typed field、
namespace、unset、revision、secret redaction、restart marker、get/set/unset action。
面板只消费 model；提交携带 expected revision，冲突返回结构化 rejection；theme/editor/
paste/update 等 namespace 的旧设置行为必须保留。禁止将 settings service 或 secret
对象存入 panel singleton。

### 5.6 PR #62：rewind/session tree

将 rewind 表达为 `session.rewind` action；session-query adapter 负责读取 lineage，
返回 readonly `SessionTreeModel`。保留 seed、parent、fork、branch、current marker、
确认、失败和 durable notice。rewind 不能由 UI 复制事件日志，必须验证 stale branch、
session switch、resume/replay、取消和 action outcome。

### 5.7 PR #63：provider onboarding

credentials/settings adapter 负责 capability probing；UI 只得到带 secret field
标记的 `FormPanelModel`，提交走 `credentials.set` structured action。输入值不能进
notification、日志、snapshot 或 error message；取消、重复提交、abort、Fiber unload、
provider list refresh、失败回填和成功后的 model/session refresh 都要有 fixture。

## 6. 迁移阶段和交付物

### C0：边界与发布修正

- 固定 10 个正式 release package、4 个 validation-only package、website/private
  manifest；更新 package contract、tsdown、check:lib/check:pack、release workflow。
- 建立本规格、surface ledger、PR parity matrix、deletion ledger。
- 不改变功能，不改变用户默认 bundle，先让结构和脚本可验证。

### C1：runtime foundation

- api/frontend/harness-adapter/conversation/core 的 public boundary、Fiber ownership、
  provider swap/plain fallback；
- static scan 禁止 renderer-neutral 包引用 pi-tui/ANSI/raw terminal；
- headless model snapshot、provider abort/dispose/restore、unload/late-result fixture。

### C2：master parity

- 按主题、clipboard/paste、update/changelog/trace、dock/status/editor/tool/transcript、
  CLI/release 顺序迁移；每项完成 Domain/Projection/Action/Model/Renderer/Composition
  六层证据后才能替换 bundle row；
- master 中没有对应官方 projection 的功能，先建立窄 adapter 并记录删除条件。

### C3：PR #58-#63 vertical slices

每个 PR 单独完成 domain/adapter、projection/action、model、renderer consumer、
fixture、bundle row、docs/AGENTS 和删除记录；不能把六个 PR 混成一个“兼容层”。

### C4：legacy deletion

以静态 import/consumer 搜索、bundle composition、运行时日志和 fixture 证明旧 fold、
旧 dialog、旧 pane fold、旧 intent、共享 editor singleton 已无消费者，再物理删除。

### C5：验证、dogfood、rc.9

- 当前/上一 Harness line packed fixtures；
- 全量质量门禁和三种 smoke；
- 安装 `blue-runtime-cutover` 专用 profile，覆盖 rc.8 + #58-#63；
- 用户 live acceptance；
- 仅在验收后将 10 个发布包和 website 升到 rc.9，生成 release notes，创建一个 atomic
  cutover PR；合并后在 master checkout rebuild，删除 acceptance profile。

## 7. 质量与验收门禁

仓库门禁：

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

验证插件额外运行：

```sh
node script/blue-plugin-validate.mjs packages/context
node script/blue-plugin-validate.mjs packages/remote
node script/blue-plugin-fixture.mjs packages/context --install
node script/blue-plugin-fixture.mjs packages/remote --install --harness-line 0.1.1-rc.1
node script/blue-plugin-fixture.mjs packages/openpencil --install
node script/blue-plugin-fixture.mjs packages/lark --install --harness-line 0.1.1-rc.1
```

每个 fixture 的 `declared === executed`、`skipped` 为空、`failures` 为空，且
`fixtureCleaned === true`。每个 content renderer 都要通过 20/40/80/120 列、CJK、
ANSI、emoji、长路径和空 viewport 的 width scan。

真实 profile 必须检查：版本专用标识、正常 prompt/stream/resume、model/provider/
settings/onboarding、rewind/retract、update/changelog/trace、theme/paste/clipboard、
todo/plan/editor overlay、tmux copy、resize、窄终端、Ctrl-O/scroll/End、clean exit。

自动测试不能替代真人验收。没有用户明确回复“验收通过”，不得 merge、不得删除旧
实现、不得删除 profile、不得升 rc.9。

## 8. 完成判定

迁移只有在以下条件全部满足时才算完成：

- 正式发布集合准确为 10 个包，四个外部验证包没有被 release/Blue bundle 收集；
- rc.8 master 功能和 #58-#63 每项都有 parity 行和独立证据；
- 非 core 包没有 renderer/terminal 依赖，model 没有 Agent/Session/Promise/ANSI；
- 所有 registry、subscription、timer、async continuation 都由 Fiber 管理；
- legacy deletion ledger 全部满足后才删除旧实现；
- 所有自动门禁、双 Harness fixture、专用 profile 和用户真人验收通过；
- 最后才统一升版 rc.9、提交一个原子 PR，并在主分支重新构建。
